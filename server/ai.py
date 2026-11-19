"""Вправи від дешевої моделі через OpenRouter.

Не агент з інструментами, як чат: слова й режим обирає застосунок, а модель
робить один запит за фіксованою інструкцією і повертає JSON за схемою. Так
дешевше (без циклу викликів), передбачуваніше, а відповідь можна перевірити
кодом. Кожна вправа зберігається в ai_exercises: дешеві моделі помиляються в
грузинській, тож вправу можна виправити, видалити чи позначити як перевірену.
"""
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.request

from flask import Blueprint, request

from .chat import load_env
from .db import BASE_DIR, get_db, utcnow

ai_bp = Blueprint("ai", __name__)

logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.FileHandler(BASE_DIR / "ai_errors.log", encoding="utf-8")
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.ERROR)

load_env()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
AI_TIMEOUT_S = 60
AI_EXERCISES_PER_CALL = 5   # більше слів за раз — довша відповідь і більше шансів на помилку
AI_ATTEMPTS = 2             # повтор лише на незрозумілу відповідь, не на помилку API

MODE_TRANSLATE = "translate_uk_ka"
AI_MODES = {MODE_TRANSLATE}
REVIEW_VALUES = {"", "ok", "bad"}

GEORGIAN_RE = re.compile(r"[ა-ჿ]")
CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")

# Одна генерація за раз: подвійний тап по ➕ не має платити двічі
_ai_lock = threading.Lock()

TRANSLATE_SYSTEM = """Ти складаєш вправи на переклад з української на грузинську для учня рівня A1–A2.

Для кожного слова зі списку склади одну вправу:
- uk: коротке природне речення українською (4–8 слів) на побутову тему;
- ka: еталонний переклад грузинською, де це слово вжито в потрібній формі (відмінок, особа, час);
- hint: одне речення українською про граматику еталона: який відмінок, післялог чи форма дієслова тут потрібні і чому. Не перекладай у підказці все речення.

Правила:
- Граматика проста: теперішній час, звичайний минулий чи майбутній, прості відмінки й післялоги.
- Якщо не впевнений у формі слова чи конструкції, обери простіше речення, у якому впевнений. Точність важливіша за різноманітність.
- Решта слів у реченні — найуживаніші, без рідкісної лексики.
- word — точно той id, що в списку.

Відповідай лише JSON за схемою."""

EXERCISES_SCHEMA = {
    "type": "object",
    "properties": {
        "exercises": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "uk": {"type": "string"},
                    "ka": {"type": "string"},
                    "hint": {"type": "string"},
                },
                "required": ["word", "uk", "ka", "hint"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["exercises"],
    "additionalProperties": False,
}


class AiError(Exception):
    """Помилка, яку можна показати учню як є."""


def ai_config():
    """Читається при кожному запиті, а не при імпорті — тести підставляють свої значення."""
    return (
        os.environ.get("OPENROUTER_API_KEY", "").strip(),
        os.environ.get("OPENROUTER_MODEL", "").strip(),
    )


def call_openrouter(messages, model, api_key):
    """Один запит до OpenRouter → (текст відповіді, meta). Тести підміняють цю
    функцію: справжній API вони не викликають, бо це платно."""
    body = {
        "model": model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "exercises", "strict": True, "schema": EXERCISES_SCHEMA},
        },
        "usage": {"include": True},   # щоб відповідь містила вартість виклику
    }
    req = urllib.request.Request(
        OPENROUTER_URL, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=AI_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read().decode("utf-8"))["error"]["message"]
        except Exception:
            message = e.reason
        if e.code == 401:
            raise AiError("OpenRouter не прийняв ключ — перевір OPENROUTER_API_KEY у .env.")
        if e.code == 402:
            raise AiError("На OpenRouter закінчились кредити.")
        raise AiError(f"OpenRouter повернув помилку {e.code}: {message}")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise AiError(f"Немає з'єднання з OpenRouter ({e}).")
    # OpenRouter інколи повертає помилку провайдера з кодом 200
    if "error" in data:
        raise AiError(f"Модель повернула помилку: {data['error'].get('message', data['error'])}")
    usage = data.get("usage") or {}
    meta = {
        "model": data.get("model") or model,
        "cost": usage.get("cost"),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
    }
    return data["choices"][0]["message"]["content"], meta


