"""Чат з репетитором (Claude): tool use, системний промпт, нотатки з граматики."""
import json
import logging
import os
import queue
import sqlite3
import threading
import uuid as uuidlib

from flask import Blueprint, Response, request

from .db import BASE_DIR, DB_PATH, due_date_str, get_db, normalize_tags, utcnow

# Помилки чату (виконання інструментів, збій API, обрив стріму) — окремий файл,
# щоб не губились у виводі консолі, яку ніхто не тримає відкритою постійно.
logger = logging.getLogger(__name__)
if not logger.handlers:
    _handler = logging.FileHandler(BASE_DIR / "chat_errors.log", encoding="utf-8")
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.ERROR)

# Генерація відповіді йде у фоновому потоці, не в HTTP-генераторі — якщо
# клієнт розірве з'єднання (згорнув вкладку, заблокував телефон), відповідь
# однаково довариться до кінця і збережеться. Лок — один користувач, один чат
# за раз; без нього паралельний другий запит переплутав би порядок повідомлень
# у chat_messages (і платив би за другий виклик Claude одночасно з першим).
_chat_lock = threading.Lock()


def load_env():
    """Мінімальний завантажувач .env — без залежності від python-dotenv."""
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    # utf-8-sig: Блокнот і PowerShell на Windows пишуть BOM — з'їдаємо його
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_env()

try:
    import anthropic

    _chat_client = (
        anthropic.Anthropic() if os.environ.get("ANTHROPIC_API_KEY") else None
    )
except ImportError:
    anthropic = None
    _chat_client = None

CHAT_MODEL = "claude-sonnet-5"
CHAT_MAX_TOKENS = 2048
CHAT_HISTORY_LIMIT = 30  # скільки останніх повідомлень відправляти моделі
CHAT_TOOL_LOOP_LIMIT = 5  # запобіжник від зациклення викликів інструментів
CHAT_VOCAB_LIMIT = 300  # межа слів у промпті, щоб контекст не роздувався
CHAT_NOTES_TITLE_LIMIT = 100  # межа заголовків нотаток у промпті
NOTE_INTERVALS = [1, 3, 7, 14, 30, 60, 120]  # ті самі інтервали (дні), що й для слів

ADD_WORD_TOOL = {
    "name": "add_word",
    "description": (
        "Додає нове грузинське слово в словник учня з перекладом. Використовуй, "
        "коли учень явно просить додати/запам'ятати слово, або коли в розмові "
        "з'являється корисне нове слово і учень погоджується його зберегти."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "georgian": {"type": "string", "description": "Слово чи фраза грузинською"},
            "translation": {"type": "string", "description": "Переклад українською"},
            "example": {
                "type": "string",
                "description": (
                    "Приклад речення грузинською (необов'язково). Якщо природно "
                    "виходить — постав слово в реченні ТОЧНО в тій формі, що й у "
                    "полі georgian (без зміни відмінка чи дієвідміни): застосунок "
                    "шукає в реченні цю форму дослівно для вправ 'заповни пропуск'. "
                    "Якщо дослівна форма звучить неприродно — краще звичайне "
                    "речення без цього обмеження, ніж силувана конструкція."
                ),
            },
            "tags": {
                "type": "string",
                "description": (
                    "Теги через кому, напр. 'їжа, дієслова' (необов'язково). Для "
                    "окремих форм одного дієслова (грузинська дуже нерегулярна: "
                    "дієслова руху міняють корінь між часовими серіями, форми "
                    "різняться за особою/числом об'єкта) — додай тег у форматі "
                    "'дієслово:<словникова форма>', однаковий для ВСІХ форм цього "
                    "дієслова (напр. усі форми 'йти/прийти' — тег 'дієслово:წასვლა'), "
                    "щоб вони згрупувались в один чип у панелі тегів."
                ),
            },
        },
        "required": ["georgian", "translation"],
    },
}


def execute_add_word(conn, tool_input):
    georgian = (tool_input.get("georgian") or "").strip()
    translation = (tool_input.get("translation") or "").strip()
    if not georgian or not translation:
        return {"ok": False, "error": "потрібні і georgian, і translation"}
    word_uuid = str(uuidlib.uuid4())
    conn.execute(
        "INSERT INTO words (uuid, georgian, translation, example, tags, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            word_uuid,
            georgian,
            translation,
            (tool_input.get("example") or "").strip(),
            normalize_tags(tool_input.get("tags")),
            utcnow(),
        ),
    )
    conn.commit()
    return {"ok": True, "uuid": word_uuid, "georgian": georgian, "translation": translation}


