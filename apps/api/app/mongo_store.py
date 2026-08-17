"""
Accounts and progress snapshots, stored in MongoDB Atlas.

WHY MONGO FOR THIS AND NOT FOR EVERYTHING
-----------------------------------------
Three stores, each holding what it is actually good for:

  bundled SQLite   her question bank. Ships inside the APK and must work with
                   no signal, because the whole point is revising on a train
                   or in a waiting room. Never moves.
  Postgres         the authoring pipeline and the NCERT corpus — relational,
                   heavily joined, already written against SQLAlchemy, and of
                   no interest to the phone.
  MongoDB (here)   the two things that must outlive the device: who she is,
                   and everything she has done.

A progress snapshot is a single self-contained document per account — attempts,
responses and mistakes in one blob. That is a document, not a set of related
tables, and storing it as one is why the whole-history model in accounts.py
stays simple.

WHAT IS DELIBERATELY UNCHANGED
------------------------------
The password hashing, the token signing and the validation rules are IMPORTED
from accounts.py rather than reimplemented. A second copy of security code is a
second copy to get wrong, and the storage backend is the only thing that
differs. Passwords are scrypt hashes with their parameters stored alongside;
nothing here ever sees or writes a plaintext password.

The snapshot model is still REPLACE, not merge — see accounts.py for why. One
student, one phone at a time; a restore happens when a phone is replaced, and
merge semantics would buy nothing while adding a class of bugs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .accounts import (
    AuthError,
    MIN_PASSWORD,
    MIN_USERNAME,
    hash_password,
    make_subject_token,
    read_subject_token,
    normalise_username,
    verify_password,
)

_client: Any = None


def _load_env() -> None:
    """Read apps/api/.env, same hand-rolled loader as db.py uses.

    No python-dotenv: this service holds API keys, and every dependency added
    to it is another package with read access to them.
    """
    env = Path(__file__).resolve().parents[1] / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def configured() -> bool:
    _load_env()
    return bool(os.environ.get("MONGODB_URI"))


def db():
    """The Mongo database handle, connected lazily and reused.

    Lazy because the API must still start when Mongo is unreachable: accounts
    are OPTIONAL, and a student who never signs up should not be blocked from
    studying because a database in another country is down.
    """
    global _client
    _load_env()
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise AuthError("accounts are not configured on this server")
    if _client is None:
        from pymongo import MongoClient

        _client = MongoClient(uri, serverSelectionTimeoutMS=15000, retryWrites=True)
    return _client[os.environ.get("MONGODB_DB", "prepareforneetctet")]


def ensure_indexes() -> None:
    """Unique index on username.

    The application checks for a duplicate before inserting, but two sign-ups
    racing would both pass that check. The unique index is what actually makes
    it impossible, and it is also what makes login lookups a seek rather than a
    collection scan.
    """
    accounts = db()["users"]
    accounts.create_index("username", unique=True)
    db()["snapshots"].create_index("username", unique=True)


def register(username: str, password: str) -> tuple[str, str]:
    """Create an account. Returns (username, token)."""
    name = normalise_username(username)
    if len(name) < MIN_USERNAME:
        raise AuthError(f"username must be at least {MIN_USERNAME} characters")
    if not name.replace("_", "").replace(".", "").isalnum():
        raise AuthError("username can use letters, numbers, dots and underscores only")
    if len(password or "") < MIN_PASSWORD:
        raise AuthError(f"password must be at least {MIN_PASSWORD} characters")

    from pymongo.errors import DuplicateKeyError

    doc = {
        "username": name,
        "password_hash": hash_password(password),
        "created_at": datetime.now(timezone.utc),
        # Optional, and only ever used to send a reset. Absent until she adds it.
        "email": None,
    }
    try:
        db()["users"].insert_one(doc)
    except DuplicateKeyError:
        raise AuthError("that username is taken") from None
    return name, make_token_for(name)


def login(username: str, password: str) -> tuple[str, str]:
    name = normalise_username(username)
    doc = db()["users"].find_one({"username": name})
    # Same message either way: distinguishing "no such user" from "wrong
    # password" tells an attacker which usernames exist.
    if not doc or not verify_password(password or "", doc.get("password_hash", "")):
        raise AuthError("username or password is wrong")
    return name, make_token_for(name)


def make_token_for(username: str) -> str:
    """Signed token carrying the username.

    accounts.make_token signs an INTEGER row id and its reader does int(sub),
    which Mongo has no equivalent for — a username token signed with it would
    verify and then fail to parse. make_subject_token is the same signing with
    a string subject. The username is the key here: already unique, already
    immutable, and no parallel numeric id to invent and keep in step.
    """
    return make_subject_token(username)


def username_from_token(token: str) -> str | None:
    """The account a request is authenticated as, or None."""
    return read_subject_token(token)


@dataclass
class SnapshotStats:
    attempts: int
    responses: int
    mistakes: int
    device: str | None
    saved_at: str | None


def save_snapshot(username: str, payload: dict, device: str | None) -> SnapshotStats:
    now = datetime.now(timezone.utc)
    stats = {
        "attempts": len(payload.get("attempts") or []),
        "responses": len(payload.get("responses") or []),
        "mistakes": len(payload.get("mistakes") or []),
        "device": (device or "")[:120] or None,
        "saved_at": now,
    }
    db()["snapshots"].update_one(
        {"username": normalise_username(username)},
        {"$set": {"payload": payload, **stats}},
        upsert=True,
    )
    return SnapshotStats(
        stats["attempts"], stats["responses"], stats["mistakes"], stats["device"], now.isoformat()
    )


def load_snapshot(username: str) -> tuple[dict, SnapshotStats] | None:
    doc = db()["snapshots"].find_one({"username": normalise_username(username)})
    if not doc:
        return None
    saved = doc.get("saved_at")
    return doc.get("payload") or {}, SnapshotStats(
        attempts=doc.get("attempts", 0),
        responses=doc.get("responses", 0),
        mistakes=doc.get("mistakes", 0),
        device=doc.get("device"),
        saved_at=saved.isoformat() if hasattr(saved, "isoformat") else saved,
    )


def health() -> dict:
    """Whether Mongo is reachable, for the Settings screen to show honestly."""
    try:
        d = db()
        d.client.admin.command("ping")
        return {
            "ok": True,
            "database": d.name,
            "accounts": d["users"].estimated_document_count(),
            "snapshots": d["snapshots"].estimated_document_count(),
        }
    except Exception as e:  # noqa: BLE001 - surfaced to the caller as status
        return {"ok": False, "detail": f"{type(e).__name__}: {str(e)[:200]}"}
