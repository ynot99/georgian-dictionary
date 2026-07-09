"""SQLite: з'єднання, схема, спільні хелпери. Використовується всіма модулями."""
import sqlite3
import uuid as uuidlib
from datetime import datetime, timezone
from pathlib import Path

from flask import g

BASE_DIR = Path(__file__).parent.parent
DB_PATH = BASE_DIR / "dictionary.db"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT,
                georgian TEXT NOT NULL,
                translation TEXT NOT NULL,
                example TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        # міграція старої бази без колонки uuid
        cols = [row[1] for row in db.execute("PRAGMA table_info(words)")]
        if "uuid" not in cols:
            db.execute("ALTER TABLE words ADD COLUMN uuid TEXT")
        if "tags" not in cols:
            db.execute("ALTER TABLE words ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
        for (word_id,) in db.execute(
            "SELECT id FROM words WHERE uuid IS NULL OR uuid = ''"
        ).fetchall():
            db.execute(
                "UPDATE words SET uuid = ? WHERE id = ?",
                (str(uuidlib.uuid4()), word_id),
            )
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_words_uuid ON words(uuid)")
        # прогрес SRS-повторень: одна картка = слово + напрямок (ka2uk / uk2ka)
        db.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                word_uuid TEXT NOT NULL,
                direction TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 0,
                due_at TEXT NOT NULL,
                reviewed_at TEXT NOT NULL,
                lapses INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (word_uuid, direction)
            )
        """)
        # міграція старої бази без лічильника провалів (leech-позначка)
        review_cols = [row[1] for row in db.execute("PRAGMA table_info(reviews)")]
        if "lapses" not in review_cols:
            db.execute("ALTER TABLE reviews ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0")
        # історія чату з репетитором (одна розмова, один користувач)
        db.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        # нотатки з граматики, які репетитор створює по ходу розмови
        db.execute("""
            CREATE TABLE IF NOT EXISTS grammar_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)


def utcnow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def normalize_tags(raw):
    """'їжа, Дієслова,їжа' → 'їжа, дієслова' — трім, нижній регістр, без дублів."""
    seen = []
    for tag in (raw or "").split(","):
        tag = tag.strip().lower()
        if tag and tag not in seen:
            seen.append(tag)
    return ", ".join(seen)


def word_dict(row):
    return {
        "id": row["id"],
        "uuid": row["uuid"],
        "georgian": row["georgian"],
        "translation": row["translation"],
        "example": row["example"],
        "tags": row["tags"],
        "created_at": row["created_at"],
    }


def review_dict(row):
    return {
        "word_uuid": row["word_uuid"],
        "direction": row["direction"],
        "level": row["level"],
        "due_at": row["due_at"],
        "reviewed_at": row["reviewed_at"],
        "lapses": row["lapses"],
    }
