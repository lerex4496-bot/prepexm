"""
LLM provider abstraction + the single grounded explanation call.

WHY AN ABSTRACTION
------------------
The app never talks to a model vendor. It talks to this service, which holds
the key and picks the provider. Swapping providers is a server-side env change,
never an app update — which matters because the two students have installed
APKs, not a web page we can redeploy.

NVIDIA NIM is the default. Sarvam is offered alongside it because it is built
for Indic languages, and the CTET student studies in Hindi: a model trained on
Devanagari is a better bet for explaining a pedagogy question in Hindi than a
general model translating after the fact. Both speak the OpenAI
/v1/chat/completions shape, so one adapter covers them and anything else that
does.

WHAT THIS IS NOT ALLOWED TO DO
------------------------------
  * It never repairs legacy-font garbage. Text that failed extraction is left
    to the deterministic backfill, not guessed at by a model.
  * It never invents or overrides an answer. The official key is authority; the
    correct option is passed IN as a fact and the model is told to explain it,
    not to decide it.
  * Its output never reaches a student directly. A generated explanation lands
    as content awaiting review, and attaching one to an already-approved
    question sends that question back to the review queue — because "approved"
    attests to what ships, and after this call the explanation ships too.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

# Importing db first ensures apps/api/.env is loaded before we read os.environ.
from .db import _load_env  # noqa: F401


class LLMError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    model: str
    api_key_env: str = ""
    #: Set when the config came from the registry rather than from the env.
    api_key_literal: str = ""


# Every entry speaks OpenAI-compatible /v1/chat/completions.
PROVIDERS: dict[str, ProviderConfig] = {
    "nvidia": ProviderConfig(
        name="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        model=os.environ.get("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct"),
        api_key_env="NVIDIA_API_KEY",
    ),
    # sarvam-m is DEPRECATED; the current chat models are sarvam-30b / sarvam-105b.
    "sarvam": ProviderConfig(
        name="sarvam",
        base_url="https://api.sarvam.ai/v1",
        model=os.environ.get("SARVAM_MODEL", "sarvam-30b"),
        api_key_env="SARVAM_API_KEY",
    ),
}

DEFAULT_PROVIDER = os.environ.get("LLM_PROVIDER", "nvidia")
# Indic explanations default to Sarvam when a key exists — see module docstring.
INDIC_PROVIDER = os.environ.get("LLM_PROVIDER_INDIC", "sarvam")


class LLMProvider(Protocol):
    def complete(self, system: str, user: str, *, max_tokens: int, temperature: float) -> str: ...


class OpenAICompatProvider:
    def __init__(self, cfg: ProviderConfig):
        self.cfg = cfg
        # A literal key means the caller resolved it from the registry, where
        # it may have come from a database row rather than the environment.
        self.api_key = cfg.api_key_literal or os.environ.get(cfg.api_key_env, "")

    @classmethod
    def from_parts(
        cls, *, name: str, base_url: str, model: str, api_key: str
    ) -> "OpenAICompatProvider":
        """Build a client directly from a resolved registry row."""
        return cls(
            ProviderConfig(
                name=name, base_url=base_url, model=model, api_key_literal=api_key
            )
        )

    @classmethod
    def from_resolved(cls, r) -> "OpenAICompatProvider":
        """Build a client from providers.ResolvedProvider."""
        return cls.from_parts(
            name=r.name, base_url=r.base_url, model=r.model, api_key=r.api_key
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def complete(self, system: str, user: str, *, max_tokens: int = 700, temperature: float = 0.2) -> str:
        if not self.configured:
            raise LLMError(
                f"{self.cfg.name}: no API key ({self.cfg.api_key_env or 'registry key'} is empty)"
            )

        body = json.dumps(
            {
                "model": self.cfg.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                # Low temperature: this is exposition of a known answer, not
                # creative writing. Variability here is only a chance to drift
                # from the official key.
                "temperature": temperature,
            }
        ).encode()

        req = urllib.request.Request(
            f"{self.cfg.base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise LLMError(f"{self.cfg.name} HTTP {e.code}: {e.read().decode()[:200]}") from e
        except Exception as e:
            raise LLMError(f"{self.cfg.name} {type(e).__name__}: {e}") from e

        try:
            choice = data["choices"][0]
            message = choice["message"]
        except (KeyError, IndexError) as e:
            raise LLMError(f"{self.cfg.name} returned an unexpected shape: {str(data)[:200]}") from e

        content = message.get("content")
        if content:
            return content.strip()

        # Reasoning models (e.g. sarvam-105b) stream `reasoning_content` first
        # and only fill `content` once thinking is done. Hitting the token
        # ceiling mid-thought therefore yields a null answer rather than an
        # error — which used to surface as an unhelpful AttributeError.
        finish = choice.get("finish_reason")
        if message.get("reasoning_content") and finish == "length":
            raise LLMError(
                f"{self.cfg.name}/{self.cfg.model} ran out of tokens while reasoning "
                f"and never produced an answer — raise max_tokens, or use a "
                f"non-reasoning model such as sarvam-105b-conversations"
            )
        if message.get("refusal"):
            raise LLMError(f"{self.cfg.name} refused: {message['refusal']}")
        raise LLMError(f"{self.cfg.name} returned no content (finish_reason={finish})")


def get_provider(name: str | None = None) -> OpenAICompatProvider:
    key = (name or DEFAULT_PROVIDER).lower()
    cfg = PROVIDERS.get(key)
    if not cfg:
        raise LLMError(f"unknown provider {key!r}; known: {', '.join(PROVIDERS)}")
    return OpenAICompatProvider(cfg)


def provider_for_language(lang: str, override: str | None = None) -> OpenAICompatProvider:
    """Prefer the Indic-specialised provider for hi/gu when it is configured."""
    if override:
        return get_provider(override)
    if lang in ("hi", "gu"):
        p = get_provider(INDIC_PROVIDER)
        if p.configured:
            return p
    return get_provider(DEFAULT_PROVIDER)


LANG_NAME = {"en": "English", "hi": "Hindi", "gu": "Gujarati"}

SYSTEM = """You explain answers to questions from India's CTET teacher-eligibility exam.

