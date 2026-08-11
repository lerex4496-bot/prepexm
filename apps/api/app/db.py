"""Database engine and session.

Postgres by default (docker compose up), but the URL is env-driven so the same
code runs against SQLite when the container isn't up.
"""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def _load_env() -> None:
    """
    Load apps/api/.env if present.

    Deliberately hand-rolled rather than a dependency: it is a dozen lines, and
    API keys should not arrive through a package we have not read. Existing
    environment variables always win, so a shell export overrides the file.
    """
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


_load_env()

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://studymate:studymate@localhost:55432/studymate",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Additive migrations
# ---------------------------------------------------------------------------

# `Base.metadata.create_all` creates MISSING TABLES but never alters an existing
# one, so a column added to a model after the table was first created is simply
# absent at runtime — and the failure surfaces as a query error on an unrelated
# request, a long way from the model change that caused it.
#
# This is not a migration framework and does not want to be. It handles the one
# case that keeps biting: adding a nullable column. Anything structural (a
# rename, a type change, a constraint) should be a real migration.
ADDED_COLUMNS: list[tuple[str, str, str]] = [
    # (table, column, DDL type)
    ("questions", "explanation_gu", "TEXT"),
    ("questions", "passage_en", "TEXT"),
    ("questions", "passage_hi", "TEXT"),
]

# Widening a varchar is safe in Postgres — no rewrite, no data loss — so it is
# handled here alongside additions. Narrowing is NOT, and is deliberately not
# supported: it would silently truncate stored values.
WIDENED_COLUMNS: list[tuple[str, str, int]] = [
    # `actor` records the full provenance chain of a generated explanation,
    # e.g. "batch:two_stage:nvidia/nemotron-3-super-120b-a12b -> sarvam/
    # sarvam-105b-conversations". At 64 characters that did not fit and the
    # whole write failed. The chain is the point, so the column grew.
    ("audits", "actor", 200),
]


def migrate() -> None:
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, column, ddl in ADDED_COLUMNS:
            if table not in existing_tables:
                continue  # create_all will build it complete
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column in cols:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            print(f"[migrate] {table}.{column} added")

        for table, column, width in WIDENED_COLUMNS:
            if table not in existing_tables:
                continue
            current = next(
                (c for c in inspector.get_columns(table) if c["name"] == column), None
            )
            if current is None:
                continue
            length = getattr(current["type"], "length", None)
            if length is not None and length < width:
                conn.execute(
                    text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR({width})")
                )
                print(f"[migrate] {table}.{column} widened {length} -> {width}")
