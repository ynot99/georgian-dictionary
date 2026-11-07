"""Довідник: велика база слів, з якої слово додається у вивчення одним тапом."""
from flask import Blueprint, request

from .db import get_db, utcnow

catalog_bp = Blueprint("catalog", __name__)


def catalog_entry_dict(row):
    return {
        "id": row["id"],
        "georgian": row["georgian"],
        "pos": row["pos"],
        "translation": row["translation"],
        "gloss": row["gloss"],
        "forms": row["forms"],
        "rank": row["rank"],
    }


def catalog_version(db):
    """Змінюється при будь-якому додаванні, оновленні чи видаленні запису —
    клієнт перекачує довідник лише тоді, коли версія інша, а не на кожен sync."""
    count, last = db.execute(
        "SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM catalog"
    ).fetchone()
    return f"{count}:{last}"


@catalog_bp.route("/api/catalog")
def api_catalog():
    db = get_db()
    rows = db.execute("SELECT * FROM catalog ORDER BY rank, id").fetchall()
    return {"version": catalog_version(db), "entries": [catalog_entry_dict(r) for r in rows]}


@catalog_bp.route("/api/catalog", methods=["POST"])
def api_catalog_upsert():
    """Додає або оновлює записи довідника; ключ — пара (georgian, pos).
    Рядок без georgian чи translation не вставляється, його індекс повертається
    в invalid."""
    payload = request.get_json(silent=True) or {}
    db = get_db()
    created = updated = 0
    invalid = []
    now = utcnow()
    for index, row in enumerate(payload.get("entries", [])):
        georgian = (row.get("georgian") or "").strip()
        translation = (row.get("translation") or "").strip()
        if not (georgian and translation):
            invalid.append(index)
            continue
        pos = (row.get("pos") or "").strip()
        exists = db.execute(
            "SELECT 1 FROM catalog WHERE georgian = ? AND pos = ?", (georgian, pos)
        ).fetchone()
        db.execute(
            "INSERT INTO catalog (georgian, pos, translation, gloss, forms, rank, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(georgian, pos) DO UPDATE SET translation = excluded.translation, "
            "gloss = excluded.gloss, forms = excluded.forms, rank = excluded.rank, "
            "updated_at = excluded.updated_at",
            (
                georgian, pos, translation,
                (row.get("gloss") or "").strip(),
                " ".join((row.get("forms") or "").split()),
                int(row.get("rank") or 0),
                now,
            ),
        )
        if exists:
            updated += 1
        else:
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "invalid": invalid}


@catalog_bp.route("/api/catalog/<int:entry_id>", methods=["DELETE"])
def api_catalog_delete(entry_id):
    db = get_db()
    db.execute("DELETE FROM catalog WHERE id = ?", (entry_id,))
    db.commit()
    return {"ok": True}
