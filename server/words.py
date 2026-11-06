"""Основний словник: слова, синхронізація, теги, CSV-імпорт/експорт."""
import csv
import io
import uuid as uuidlib
from datetime import datetime

from flask import Blueprint, Response, redirect, render_template, request, url_for

from .db import get_db, normalize_tags, review_dict, sentence_dict, utcnow, word_dict

words_bp = Blueprint("words", __name__)

SENTENCE_BLANK = "____"


@words_bp.route("/api/words")
def api_words():
    rows = get_db().execute("SELECT * FROM words ORDER BY id DESC").fetchall()
    return {"words": [word_dict(r) for r in rows]}


@words_bp.route("/api/sync", methods=["POST"])
def api_sync():
    """Приймає несинхронізовані слова і прогрес повторень, повертає повний стан.

    Слова: дедуплікація по uuid (INSERT OR IGNORE).
    Повторення: last-write-wins по reviewed_at — новіша оцінка перекриває старішу.
    """
    payload = request.get_json(silent=True) or {}
    db = get_db()
    for w in payload.get("words", []):
        georgian = (w.get("georgian") or "").strip()
        translation = (w.get("translation") or "").strip()
        if not (georgian and translation):
            continue
        db.execute(
            "INSERT OR IGNORE INTO words (uuid, georgian, translation, example, "
            "tags, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (
                (w.get("uuid") or "").strip() or str(uuidlib.uuid4()),
                georgian,
                translation,
                (w.get("example") or "").strip(),
                normalize_tags(w.get("tags")),
                (w.get("created_at") or "").strip() or utcnow(),
            ),
        )
    for r in payload.get("reviews", []):
        word_uuid = (r.get("word_uuid") or "").strip()
        direction = r.get("direction")
        due_at = (r.get("due_at") or "").strip()
        reviewed_at = (r.get("reviewed_at") or "").strip()
        if direction not in ("ka2uk", "uk2ka") or not (
            word_uuid and due_at and reviewed_at
        ):
            continue
        word_exists = db.execute(
            "SELECT 1 FROM words WHERE uuid = ?", (word_uuid,)
        ).fetchone()
        if not word_exists:
            continue
        existing = db.execute(
            "SELECT reviewed_at FROM reviews WHERE word_uuid = ? AND direction = ?",
            (word_uuid, direction),
        ).fetchone()
        if existing is None or reviewed_at > existing["reviewed_at"]:
            db.execute(
                "INSERT OR REPLACE INTO reviews (word_uuid, direction, level, "
                "due_at, reviewed_at, lapses) VALUES (?, ?, ?, ?, ?, ?)",
                (word_uuid, direction, int(r.get("level") or 0), due_at, reviewed_at,
                 int(r.get("lapses") or 0)),
            )
    db.commit()
    words = db.execute("SELECT * FROM words ORDER BY id DESC").fetchall()
    reviews = db.execute("SELECT * FROM reviews").fetchall()
    sentences = db.execute("SELECT * FROM sentences ORDER BY id").fetchall()
    return {
        "words": [word_dict(r) for r in words],
        "reviews": [review_dict(r) for r in reviews],
        "sentences": [sentence_dict(r) for r in sentences],
    }


@words_bp.route("/api/sentences")
def api_sentences():
    rows = get_db().execute("SELECT * FROM sentences ORDER BY id").fetchall()
    return {"sentences": [sentence_dict(r) for r in rows]}


