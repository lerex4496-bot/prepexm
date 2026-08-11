"""
Optional accounts, so progress can outlive the phone.

WHAT PROBLEM THIS ACTUALLY SOLVES
---------------------------------
Everything she does — attempts, responses, mistakes, the notebook — lives in a
SQLite file on the device. That is deliberate: the study loop works on a train
with no signal, and it must keep working. But it means the data has exactly one
copy, and three things can take it:

    app UPDATE      -> data survives (Android keeps app data across updates)
    UNINSTALL       -> data is gone
    lost/new phone  -> data is gone

An account fixes the second and third. It is OPTIONAL by design: a student who
never signs up loses nothing she has today, and is never blocked from studying
by a login screen. That matters more than it sounds — an account wall on first
open is the single most common reason a study app gets uninstalled on day one.

WHY A SNAPSHOT AND NOT A MERGE
------------------------------
One account is one student on one phone at a time. Restores happen when a phone
is replaced or an app reinstalled, not concurrently on two devices. So the sync
model is a whole-history snapshot: push replaces, pull returns. That avoids an
entire class of merge bugs — duplicated attempts, resurrected deleted mistakes,
conflicting scores — that would be real work to get right and would buy nothing
for the way this is used.

The one case it could lose data is two devices used in parallel, so the server
records the device that last pushed and the client warns before overwriting a
snapshot from a different device.

PASSWORDS
---------
Hashed with scrypt from the standard library. No new dependency, which matters
in a service that holds API keys — the same reasoning as the hand-rolled .env
loader in db.py. Parameters are stored alongside each hash so they can be
raised later without invalidating existing passwords.

The password is never logged, never returned, and never stored in any form the
server can reverse.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Account, ProgressSnapshot

# scrypt cost. n=2**15 is ~100ms on a modest server: slow enough to make
# guessing expensive, fast enough that login does not feel broken.
#
# `maxmem` must be set explicitly. scrypt needs roughly 128 * n * r bytes —
# 32MB at these parameters — and OpenSSL's default ceiling is exactly 32MB, so
# the call fails with "memory limit exceeded" without it. Raising the cost
# without raising this is a trap for whoever tunes it next.
_SCRYPT = {"n": 2**15, "r": 8, "p": 1, "dklen": 32, "maxmem": 128 * 1024 * 1024}

TOKEN_TTL_S = 90 * 24 * 3600  # 90 days; she should not be logged out mid-term.

MIN_USERNAME = 3
MIN_PASSWORD = 8


class AuthError(ValueError):
    """Registration or login failed, with a reason safe to show."""


def _server_secret() -> bytes:
    """
    Key for signing session tokens.

    Read from the environment when set. The generated fallback is per-process,
    which means a server restart invalidates existing tokens and everyone signs
    in again — acceptable for two students, and far better than shipping a
    hardcoded default that would be identical in every deployment.
    """
    env = os.environ.get("STUDYMATE_SECRET")
    if env:
        return env.encode()
    global _EPHEMERAL
    try:
        return _EPHEMERAL
    except NameError:
        _EPHEMERAL = secrets.token_bytes(32)
        return _EPHEMERAL


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    # Parameters travel with the hash so they can be raised later without
    # locking anyone out.
    return "|".join(
        [
            "scrypt",
            str(_SCRYPT["n"]),
            str(_SCRYPT["r"]),
            str(_SCRYPT["p"]),
            base64.b64encode(salt).decode(),
            base64.b64encode(dk).decode(),
        ]
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, dk_b64 = stored.split("|")
        if scheme != "scrypt":
            return False
        dk = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt_b64),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(base64.b64decode(dk_b64)),
            maxmem=_SCRYPT["maxmem"],
        )
    except (ValueError, TypeError):
        return False
    # Constant time: a fast reject on the first wrong byte is a timing oracle.
    return hmac.compare_digest(dk, base64.b64decode(dk_b64))


def make_token(account_id: int) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": account_id, "exp": int(time.time()) + TOKEN_TTL_S}).encode()
    ).decode()
    sig = hmac.new(_server_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{sig}"


def read_token(token: str) -> int | None:
    """Return the account id, or None if the token is bad or expired."""
    try:
        payload, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_server_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload))
    except (ValueError, TypeError):
        return None
    if int(data.get("exp", 0)) < time.time():
        return None
    return int(data["sub"])


def normalise_username(username: str) -> str:
    return (username or "").strip().lower()


def register(db: Session, username: str, password: str) -> tuple[Account, str]:
    name = normalise_username(username)
    if len(name) < MIN_USERNAME:
        raise AuthError(f"username must be at least {MIN_USERNAME} characters")
    if not name.replace("_", "").replace(".", "").isalnum():
        raise AuthError("username can use letters, numbers, dots and underscores only")
    if len(password or "") < MIN_PASSWORD:
        raise AuthError(f"password must be at least {MIN_PASSWORD} characters")
    if db.scalar(select(Account).where(Account.username == name)):
        raise AuthError("that username is taken")

    acc = Account(username=name, password_hash=hash_password(password))
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc, make_token(acc.id)


def login(db: Session, username: str, password: str) -> tuple[Account, str]:
    acc = db.scalar(select(Account).where(Account.username == normalise_username(username)))
    # Same message either way: distinguishing "no such user" from "wrong
    # password" tells an attacker which usernames exist.
    if not acc or not verify_password(password or "", acc.password_hash):
        raise AuthError("username or password is wrong")
    return acc, make_token(acc.id)


@dataclass
class SnapshotStats:
    attempts: int
    responses: int
    mistakes: int
    device: str | None
    saved_at: str | None


def save_snapshot(db: Session, account_id: int, payload: dict, device: str | None) -> SnapshotStats:
    snap = db.scalar(select(ProgressSnapshot).where(ProgressSnapshot.account_id == account_id))
    if snap is None:
        snap = ProgressSnapshot(account_id=account_id)
        db.add(snap)

    snap.payload = payload
    snap.device = (device or "")[:120] or None
    snap.attempts = len(payload.get("attempts") or [])
    snap.responses = len(payload.get("responses") or [])
    snap.mistakes = len(payload.get("mistakes") or [])
    db.commit()
    db.refresh(snap)
    return SnapshotStats(
        attempts=snap.attempts,
        responses=snap.responses,
        mistakes=snap.mistakes,
        device=snap.device,
        saved_at=snap.updated_at.isoformat() if snap.updated_at else None,
    )


def load_snapshot(db: Session, account_id: int) -> tuple[dict, SnapshotStats] | None:
    snap = db.scalar(select(ProgressSnapshot).where(ProgressSnapshot.account_id == account_id))
    if snap is None:
        return None
    return snap.payload or {}, SnapshotStats(
        attempts=snap.attempts,
        responses=snap.responses,
        mistakes=snap.mistakes,
        device=snap.device,
        saved_at=snap.updated_at.isoformat() if snap.updated_at else None,
    )