def parse_exercises(content, word_ids):
    """Текст відповіді → список придатних вправ. Непридатні (чужий id, порожнє
    поле, еталон не грузинською) відкидаються поодинці, а не валять усю відповідь."""
    text = (content or "").strip()
    # частина моделей ігнорує response_format і загортає JSON у ```json … ```
    match = re.search(r"\{.*\}", text, re.S)
    data = json.loads(match.group(0) if match else text)
    items = data.get("exercises") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("у відповіді немає списку exercises")
    valid, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        word = item.get("word")
        uk = str(item.get("uk") or "").strip()
        ka = str(item.get("ka") or "").strip()
        hint = str(item.get("hint") or "").strip()
        if word not in word_ids or word in seen:
            continue
        if not CYRILLIC_RE.search(uk) or not GEORGIAN_RE.search(ka) or CYRILLIC_RE.search(ka):
            continue
        seen.add(word)
        valid.append({"word": word, "uk": uk, "ka": ka, "hint": hint})
    return valid


def _log_call(db, mode, meta, ok, error=""):
    db.execute(
        "INSERT INTO ai_calls (mode, model, ok, cost, prompt_tokens, completion_tokens, "
        "error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (mode, meta.get("model", ""), int(ok), meta.get("cost"), meta.get("prompt_tokens"),
         meta.get("completion_tokens"), error, utcnow()),
    )
    db.commit()   # навіть якщо далі щось впаде, витрачене має лишитись у журналі


def _generate(db, mode, rows, model, api_key):
    """Слова → (вправи, meta). Короткі id (w1, w2…) замість uuid: модель їх не
    перекрутить, і токенів менше."""
    by_id = {f"w{i}": row for i, row in enumerate(rows, 1)}
    listing = []
    for word_id, row in by_id.items():
        entry = {"word": word_id, "georgian": row["georgian"], "translation": row["translation"]}
        if row["example"]:
            entry["example"] = row["example"]
        listing.append(entry)
    messages = [
        {"role": "system", "content": TRANSLATE_SYSTEM},
        {"role": "user", "content": json.dumps(listing, ensure_ascii=False)},
    ]
    error = ""
    for _ in range(AI_ATTEMPTS):
        meta = {"model": model}
        content = ""
        try:
            content, meta = call_openrouter(messages, model, api_key)
            items = parse_exercises(content, by_id)
        except AiError as e:
            _log_call(db, mode, meta, False, str(e))
            logger.error("OpenRouter: %s", e)
            raise
        except (ValueError, KeyError, TypeError, IndexError) as e:
            error = f"Незрозуміла відповідь моделі ({e})."
            _log_call(db, mode, meta, False, error)
            logger.error("%s\n%s", error, content)
            continue
        if items:
            _log_call(db, mode, meta, True)
            return [(by_id[i["word"]], i) for i in items], meta
        error = "Модель не повернула жодної придатної вправи."
        _log_call(db, mode, meta, False, error)
    raise AiError(error)