@words_bp.route("/api/sentences", methods=["POST"])
def api_sentences_add():
    """Додає вправи на реченнях. Рядок без обов'язкових полів, без рівно одного
    пропуску ____ чи з невідомим word_uuid не вставляється — його індекс
    повертається в invalid, решта рядків однаково додаються.
    """
    payload = request.get_json(silent=True) or {}
    db = get_db()
    created = duplicates = 0
    invalid = []
    for index, row in enumerate(payload.get("sentences", [])):
        word_uuid = (row.get("word_uuid") or "").strip()
        sentence = (row.get("sentence") or "").strip()
        answer = (row.get("answer") or "").strip()
        translation = (row.get("translation") or "").strip()
        word_exists = db.execute(
            "SELECT 1 FROM words WHERE uuid = ?", (word_uuid,)
        ).fetchone()
        if (
            not (word_exists and answer and translation)
            or sentence.count(SENTENCE_BLANK) != 1
        ):
            invalid.append(index)
            continue
        cursor = db.execute(
            "INSERT OR IGNORE INTO sentences (word_uuid, sentence, answer, "
            "translation, hint, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (word_uuid, sentence, answer, translation,
             (row.get("hint") or "").strip(), utcnow()),
        )
        if cursor.rowcount:
            created += 1
        else:
            duplicates += 1
    db.commit()
    return {"created": created, "duplicates": duplicates, "invalid": invalid}


@words_bp.route("/api/sentences/<int:sentence_id>", methods=["DELETE"])
def api_sentences_delete(sentence_id):
    db = get_db()
    db.execute("DELETE FROM sentences WHERE id = ?", (sentence_id,))
    db.commit()
    return {"ok": True}


@words_bp.route("/api/import", methods=["POST"])
def api_import():
    """Імпорт CSV-рядків (розпарсених клієнтом у JSON) після AI-перевірки.

    Рядок з відомим uuid оновлює наявне слово. Якщо uuid порожній/невідомий
    (AI інколи ламає цю колонку) — захисна сітка: якщо в базі рівно одне слово
    з таким самим грузинським написанням, оновлюємо його замість створення
    дубліката. Інакше — нове слово. Порожні georgian/translation — пропуск.
    """
    payload = request.get_json(silent=True) or {}
    db = get_db()
    updated = created = unchanged = skipped = 0
    for row in payload.get("words", []):
        georgian = (row.get("georgian") or "").strip()
        translation = (row.get("translation") or "").strip()
        example = (row.get("example") or "").strip()
        tags = normalize_tags(row.get("tags"))
        if not (georgian and translation):
            skipped += 1
            continue
        word_uuid = (row.get("uuid") or "").strip()
        existing = None
        if word_uuid:
            existing = db.execute(
                "SELECT * FROM words WHERE uuid = ?", (word_uuid,)
            ).fetchone()
        if existing is None:
            same_georgian = db.execute(
                "SELECT * FROM words WHERE georgian = ?", (georgian,)
            ).fetchall()
            if len(same_georgian) == 1:
                existing = same_georgian[0]
        if existing is not None:
            if (
                existing["georgian"] == georgian
                and existing["translation"] == translation
                and existing["example"] == example
                and existing["tags"] == tags
            ):
                unchanged += 1
            else:
                db.execute(
                    "UPDATE words SET georgian = ?, translation = ?, example = ?, "
                    "tags = ? WHERE uuid = ?",
                    (georgian, translation, example, tags, existing["uuid"]),
                )
                updated += 1
        else:
            db.execute(
                "INSERT INTO words (uuid, georgian, translation, example, tags, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    word_uuid or str(uuidlib.uuid4()),
                    georgian,
                    translation,
                    example,
                    tags,
                    (row.get("created_at") or "").strip() or utcnow(),
                ),
            )
            created += 1
    db.commit()
    return {
        "updated": updated,
        "created": created,
        "unchanged": unchanged,
        "skipped": skipped,
    }


@words_bp.route("/api/words/<word_uuid>", methods=["DELETE"])
def api_delete(word_uuid):
    db = get_db()
    db.execute("DELETE FROM words WHERE uuid = ?", (word_uuid,))
    db.execute("DELETE FROM reviews WHERE word_uuid = ?", (word_uuid,))
    db.execute("DELETE FROM sentences WHERE word_uuid = ?", (word_uuid,))
    db.commit()
    return {"ok": True}


