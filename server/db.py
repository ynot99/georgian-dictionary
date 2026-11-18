"""SQLite: з'єднання, схема, спільні хелпери. Використовується всіма модулями."""
import sqlite3
import uuid as uuidlib
from datetime import datetime, timedelta, timezone
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
        # міграція старої бази без позначки "важлива нотатка"
        note_cols = [row[1] for row in db.execute("PRAGMA table_info(grammar_notes)")]
        if "starred" not in note_cols:
            db.execute("ALTER TABLE grammar_notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0")
        # прогрес повторення нотаток (SRS, ті самі інтервали, що й слова);
        # лише сервер — на відміну від words/reviews офлайн-копії тут немає
        db.execute("""
            CREATE TABLE IF NOT EXISTS note_reviews (
                note_id INTEGER PRIMARY KEY,
                level INTEGER NOT NULL DEFAULT 0,
                due_at TEXT NOT NULL,
                reviewed_at TEXT NOT NULL
            )
        """)
        # журнал викликів інструментів чату (add_word/edit_word/тощо) — короткий
        # підсумок для дзвіночка в чаті, повний вхід/вихід про запас на випадок
        # питань "а що саме там сталось" (напр. діагностика обірваної відповіді)
        db.execute("""
            CREATE TABLE IF NOT EXISTS tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT NOT NULL,
                summary TEXT NOT NULL,
                ok INTEGER NOT NULL,
                input_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        # вправи на реченнях: у sentence пропуск ____, answer — змінена форма слова;
        # унікальний індекс робить повторне додавання тих самих речень безпечним
        db.execute("""
            CREATE TABLE IF NOT EXISTS sentences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word_uuid TEXT NOT NULL,
                sentence TEXT NOT NULL,
                answer TEXT NOT NULL,
                translation TEXT NOT NULL,
                hint TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sentences_word_sentence "
            "ON sentences(word_uuid, sentence)"
        )
        # довідник: слова, яких ще немає у вивченні; forms — відмінкові й інші
        # форми через пробіл, щоб упізнати слово, записане в словнику іншою формою
        db.execute("""
            CREATE TABLE IF NOT EXISTS catalog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                georgian TEXT NOT NULL,
                pos TEXT NOT NULL DEFAULT '',
                translation TEXT NOT NULL,
                gloss TEXT NOT NULL DEFAULT '',
                forms TEXT NOT NULL DEFAULT '',
                rank INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
        """)
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_georgian_pos "
            "ON catalog(georgian, pos)"
        )
        # відкладені слова: окремо від words, бо слова синхронізуються лише як
        # нові (INSERT OR IGNORE), а позначку треба міняти й офлайн. Рядок із
        # suspended = 0 не видаляється — так повернення теж перемагає за changed_at
        db.execute("""
            CREATE TABLE IF NOT EXISTS suspensions (
                word_uuid TEXT PRIMARY KEY,
                suspended INTEGER NOT NULL,
                changed_at TEXT NOT NULL
            )
        """)


def utcnow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def due_date_str(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


# зарезервовані для вбудованих чипів у панелі тегів ("усі", "🩹 проблемні",
# "⏸ відкладені") — звичайним тегом стати не можуть (дублює логіку
# RESERVED_TAGS у static/js/store.js)
RESERVED_TAGS = {"усі", "проблемні", "відкладені"}


def normalize_tags(raw):
    """'їжа, Дієслова,їжа' → 'їжа, дієслова' — трім, нижній регістр, без дублів
    і без зарезервованих слів."""
    seen = []
    for tag in (raw or "").split(","):
        tag = tag.strip().lower()
        if tag and tag not in RESERVED_TAGS and tag not in seen:
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


def suspension_dict(row):
    return {
        "word_uuid": row["word_uuid"],
        "suspended": bool(row["suspended"]),
        "changed_at": row["changed_at"],
    }


def sentence_dict(row):
    return {
        "id": row["id"],
        "word_uuid": row["word_uuid"],
        "sentence": row["sentence"],
        "answer": row["answer"],
        "translation": row["translation"],
        "hint": row["hint"],
    }