RETAG_WORD_TOOL = {
    "name": "retag_word",
    "description": (
        "Додає теги до вже ІСНУЮЧОГО слова в словнику учня (наявні теги "
        "зберігаються, нові додаються поруч — нічого не перезаписується). Слово "
        "шукається за точним грузинським написанням. Використовуй, щоб "
        "згрупувати вже додані форми дієслова спільним тегом "
        "'дієслово:<словникова форма>' (див. опис поля tags в add_word), коли "
        "учень хоче впорядкувати наявні слова, а не додати нові. Якщо в "
        "словнику кілька слів з однаковим написанням — жодне не змінюється, "
        "повертається помилка з проханням уточнити (напр. за перекладом)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "georgian": {
                "type": "string",
                "description": "Точне грузинське написання наявного слова (як у словнику нижче)",
            },
            "tags": {
                "type": "string",
                "description": "Теги, які додати, через кому (наявні теги слова не губляться)",
            },
        },
        "required": ["georgian", "tags"],
    },
}


def execute_retag_word(conn, tool_input):
    georgian = (tool_input.get("georgian") or "").strip()
    new_tags = (tool_input.get("tags") or "").strip()
    if not georgian or not new_tags:
        return {"ok": False, "error": "потрібні і georgian, і tags"}
    matches = conn.execute(
        "SELECT uuid, tags FROM words WHERE georgian = ?", (georgian,)
    ).fetchall()
    if not matches:
        return {"ok": False, "error": f"слово «{georgian}» не знайдено в словнику"}
    if len(matches) > 1:
        return {
            "ok": False,
            "error": f"у словнику кілька слів з написанням «{georgian}» — уточни, яке саме",
        }
    row = matches[0]
    merged = normalize_tags(f"{row['tags']}, {new_tags}" if row["tags"] else new_tags)
    conn.execute("UPDATE words SET tags = ? WHERE uuid = ?", (merged, row["uuid"]))
    conn.commit()
    return {"ok": True, "uuid": row["uuid"], "tags": merged}


SAVE_GRAMMAR_NOTE_TOOL = {
    "name": "save_grammar_note",
    "description": (
        "Зберігає нове граматичне правило як окрему нотатку, щоб учень міг "
        "повернутись до неї пізніше. Використовуй, коли пояснюєш правило, яке "
        "варто зберегти для повторного звернення — особливо якщо учень явно "
        "просить 'збережи це правило', або та сама тема виникає повторно. "
        "Перед створенням перевір список наявних нотаток у системному "
        "промпті, щоб не дублювати тему. Після створення (чи посилаючись на "
        "наявну нотатку зі списку) згадай її в тексті відповіді у форматі "
        "[[note:ID|Назва]] — застосунок покаже це як клікабельне посилання."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Коротка назва правила, напр. 'Родовий відмінок при запереченні'",
            },
            "content": {
                "type": "string",
                "description": "Повне пояснення правила з прикладами (кілька речень)",
            },
        },
        "required": ["title", "content"],
    },
}

GET_GRAMMAR_NOTE_TOOL = {
    "name": "get_grammar_note",
    "description": (
        "Повертає повний текст раніше збереженої нотатки з граматики за її id "
        "(id видно у списку наявних нотаток у системному промпті). Використовуй, "
        "коли треба процитувати чи розширити вже збережене правило."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"id": {"type": "integer", "description": "id нотатки"}},
        "required": ["id"],
    },
}


def execute_save_grammar_note(conn, tool_input):
    title = (tool_input.get("title") or "").strip()
    content = (tool_input.get("content") or "").strip()
    if not title or not content:
        return {"ok": False, "error": "потрібні і title, і content"}
    cur = conn.execute(
        "INSERT INTO grammar_notes (title, content, created_at) VALUES (?, ?, ?)",
        (title, content, utcnow()),
    )
    conn.commit()
    return {"ok": True, "id": cur.lastrowid, "title": title}