@words_bp.route("/api/tags/rename", methods=["POST"])
def api_tags_rename():
    """Перейменовує тег у всіх словах, де він зустрічається (напр. виправити одруківку).

    Порівняння точне, по токену (не по підрядку) — SQL LIKE лише швидкий
    попередній відбір кандидатів, остаточну перевірку робимо по розбитому
    списку тегів, тож тег "їжа" не зачепить "їжа2".
    """
    payload = request.get_json(silent=True) or {}
    old_tag = normalize_tags(payload.get("old"))
    new_tag = normalize_tags(payload.get("new"))
    if not old_tag or not new_tag or old_tag == new_tag:
        return {"updated": 0}
    db = get_db()
    rows = db.execute(
        "SELECT uuid, tags FROM words WHERE tags = ? OR tags LIKE ? OR tags LIKE ? "
        "OR tags LIKE ?",
        (old_tag, f"{old_tag}, %", f"%, {old_tag}", f"%, {old_tag}, %"),
    ).fetchall()
    updated = 0
    for row in rows:
        tokens = [t.strip() for t in row["tags"].split(",") if t.strip()]
        if old_tag not in tokens:
            continue
        new_tokens = [new_tag if t == old_tag else t for t in tokens]
        db.execute(
            "UPDATE words SET tags = ? WHERE uuid = ?",
            (normalize_tags(", ".join(new_tokens)), row["uuid"]),
        )
        updated += 1
    db.commit()
    return {"updated": updated}


@words_bp.route("/api/tags/delete", methods=["POST"])
def api_tags_delete():
    """Прибирає тег з усіх слів, де він зустрічається — без заміни на інший
    (сам тег зникає з панелі, слова лишаються). Порівняння точне, по токену —
    той самий підхід, що й у /api/tags/rename.
    """
    payload = request.get_json(silent=True) or {}
    tag = normalize_tags(payload.get("tag"))
    if not tag:
        return {"deleted": 0}
    db = get_db()
    rows = db.execute(
        "SELECT uuid, tags FROM words WHERE tags = ? OR tags LIKE ? OR tags LIKE ? "
        "OR tags LIKE ?",
        (tag, f"{tag}, %", f"%, {tag}", f"%, {tag}, %"),
    ).fetchall()
    deleted = 0
    for row in rows:
        tokens = [t.strip() for t in row["tags"].split(",") if t.strip()]
        if tag not in tokens:
            continue
        remaining = [t for t in tokens if t != tag]
        db.execute(
            "UPDATE words SET tags = ? WHERE uuid = ?",
            (normalize_tags(", ".join(remaining)), row["uuid"]),
        )
        deleted += 1
    db.commit()
    return {"deleted": deleted}


@words_bp.route("/edit/<int:word_id>", methods=["GET", "POST"])
def edit(word_id):
    db = get_db()
    word = db.execute("SELECT * FROM words WHERE id = ?", (word_id,)).fetchone()
    if word is None:
        return redirect(url_for("index"))
    if request.method == "POST":
        georgian = request.form.get("georgian", "").strip()
        translation = request.form.get("translation", "").strip()
        example = request.form.get("example", "").strip()
        tags = normalize_tags(request.form.get("tags", ""))
        if georgian and translation:
            db.execute(
                "UPDATE words SET georgian = ?, translation = ?, example = ?, "
                "tags = ? WHERE id = ?",
                (georgian, translation, example, tags, word_id),
            )
            db.commit()
        return redirect(url_for("index"))
    return render_template("edit.html", word=word)


@words_bp.route("/export.csv")
def export_csv():
    db = get_db()
    rows = db.execute(
        "SELECT uuid, georgian, translation, example, tags, created_at "
        "FROM words ORDER BY id"
    ).fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    # uuid потрібен, щоб імпорт міг оновити саме це слово, а не створити дублікат
    writer.writerow(
        ["uuid", "georgian", "translation", "example", "tags", "created_at"]
    )
    for row in rows:
        writer.writerow(
            [
                row["uuid"],
                row["georgian"],
                row["translation"],
                row["example"],
                row["tags"],
                row["created_at"],
            ]
        )
    # BOM, щоб Excel коректно відкривав UTF-8
    data = "﻿" + buf.getvalue()
    filename = f"dictionary-{datetime.now().strftime('%Y-%m-%d')}.csv"
    return Response(
        data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