You are given a question, its four options, and THE OFFICIAL CORRECT ANSWER as
published by CBSE. The official answer is a fact you must accept. Never contradict
it, never suggest a different option is correct, and never say the official answer
looks wrong — if it seems odd, explain the reasoning that supports it.

Write for a candidate preparing for the exam:
1. One short paragraph on why the correct option is correct.
2. Then one line per incorrect option explaining specifically why THAT option is
   wrong. This distractor analysis is the most useful part — it teaches her to
   recognise plausible-but-wrong options under time pressure.

Be concise and concrete. No preamble, no restating the question, no markdown
headings. Write ONLY in {language}."""

USER = """Question: {stem}

Options:
{options}

OFFICIAL CORRECT ANSWER (from the CBSE final answer key): {correct}
{extra}
Explain in {language}."""


def build_explanation_prompt(
    stem: str,
    options: list[tuple[str, str]],
    correct_labels: list[str],
    lang: str,
    *,
    is_bonus: bool = False,
    chosen: str | None = None,
) -> tuple[str, str]:
    language = LANG_NAME.get(lang, "English")
    opts = "\n".join(f"({label}) {text}" for label, text in options)

    extra = ""
    if is_bonus:
        extra += (
            "\nNOTE: the board accepted ALL options for this question, so every "
            "candidate who attempted it was awarded the mark. Say so, and still "
            "explain what the question was testing.\n"
        )
    elif len(correct_labels) > 1:
        extra += (
            "\nNOTE: the official key accepts more than one option here; any of "
            "them scores. Explain why each accepted option is defensible.\n"
        )
    if chosen and chosen not in correct_labels:
        extra += f"\nThe student chose ({chosen}); address that option's appeal directly.\n"

    return (
        SYSTEM.format(language=language),
        USER.format(
            stem=stem,
            options=opts,
            correct="/".join(correct_labels) or "unknown",
            extra=extra,
            language=language,
        ),
    )


def provider_status() -> dict:
    return {
        "default": DEFAULT_PROVIDER,
        "indic": INDIC_PROVIDER,
        "providers": {
            name: {
                "model": cfg.model,
                "baseUrl": cfg.base_url,
                "keyEnv": cfg.api_key_env,
                "configured": bool(os.environ.get(cfg.api_key_env)),
            }
            for name, cfg in PROVIDERS.items()
        },
    }