def exercise_dict(row):
    return {
        "id": row["id"],
        "word_uuid": row["word_uuid"],
        "georgian": row["georgian"] or "",
        "translation": row["translation"] or "",
        "mode": row["mode"],
        "question": row["question"],
        "answer": row["answer"],
        "hint": row["hint"],
        "model": row["model"],
        "review": row["review"],
        "review_note": row["review_note"],
        "flagged": bool(row["flagged"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _select_exercises(db, where="", params=()):
    return db.execute(
        "SELECT e.*, w.georgian, w.translation FROM ai_exercises e "
        f"LEFT JOIN words w ON w.uuid = e.word_uuid {where} ORDER BY e.id DESC",
        params,
    ).fetchall()


@ai_bp.route("/api/ai/exercises")
def api_ai_exercises():
    db = get_db()
    api_key, model = ai_config()
    spent = db.execute("SELECT COALESCE(SUM(cost), 0) FROM ai_calls").fetchone()[0]
    return {
        "exercises": [exercise_dict(r) for r in _select_exercises(db)],
        "enabled": bool(api_key and model),
        "model": model,
        "spent": spent,
    }


@ai_bp.route("/api/ai/exercises/generate", methods=["POST"])
def api_ai_generate():
    api_key, model = ai_config()
    if not api_key or not model:
        return {"error": "Генерація вимкнена: додай OPENROUTER_API_KEY і OPENROUTER_MODEL "
                         "у .env і перезапусти сервер."}, 503
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode", MODE_TRANSLATE)
    if mode not in AI_MODES:
        return {"error": "Невідомий режим вправи."}, 400
    uuids = payload.get("word_uuids")
    if not isinstance(uuids, list):
        return {"error": "Потрібен список word_uuids."}, 400
    uuids = [u for u in dict.fromkeys(uuids) if isinstance(u, str)][:AI_EXERCISES_PER_CALL]
    if not uuids:
        return {"error": "Немає слів для вправ."}, 400
    db = get_db()
    rows = db.execute(
        "SELECT uuid, georgian, translation, example FROM words "
        f"WHERE uuid IN ({', '.join('?' * len(uuids))})",
        uuids,
    ).fetchall()
    if not rows:
        return {"error": "Цих слів ще немає на сервері — спершу синхронізуй."}, 400
    if not _ai_lock.acquire(blocking=False):
        return {"error": "Уже генерую вправи — зачекай."}, 409
    try:
        generated, meta = _generate(db, mode, rows, model, api_key)
    except AiError as e:
        return {"error": str(e)}, 502
    finally:
        _ai_lock.release()
    now = utcnow()
    ids = []
    for word, item in generated:
        cur = db.execute(
            "INSERT INTO ai_exercises (word_uuid, mode, question, answer, hint, model, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (word["uuid"], mode, item["uk"], item["ka"], item["hint"], meta["model"], now, now),
        )
        ids.append(cur.lastrowid)
    db.commit()
    rows = _select_exercises(db, f"WHERE e.id IN ({', '.join('?' * len(ids))})", ids)
    return {
        "exercises": [exercise_dict(r) for r in rows],
        "model": meta["model"],
        "cost": meta.get("cost"),
        "skipped": len(uuids) - len(ids),
    }


@ai_bp.route("/api/ai/exercises/<int:exercise_id>", methods=["PATCH"])
def api_ai_exercise_edit(exercise_id):
    """Редагування тексту (учень), позначка ⚠️ (учень) і перевірка (review:
    '' / 'ok' / 'bad' з коментарем review_note — її ставить Claude Code)."""
    db = get_db()
    row = db.execute("SELECT * FROM ai_exercises WHERE id = ?", (exercise_id,)).fetchone()
    if row is None:
        return {"error": "вправу не знайдено"}, 404
    payload = request.get_json(silent=True) or {}
    updates = {}
    for field in ("question", "answer", "hint"):
        if field in payload:
            value = str(payload[field] or "").strip()
            if field != "hint" and not value:
                return {"error": "Речення й еталон не можуть бути порожніми."}, 400
            updates[field] = value
    text_changed = any(updates[f] != row[f] for f in updates)
    if "flagged" in payload:
        updates["flagged"] = int(bool(payload["flagged"]))
    if "review" in payload:
        if payload["review"] not in REVIEW_VALUES:
            return {"error": "review має бути '', 'ok' або 'bad'."}, 400
        updates["review"] = payload["review"]
        updates["review_note"] = str(payload.get("review_note") or "").strip()
    elif text_changed:
        # перевірка й позначка стосувались старого тексту
        updates["review"] = ""
        updates["review_note"] = ""
        updates.setdefault("flagged", 0)
    if updates:
        updates["updated_at"] = utcnow()
        db.execute(
            f"UPDATE ai_exercises SET {', '.join(f'{k} = ?' for k in updates)} WHERE id = ?",
            (*updates.values(), exercise_id),
        )
        db.commit()
    return exercise_dict(_select_exercises(db, "WHERE e.id = ?", (exercise_id,))[0])


@ai_bp.route("/api/ai/exercises/<int:exercise_id>", methods=["DELETE"])
def api_ai_exercise_delete(exercise_id):
    db = get_db()
    db.execute("DELETE FROM ai_exercises WHERE id = ?", (exercise_id,))
    db.commit()
    return {"ok": True}