def execute_get_grammar_note(conn, tool_input):
    try:
        note_id = int(tool_input.get("id"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "невалідний id"}
    row = conn.execute(
        "SELECT title, content FROM grammar_notes WHERE id = ?", (note_id,)
    ).fetchone()
    if row is None:
        return {"ok": False, "error": "нотатку не знайдено"}
    return {"ok": True, "id": note_id, "title": row["title"], "content": row["content"]}


CHAT_TOOLS = [ADD_WORD_TOOL, RETAG_WORD_TOOL, SAVE_GRAMMAR_NOTE_TOOL, GET_GRAMMAR_NOTE_TOOL]
CHAT_TOOL_EXECUTORS = {
    "add_word": execute_add_word,
    "retag_word": execute_retag_word,
    "save_grammar_note": execute_save_grammar_note,
    "get_grammar_note": execute_get_grammar_note,
}


def srs_status(level):
    if level <= 0:
        return "нове"
    if level <= 3:
        return "вивчається"
    return "закріплене"


def build_tutor_system(db):
    """Системний промпт зі словником учня, його SRS-прогресом і нотатками з граматики.

    Треновані слова (є прогрес SRS) вкладаються всі — це активний набір учня.
    Нетреновані — лише останні додані, до загальної межі CHAT_VOCAB_LIMIT;
    про решту модель дізнається з підсумкового рядка. Нотатки — лише назви
    (id + title), не повний текст, щоб не роздувати контекст.
    """
    words = db.execute("SELECT * FROM words ORDER BY id").fetchall()
    levels = {}
    for row in db.execute(
        "SELECT word_uuid, MAX(level) AS lvl FROM reviews GROUP BY word_uuid"
    ):
        levels[row["word_uuid"]] = row["lvl"]

    trained = [w for w in words if w["uuid"] in levels]
    untrained = [w for w in words if w["uuid"] not in levels]
    room = max(0, CHAT_VOCAB_LIMIT - len(trained))
    shown_untrained = untrained[-room:] if room else []
    hidden = len(untrained) - len(shown_untrained)

    def word_line(w):
        line = (
            f"- {w['georgian']} — {w['translation']} "
            f"[{srs_status(levels.get(w['uuid'], 0))}]"
        )
        if w["tags"]:
            line += f" (теги: {w['tags']})"
        if w["example"]:
            line += f" | приклад: {w['example']}"
        return line

    parts = [
        f"Усього слів у словнику: {len(words)}; "
        f"з них у тренуванні (SRS): {len(trained)}."
    ]
    if trained:
        parts.append("Слова, які учень активно тренує:")
        parts.extend(word_line(w) for w in trained)
    if shown_untrained:
        parts.append("Останні додані слова (ще не тренувалися):")
        parts.extend(word_line(w) for w in shown_untrained)
    if hidden > 0:
        parts.append(
            f"… та ще {hidden} слів у черзі на вивчення (не показані, "
            f"щоб не роздувати контекст)."
        )
    vocab = "\n".join(parts) if words else "(словник поки порожній)"

    note_rows = db.execute(
        "SELECT id, title FROM grammar_notes ORDER BY id DESC LIMIT ?",
        (CHAT_NOTES_TITLE_LIMIT,),
    ).fetchall()
    total_notes = db.execute("SELECT COUNT(*) AS c FROM grammar_notes").fetchone()["c"]
    if note_rows:
        note_lines = [f"- [{r['id']}] {r['title']}" for r in note_rows]
        if total_notes > len(note_rows):
            note_lines.append(f"… та ще {total_notes - len(note_rows)} старіших нотаток.")
        notes_block = "\n".join(note_lines)
    else:
        notes_block = "(нотаток поки немає)"

    return f"""\
Ти — привітний персональний репетитор грузинської мови. Твій учень — україномовний, \
вчить грузинську з нуля на LingWing і веде власний словник; цей чат вбудований у \
застосунок-словник, тож ти бачиш його актуальний словниковий запас нижче.

Як поводитись:
- Спілкуйся українською; грузинську вживай для прикладів, вправ і розмовної практики, \
підлаштовуючись під рівень учня (видно зі словника нижче).
- Якщо учень пише грузинською — відповідай простою грузинською з українським перекладом \
у дужках, м'яко виправляй помилки і коротко пояснюй відповідне правило.
- Пояснюй граматику простими словами з прикладами; порівнюй з українською, де це допомагає.
- Будуй розмову і приклади насамперед на словах зі словника учня (особливо зі статусом \
"вивчається"); нові слова поза словником додавай потроху, 1-2 за раз, одразу з перекладом.
- Це мобільний чат: відповідай стисло (зазвичай 2-6 речень), без таблиць, заголовків і \
жирного тексту. Список — лише коли він справді доречний.
- Не вигадуй прогрес учня — спирайся лише на словник нижче.
- Якщо учень просить додати/запам'ятати слово, або сам погоджується зберегти нове слово \
з розмови — використай інструмент add_word (переклад і, якщо доречно, приклад та теги), \
а потім коротко підтверди, що додав. Приклад бажано з дослівною формою слова (див. опис \
поля example) — це вмикає вправи "заповни пропуск" на повтореннях.
- Коли пояснюєш форми нерегулярного дієслова (грузинські дієслова руху й багато інших \
міняють корінь між часовими серіями чи формами) і учень хоче їх запам'ятати — запропонуй \
додати кілька ключових форм через add_word окремими словами з однаковим тегом \
"дієслово:<словникова форма>" (див. опис поля tags), а не лише переказати форми в тексті \
відповіді — інакше вони не потраплять у SRS-повторення. Якщо учень хоче так само \
згрупувати форми, які вже є в словнику (не нові) — використай retag_word для кожної з них.
- Коли пояснюєш граматичне правило, яке варто зберегти для повторного звернення \
(особливо якщо учень просить "збережи це правило", або тема повторюється) — використай \
save_grammar_note. Спочатку перевір список наявних нотаток нижче, щоб не дублювати тему; \
якщо схожа вже є, посилайся на неї замість створення нової (get_grammar_note — щоб \
підтягнути повний текст, якщо треба процитувати). Посилаючись на нову чи наявну нотатку в \
тексті відповіді, вживай формат [[note:ID|Назва]] — застосунок покаже це як клікабельне \
посилання.

Словник учня (грузинське слово — переклад [статус SRS]; статуси: нове → вивчається → закріплене):
{vocab}

Наявні нотатки з граматики (id — назва):
{notes_block}"""


chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/api/notes", methods=["GET"])
def api_notes_list():
    db = get_db()
    rows = db.execute(
        "SELECT g.id, g.title, g.content, g.created_at, "
        "COALESCE(nr.level, 0) AS level, nr.due_at AS due_at "
        "FROM grammar_notes g LEFT JOIN note_reviews nr ON nr.note_id = g.id "
        "ORDER BY g.id DESC"
    ).fetchall()
    return {"notes": [dict(r) for r in rows]}


@chat_bp.route("/api/notes/<int:note_id>", methods=["DELETE"])
def api_notes_delete(note_id):
    db = get_db()
    db.execute("DELETE FROM grammar_notes WHERE id = ?", (note_id,))
    db.execute("DELETE FROM note_reviews WHERE note_id = ?", (note_id,))
    db.commit()
    return {"ok": True}


@chat_bp.route("/api/notes/<int:note_id>/review", methods=["POST"])
def api_notes_review(note_id):
    """Оцінка повторення нотатки: рівень/дата так само, як для слів (self-rated,
    без перевірки тексту — grade() на клієнті лише каже правильно/ні)."""
    db = get_db()
    note = db.execute("SELECT id FROM grammar_notes WHERE id = ?", (note_id,)).fetchone()
    if note is None:
        return {"error": "нотатку не знайдено"}, 404
    payload = request.get_json(silent=True) or {}
    correct = bool(payload.get("correct"))
    row = db.execute(
        "SELECT level FROM note_reviews WHERE note_id = ?", (note_id,)
    ).fetchone()
    prev_level = row["level"] if row else 0
    level = min(prev_level + 1, len(NOTE_INTERVALS)) if correct else 0
    due_at = due_date_str(NOTE_INTERVALS[level - 1]) if correct else utcnow()
    reviewed_at = utcnow()
    db.execute(
        "INSERT INTO note_reviews (note_id, level, due_at, reviewed_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(note_id) DO UPDATE SET "
        "level = excluded.level, due_at = excluded.due_at, reviewed_at = excluded.reviewed_at",
        (note_id, level, due_at, reviewed_at),
    )
    db.commit()
    return {"ok": True, "level": level, "due_at": due_at}


@chat_bp.route("/api/chat", methods=["GET"])
def api_chat_history():
    db = get_db()
    rows = db.execute("SELECT role, content FROM chat_messages ORDER BY id").fetchall()
    return {
        "configured": _chat_client is not None,
        "messages": [{"role": r["role"], "content": r["content"]} for r in rows],
    }


@chat_bp.route("/api/chat", methods=["DELETE"])
def api_chat_clear():
    db = get_db()
    db.execute("DELETE FROM chat_messages")
    db.commit()
    return {"ok": True}


def _run_chat_generation(history, system_prompt, out_queue):
    """Виконується у фоновому потоці — незалежно від того, чи клієнт ще читає
    HTTP-відповідь. Якщо вкладку згорнули/закрили посеред стрімінгу, відповідь
    однаково доводиться до кінця і зберігається в chat_messages; той, хто
    споживає out_queue, просто більше не отримує чанків, але сама генерація
    (і платіж за токени) не переривається на півслові.
    """
    collected = []
    messages = list(history)
    try:
        for _ in range(CHAT_TOOL_LOOP_LIMIT):
            with _chat_client.messages.stream(
                model=CHAT_MODEL,
                max_tokens=CHAT_MAX_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=CHAT_TOOLS,
                messages=messages,
            ) as stream:
                for chunk in stream.text_stream:
                    collected.append(chunk)
                    out_queue.put(chunk)
                final = stream.get_final_message()

            if final.stop_reason != "tool_use":
                break

            messages.append({"role": "assistant", "content": final.content})
            tool_results = []
            # окреме з'єднання з базою — виконується поза контекстом запиту Flask
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                for block in final.content:
                    if block.type != "tool_use":
                        continue
                    executor = CHAT_TOOL_EXECUTORS.get(block.name)
                    if executor is None:
                        result = {"ok": False, "error": f"невідомий інструмент {block.name}"}
                    else:
                        try:
                            result = executor(conn, block.input)
                        except Exception:
                            logger.exception("Помилка виконання інструмента %s", block.name)
                            result = {"ok": False, "error": "внутрішня помилка інструмента"}
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, ensure_ascii=False),
                    })
            messages.append({"role": "user", "content": tool_results})
        else:
            # цикл вичерпав ліміт ітерацій, а модель усе ще викликала
            # інструменти — без цього відповідь обривається одразу після
            # останньої дії, без жодного пояснювального тексту користувачу
            logger.error(
                "Вичерпано CHAT_TOOL_LOOP_LIMIT (%d) — модель ще викликала "
                "інструменти", CHAT_TOOL_LOOP_LIMIT,
            )
            fallback = (
                "\n\n✅ Дію виконано, але довелось обірвати відповідь — "
                "забагато кроків поспіль. Постав уточнююче питання, якщо треба деталі."
            )
            collected.append(fallback)
            out_queue.put(fallback)
    except anthropic.APIStatusError as e:
        logger.error("Anthropic APIStatusError: %s", e)
        # помилки API навмисно НЕ йдуть у collected — не зберігаються в історію,
        # лише показуються в чаті (як і раніше, до фонового потоку)
        out_queue.put(
            f"⚠️ Помилка API ({e.status_code}) — перевір ключ і баланс "
            f"на console.anthropic.com"
        )
    except anthropic.APIConnectionError as e:
        logger.error("Anthropic APIConnectionError: %s", e)
        out_queue.put("⚠️ Сервер не зміг з'єднатися з api.anthropic.com — перевір інтернет.")
    except Exception:
        logger.exception("Неочікувана помилка в чаті")
        out_queue.put("⚠️ Сталася неочікувана помилка — подробиці в chat_errors.log.")
    finally:
        if collected:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    "INSERT INTO chat_messages (role, content, created_at) "
                    "VALUES (?, ?, ?)",
                    ("assistant", "".join(collected), utcnow()),
                )
        out_queue.put(None)   # сигнал кінця для споживача черги
        _chat_lock.release()


