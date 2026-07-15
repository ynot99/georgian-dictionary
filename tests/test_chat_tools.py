"""Тест виконання інструмента add_word (без звернення до Claude API — безкоштовно).

Викликає execute_add_word() напряму з server/chat.py, як це робить чат при
tool_use. Створює лише тестове слово (uuid перевіряється й видаляється) —
безпечно проти реальної бази. Потребує запущений сервер лише опосередковано
(та сама dictionary.db, що й app.py; сервер не обов'язково має бути живий для
цього тесту, але для одноманітності з іншими тестами перевіряємо його наявність).
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from server import chat as dict_chat  # noqa: E402
from server.db import DB_PATH  # noqa: E402

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

before = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]

# успішне додавання
result = dict_chat.execute_add_word(conn, {
    "georgian": "test-tool-word", "translation": "тестовий переклад",
    "example": "приклад", "tags": " Тест, тест ",
})
assert result["ok"] is True and result["uuid"], result
print("1. add_word додає слово і повертає uuid")

row = conn.execute(
    "SELECT * FROM words WHERE uuid = ?", (result["uuid"],)).fetchone()
assert row["georgian"] == "test-tool-word"
assert row["translation"] == "тестовий переклад"
assert row["tags"] == "тест", row["tags"]  # normalize_tags: нижній регістр, без дублів
print("2. слово збережене в базі коректно, теги нормалізовані")

after = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
assert after == before + 1, (before, after)
print(f"3. кількість слів зросла на 1: {before} -> {after}")

# невалідний ввід: без обов'язкових полів -> ok: False, нічого не пишеться в базу
result = dict_chat.execute_add_word(conn, {"georgian": "", "translation": "щось"})
assert result == {"ok": False, "error": "потрібні і georgian, і translation"}, result
after2 = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
assert after2 == after, "невалідний виклик не має нічого додавати"
print("4. без обов'язкових полів -> ok: False, база не змінюється")

# --- retag_word: додає теги до наявного слова, знайденого за точним написанням ---

result = dict_chat.execute_retag_word(conn, {
    "georgian": "test-tool-word", "tags": "дієслово:test-tool-word",
})
assert result["ok"] is True, result
row = conn.execute(
    "SELECT tags FROM words WHERE georgian = ?", ("test-tool-word",)).fetchone()
assert row["tags"] == "тест, дієслово:test-tool-word", row["tags"]
print("5. retag_word додає новий тег, наявний ('тест') зберігається")

# дублікат тега не з'являється двічі (normalize_tags дедуплікує)
result = dict_chat.execute_retag_word(conn, {
    "georgian": "test-tool-word", "tags": "тест",
})
assert result["ok"] is True
row = conn.execute(
    "SELECT tags FROM words WHERE georgian = ?", ("test-tool-word",)).fetchone()
assert row["tags"] == "тест, дієслово:test-tool-word", row["tags"]
print("6. повторний тег не дублюється")

# слово не знайдено -> ok: False, нічого не змінюється
result = dict_chat.execute_retag_word(conn, {
    "georgian": "test-tool-неіснує", "tags": "щось",
})
assert result == {"ok": False, "error": "слово «test-tool-неіснує» не знайдено в словнику"}, result
print("7. неіснуюче слово -> ok: False")

# --- edit_word: виправляє поля наявного слова (переклад/приклад/теги, за бажанням) ---

result = dict_chat.execute_edit_word(conn, {
    "georgian": "test-tool-word", "translation": "виправлений переклад",
})
assert result["ok"] is True and result["translation"] == "виправлений переклад", result
row = conn.execute(
    "SELECT translation, example, tags FROM words WHERE georgian = ?", ("test-tool-word",)).fetchone()
assert row["translation"] == "виправлений переклад"
assert row["example"] == "приклад", "example не передано -> не мало змінитись"
assert row["tags"] == "тест, дієслово:test-tool-word", "tags не передано -> не мало змінитись"
print("8. edit_word виправляє лише передане поле (translation), решта не чіпається")

result = dict_chat.execute_edit_word(conn, {
    "georgian": "test-tool-word", "tags": "нове",
})
assert result["ok"] is True
row = conn.execute(
    "SELECT tags FROM words WHERE georgian = ?", ("test-tool-word",)).fetchone()
assert row["tags"] == "нове", "tags в edit_word мають ПОВНІСТЮ замінювати наявні"
print("9. edit_word замінює tags повністю (на відміну від retag_word)")

# жодного поля для зміни -> ok: False, нічого не пишеться
result = dict_chat.execute_edit_word(conn, {"georgian": "test-tool-word"})
assert result == {"ok": False, "error": "потрібне хоча б одне з: translation, example, tags"}, result
print("10. edit_word без жодного поля для зміни -> ok: False")

# неіснуюче слово -> ok: False
result = dict_chat.execute_edit_word(conn, {
    "georgian": "test-tool-неіснує", "translation": "щось",
})
assert result == {"ok": False, "error": "слово «test-tool-неіснує» не знайдено в словнику"}, result
print("11. edit_word: неіснуюче слово -> ok: False")

# кілька слів з однаковим написанням -> жодне не змінюється (retag_word і edit_word)
conn.execute(
    "INSERT INTO words (uuid, georgian, translation, example, tags, created_at) "
    "VALUES (?, ?, ?, ?, ?, ?)",
    ("test-tool-dup", "test-tool-word", "інший переклад", "", "", dict_chat.utcnow()),
)
conn.commit()
result = dict_chat.execute_retag_word(conn, {
    "georgian": "test-tool-word", "tags": "щось",
})
assert result["ok"] is False and "кілька слів" in result["error"], result
row = conn.execute(
    "SELECT tags FROM words WHERE uuid = 'test-tool-dup'").fetchone()
assert row["tags"] == "", "неоднозначний збіг не мав нічого змінювати"
print("12. неоднозначний збіг (кілька слів з тим самим написанням) -> retag_word ok: False, нічого не змінено")

result = dict_chat.execute_edit_word(conn, {
    "georgian": "test-tool-word", "translation": "щось",
})
assert result["ok"] is False and "кілька слів" in result["error"], result
row = conn.execute(
    "SELECT translation FROM words WHERE uuid = 'test-tool-dup'").fetchone()
assert row["translation"] == "інший переклад", "неоднозначний збіг не мав нічого змінювати"
print("13. неоднозначний збіг -> edit_word ok: False, нічого не змінено")

# --- edit_grammar_note: виправляє поля наявної нотатки (title/content, за бажанням) ---

notes_before = conn.execute("SELECT COUNT(*) FROM grammar_notes").fetchone()[0]
note_id = dict_chat.execute_save_grammar_note(conn, {
    "title": "test-tool-note", "content": "початковий зміст",
})["id"]

result = dict_chat.execute_edit_grammar_note(conn, {"id": note_id, "content": "виправлений зміст"})
assert result["ok"] is True and result["content"] == "виправлений зміст", result
row = conn.execute("SELECT title, content FROM grammar_notes WHERE id = ?", (note_id,)).fetchone()
assert row["title"] == "test-tool-note", "title не передано -> не мало змінитись"
assert row["content"] == "виправлений зміст"
print("18. edit_grammar_note виправляє лише передане поле (content), title не чіпається")

result = dict_chat.execute_edit_grammar_note(conn, {"id": note_id, "title": "нова назва"})
assert result["ok"] is True
row = conn.execute("SELECT title FROM grammar_notes WHERE id = ?", (note_id,)).fetchone()
assert row["title"] == "нова назва"
print("19. edit_grammar_note виправляє title окремо від content")

# жодного поля для зміни -> ok: False, нічого не пишеться
result = dict_chat.execute_edit_grammar_note(conn, {"id": note_id})
assert result == {"ok": False, "error": "потрібне хоча б одне з: title, content"}, result
print("20. edit_grammar_note без жодного поля для зміни -> ok: False")

# неіснуюча нотатка -> ok: False
result = dict_chat.execute_edit_grammar_note(conn, {"id": 999999, "title": "щось"})
assert result == {"ok": False, "error": "нотатку не знайдено"}, result
print("21. edit_grammar_note: неіснуюча нотатка -> ok: False")

# невалідний id -> ok: False
result = dict_chat.execute_edit_grammar_note(conn, {"id": "не число", "title": "щось"})
assert result == {"ok": False, "error": "невалідний id"}, result
print("22. edit_grammar_note: невалідний id -> ok: False")

conn.execute("DELETE FROM grammar_notes WHERE id = ?", (note_id,))
conn.commit()
notes_after = conn.execute("SELECT COUNT(*) FROM grammar_notes").fetchone()[0]
assert notes_after == notes_before, (notes_before, notes_after)
print(f"23. прибирання: знову {notes_before} нотаток")

# --- журнал викликів для дзвіночка (🔔) в чаті ---

calls_before = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
dict_chat._log_tool_call(
    conn, "add_word",
    {"georgian": "test-tool-word", "translation": "тест"},
    {"ok": True, "uuid": "abc", "georgian": "test-tool-word"},
)
row = conn.execute(
    "SELECT tool_name, summary, ok FROM tool_calls ORDER BY id DESC LIMIT 1"
).fetchone()
assert row["tool_name"] == "add_word"
assert row["summary"] == "add_word — test-tool-word", row["summary"]
assert row["ok"] == 1
print("24. _log_tool_call записує підсумок 'тулза — слово' і ok=1 для успіху")

dict_chat._log_tool_call(
    conn, "edit_word",
    {"georgian": "test-tool-word"},
    {"ok": False, "error": "потрібне хоча б одне з: translation, example, tags"},
)
row = conn.execute(
    "SELECT tool_name, summary, ok FROM tool_calls ORDER BY id DESC LIMIT 1"
).fetchone()
assert row["ok"] == 0, "невдалий виклик має логуватись з ok=0"
print("25. _log_tool_call позначає невдалий виклик як ok=0")

calls_after = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
assert calls_after == calls_before + 2, (calls_before, calls_after)
print(f"26. кількість записів у tool_calls зросла на 2: {calls_before} -> {calls_after}")

# прибирання
conn.execute("DELETE FROM words WHERE georgian = ? OR uuid = ?", ("test-tool-word", "test-tool-dup"))
conn.execute("DELETE FROM tool_calls WHERE summary LIKE '%test-tool-word%'")
conn.commit()
final = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
assert final == before, (before, final)
print(f"27. прибирання: знову {before} слів, {calls_before} записів у tool_calls")

conn.close()
print("\nВСЕ OK (жодного звернення до Claude API)")
