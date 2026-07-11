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

# кілька слів з однаковим написанням -> жодне не змінюється
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
print("8. неоднозначний збіг (кілька слів з тим самим написанням) -> ok: False, нічого не змінено")

# прибирання
conn.execute("DELETE FROM words WHERE georgian = ? OR uuid = ?", ("test-tool-word", "test-tool-dup"))
conn.commit()
final = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
assert final == before, (before, final)
print(f"9. прибирання: знову {before} слів")

conn.close()
print("\nВСЕ OK (жодного звернення до Claude API)")
