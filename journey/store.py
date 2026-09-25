from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .models import Journey

_SCHEMA = """
CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    updated_at REAL NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS illustrations (
    journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    step INTEGER NOT NULL,
    svg TEXT NOT NULL,
    PRIMARY KEY (journey_id, step)
);
"""


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        with self._db() as db:
            db.executescript(_SCHEMA)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path)
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def save(self, journey: Journey) -> None:
        with self._db() as db:
            db.execute(
                "INSERT INTO journeys (id, updated_at, data) VALUES (?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data",
                (journey.id, journey.updated_at, journey.model_dump_json()),
            )

    def get(self, journey_id: str) -> Journey | None:
        with self._db() as db:
            row = db.execute("SELECT data FROM journeys WHERE id = ?", (journey_id,)).fetchone()
        return Journey.model_validate_json(row[0]) if row else None

    def list(self) -> list[Journey]:
        with self._db() as db:
            rows = db.execute("SELECT data FROM journeys ORDER BY updated_at DESC").fetchall()
        return [Journey.model_validate_json(r[0]) for r in rows]

    def delete(self, journey_id: str) -> bool:
        with self._db() as db:
            return db.execute("DELETE FROM journeys WHERE id = ?", (journey_id,)).rowcount > 0

    def get_illustration(self, journey_id: str, step: int) -> str | None:
        with self._db() as db:
            row = db.execute(
                "SELECT svg FROM illustrations WHERE journey_id = ? AND step = ?", (journey_id, step)
            ).fetchone()
        return row[0] if row else None

    def save_illustration(self, journey_id: str, step: int, svg: str) -> None:
        with self._db() as db:
            db.execute(
                "INSERT OR REPLACE INTO illustrations (journey_id, step, svg) VALUES (?, ?, ?)",
                (journey_id, step, svg),
            )

    def copy_illustrations(self, src: str, dst: str, up_to_step: int) -> None:
        with self._db() as db:
            db.execute(
                "INSERT OR REPLACE INTO illustrations (journey_id, step, svg) "
                "SELECT ?, step, svg FROM illustrations WHERE journey_id = ? AND step <= ?",
                (dst, src, up_to_step),
            )
