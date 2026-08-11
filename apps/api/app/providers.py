"""
The provider registry: which model endpoint serves which job, and what happens
when one of them is down.

WHY ROLES RATHER THAN NAMES
---------------------------
Callers ask for a CAPABILITY ("I need something that can reason", "I need
something that writes good Gujarati"), never for a vendor. That is what makes
the two-stage pipeline possible: stage 1 asks for REASON and stage 2 asks for
LOCALISE, and whether those resolve to NVIDIA and Sarvam or to two entirely
different endpoints is a configuration question, not a code question.

WHY FALLBACK IS EXPLICIT AND LABELLED
-------------------------------------
When a role has no working provider, the honest options are to fail or to
degrade. Silently degrading is the one thing we will not do: an explanation
produced by a single generalist model instead of the reason-then-localise
pipeline is a DIFFERENT ARTEFACT with different reliability, and the reviewer
approving it needs to know which one they are looking at. So `resolve()` returns
the chain it actually used, and the caller records it alongside the output.

KEYS ARE NEVER RETURNED
-----------------------
`public_dict()` is the only thing that may cross the API boundary. It emits a
masked hint and a boolean, never the secret. Every route in main.py uses it.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import _load_env  # noqa: F401  (ensures .env is loaded first)
from .models import Provider

# The jobs a provider can be registered for. Anything outside this set is
# rejected at the API boundary rather than stored and silently never used.
ROLES = ("REASON", "LOCALISE", "VISION", "CHAT", "EMBED")

# Roles that may stand in for one another, in preference order, when a role has
# nothing configured. Deliberately conservative:
#   * REASON falls back to CHAT/LOCALISE — a general model can still explain,
#     just less reliably, and the result is labelled single-stage.
#   * LOCALISE falls back to REASON — worse Indic output, but output.
#   * VISION has NO fallback. A text model cannot read a photograph, and
#     pretending otherwise would produce a confident description of nothing.
#   * EMBED has NO fallback for the same reason.
FALLBACK_ROLES: dict[str, tuple[str, ...]] = {
    "REASON": ("CHAT", "LOCALISE"),
    "LOCALISE": ("CHAT", "REASON"),
    "CHAT": ("REASON", "LOCALISE"),
    "VISION": (),
    "EMBED": (),
}


class NoProviderError(RuntimeError):
    """No enabled, credentialed provider exists for a role or its fallbacks."""


@dataclass(frozen=True)
class ResolvedProvider:
    """A provider ready to call, plus how we ended up choosing it."""

    id: int
    name: str
    role: str
    base_url: str
    model: str
    api_key: str
    max_tokens: int
    temperature: float
    #: The role the caller ASKED for, which may differ from `role`.
    requested_role: str

    @property
    def is_fallback(self) -> bool:
        return self.role != self.requested_role


def key_for(p: Provider) -> str:
    """
    The secret for this provider.

    `api_key_env` wins over `api_key`: a key held in .env is strictly safer than
    one in a database row, so if someone has bothered to configure both, honour
    the safer one.
    """
    if p.api_key_env:
        return os.environ.get(p.api_key_env, "")
    return p.api_key or ""


def mask(secret: str) -> str:
    """A hint that identifies a key without disclosing it."""
    if not secret:
        return ""
    if len(secret) <= 10:
        return "•" * len(secret)
    return f"{secret[:6]}…{secret[-4:]}"


def public_dict(p: Provider) -> dict:
    """
    The ONLY representation allowed out of the API.

    Note what is absent: `api_key`. Not masked at the edge, not optional —
    absent, so no future handler can accidentally include it.
    """
    secret = key_for(p)
    return {
        "id": p.id,
        "name": p.name,
        "role": p.role,
        "baseUrl": p.base_url,
        "model": p.model,
        "enabled": p.enabled,
        "priority": p.priority,
        "maxTokens": p.max_tokens,
        "temperature": p.temperature,
        "notes": p.notes,
        "keyEnv": p.api_key_env,
        "keyHint": mask(secret),
        "keySource": "env" if p.api_key_env else ("stored" if p.api_key else None),
        "configured": bool(secret),
        "lastOkAt": p.last_ok_at.isoformat() if p.last_ok_at else None,
        "lastError": p.last_error,
        "lastLatencyMs": p.last_latency_ms,
    }


def candidates(db: Session, role: str) -> list[Provider]:
    """Enabled providers for a role, best first."""
    return list(
        db.scalars(
            select(Provider)
            .where(Provider.role == role, Provider.enabled.is_(True))
            .order_by(Provider.priority.asc(), Provider.id.asc())
        )
    )


def resolve(db: Session, role: str) -> ResolvedProvider:
    """
    Pick a provider for a role, falling back across roles if it has none.

    Raises NoProviderError rather than returning None: a caller that forgets to
    check a None would produce a confident-looking result from no model at all.
    """
    role = role.upper()
    if role not in ROLES:
        raise NoProviderError(f"unknown role {role!r}; known: {', '.join(ROLES)}")

    tried: list[str] = []
    for candidate_role in (role, *FALLBACK_ROLES.get(role, ())):
        for p in candidates(db, candidate_role):
            secret = key_for(p)
            if not secret:
                tried.append(f"{p.name}/{candidate_role} (no key)")
                continue
            return ResolvedProvider(
                id=p.id,
                name=p.name,
                role=candidate_role,
                base_url=p.base_url,
                model=p.model,
                api_key=secret,
                max_tokens=p.max_tokens,
                temperature=p.temperature,
                requested_role=role,
            )
        tried.append(f"{candidate_role} (none enabled)")

    raise NoProviderError(
        f"no usable provider for role {role}. Tried: {'; '.join(tried) or 'nothing configured'}. "
        f"Add one in the review tool under Providers."
    )


def record_health(
    db: Session, provider_id: int, *, ok: bool, latency_ms: int | None, error: str | None
) -> None:
    """Persist the outcome of a real call so the tool shows what works, not what is merely set."""
    p = db.get(Provider, provider_id)
    if not p:
        return
    from datetime import datetime, timezone

    if ok:
        p.last_ok_at = datetime.now(timezone.utc)
        p.last_error = None
    else:
        p.last_error = (error or "")[:500]
    p.last_latency_ms = latency_ms
    db.commit()


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

# What we ship with. Models are the ones actually measured against a real CTET
# question, not the vendors' headline names:
#
#   nemotron-3-super-120b-a12b      10.7s, 337 tokens, finish=stop     -> REASON
#   llama-3.3-nemotron-super-49b    26.8s, truncated at 500 tokens     -> rejected
#   sarvam-105b-conversations        2.6s,  47 tokens                  -> LOCALISE
#   sarvam-105b                      returned content=null (reasoning model
#                                    hitting the token ceiling mid-thought)
#
# Keys are referenced by ENV NAME, never copied into the database: the seed
# should not be the thing that puts a secret in Postgres.
SEED: list[dict] = [
    {
        "name": "nvidia",
        "role": "REASON",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "model": os.environ.get("NVIDIA_MODEL", "nvidia/nemotron-3-super-120b-a12b"),
        "api_key_env": "NVIDIA_API_KEY",
        "priority": 10,
        # Reasoning models spend tokens before `content` is filled. 500 was not
        # enough for the 49b model and it returned a truncated non-answer.
        # 1400 truncated 3 of 17 stage-1 calls in a measured batch — the JSON
        # simply stopped mid-object — so the ceiling is higher and twostage.py
        # retries once at double this if it still runs out.
        "max_tokens": 2200,
        "temperature": 0.2,
        "notes": "Reasoning stage. Structured English only; never renders Indic prose.",
    },
    {
        "name": "sarvam",
        "role": "LOCALISE",
        "base_url": "https://api.sarvam.ai/v1",
        "model": os.environ.get("SARVAM_MODEL", "sarvam-105b-conversations"),
        "api_key_env": "SARVAM_API_KEY",
        "priority": 10,
        "max_tokens": 900,
        # Rendering, not composing. Lower still than the reasoning stage because
        # there is nothing here to be creative about.
        "temperature": 0.1,
        "notes": "Rendering stage. Indic output; forbidden from adding facts.",
    },
    {
        "name": "sarvam",
        "role": "CHAT",
        "base_url": "https://api.sarvam.ai/v1",
        "model": os.environ.get("SARVAM_MODEL", "sarvam-105b-conversations"),
        "api_key_env": "SARVAM_API_KEY",
        "priority": 10,
        "max_tokens": 900,
        "temperature": 0.3,
        "notes": "Tutor. Matches the student's register, including Hinglish.",
    },
    {
        "name": "nvidia",
        "role": "VISION",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "model": os.environ.get("NVIDIA_VISION_MODEL", "nvidia/nemotron-nano-12b-v2-vl"),
        "api_key_env": "NVIDIA_API_KEY",
        "priority": 10,
        "max_tokens": 900,
        "temperature": 0.1,
        "notes": "Reads photographed questions. No fallback — a text model cannot see.",
    },
    {
        "name": "nvidia",
        "role": "EMBED",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "model": os.environ.get("NVIDIA_EMBED_MODEL", "nvidia/nemotron-3-embed-1b"),
        "api_key_env": "NVIDIA_API_KEY",
        "priority": 10,
        "max_tokens": 0,
        "temperature": 0.0,
        "notes": "Unused today — retrieval is Postgres full-text. Here for when it isn't.",
    },
]


def seed(db: Session) -> int:
    """
    Insert missing seed rows. Idempotent, and never overwrites an existing row.

    Not overwriting is the important half: once someone has edited a model name
    or disabled a provider in the tool, a restart must not silently undo it.
    """
    added = 0
    for row in SEED:
        exists = db.scalar(
            select(Provider).where(Provider.name == row["name"], Provider.role == row["role"])
        )
        if exists:
            continue
        db.add(Provider(**row))
        added += 1
    if added:
        db.commit()
    return added


def _check_embedding(base_url: str, model: str, api_key: str) -> str:
    """
    Embedding models do not serve /chat/completions.

    The first version of this health check sent every role a chat request, so
    the EMBED provider reported `HTTP 404: page not found` and looked broken
    when it was fine — the check was wrong, not the configuration. A health
    check that cannot distinguish "misconfigured" from "asked the wrong
    question" is worse than none, because it sends you debugging the wrong
    thing.
    """
    import json
    import urllib.error
    import urllib.request

    body = json.dumps(
        {"model": model, "input": ["ok"], "input_type": "query"}
    ).encode()
    req = urllib.request.Request(
        f"{base_url}/embeddings",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:200]}") from e
    except Exception as e:
        raise RuntimeError(f"{type(e).__name__}: {e}") from e

    vec = (data.get("data") or [{}])[0].get("embedding") or []
    if not vec:
        raise RuntimeError(f"no embedding in response: {str(data)[:160]}")
    return f"{len(vec)}-dim vector"


def check(db: Session, provider_id: int) -> dict:
    """
    Make a real call and record what happened.

    A minimal live request, not a ping: "the host resolves" tells us nothing
    about whether the key is valid or the model name still exists, and both of
    those are exactly what keeps breaking. The request shape follows the ROLE,
    because an embedding endpoint and a chat endpoint are different APIs.
    """
    from .llm import LLMError, OpenAICompatProvider

    p = db.get(Provider, provider_id)
    if not p:
        return {"ok": False, "error": "no such provider"}

    secret = key_for(p)
    if not secret:
        return {"ok": False, "error": f"no key ({p.api_key_env or 'api_key'} is empty)"}

    started = time.time()
    try:
        if p.role == "EMBED":
            reply = _check_embedding(p.base_url, p.model, secret)
        else:
            client = OpenAICompatProvider.from_parts(
                name=p.name, base_url=p.base_url, model=p.model, api_key=secret
            )
            reply = client.complete(
                "Reply with the single word OK.",
                "Say OK.",
                max_tokens=max(16, min(p.max_tokens, 64)),
                temperature=0.0,
            )
        latency = int((time.time() - started) * 1000)
        record_health(db, provider_id, ok=True, latency_ms=latency, error=None)
        return {"ok": True, "latencyMs": latency, "reply": reply[:120]}
    except (LLMError, RuntimeError) as e:
        latency = int((time.time() - started) * 1000)
        record_health(db, provider_id, ok=False, latency_ms=latency, error=str(e))
        return {"ok": False, "latencyMs": latency, "error": str(e)}