@chat_bp.route("/api/chat", methods=["POST"])
def api_chat_send():
    if _chat_client is None:
        return {
            "error": "ANTHROPIC_API_KEY не налаштований — додай його у файл .env "
            "поруч з app.py і перезапусти сервер"
        }, 503
    payload = request.get_json(silent=True) or {}
    text = (payload.get("message") or "").strip()
    if not text:
        return {"error": "порожнє повідомлення"}, 400
    if not _chat_lock.acquire(blocking=False):
        return {
            "error": "Чат ще обробляє попереднє повідомлення — зачекай трохи і спробуй знову."
        }, 409

    try:
        db = get_db()
        db.execute(
            "INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)",
            ("user", text, utcnow()),
        )
        db.commit()
        rows = db.execute(
            "SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT ?",
            (CHAT_HISTORY_LIMIT,),
        ).fetchall()
        history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
        while history and history[0]["role"] != "user":
            history.pop(0)  # історія для API має починатися з user-повідомлення
        system_prompt = build_tutor_system(db)
    except Exception:
        _chat_lock.release()
        raise

    out_queue = queue.Queue()
    threading.Thread(
        target=_run_chat_generation, args=(history, system_prompt, out_queue), daemon=True,
    ).start()

    def stream_from_queue():
        while True:
            item = out_queue.get()
            if item is None:
                break
            yield item

    return Response(stream_from_queue(), mimetype="text/plain; charset=utf-8")
