"""E2E тест API нотаток (/api/notes) та юніт-тест виконання інструментів чату
(execute_save_grammar_note / execute_get_grammar_note) — без звернення до
Claude API (безкоштовно). Створює лише тестові нотатки з префіксом
"test-note-" у назві — безпечно проти реальної бази. Потребує запущений
сервер (python app.py).
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import app as dict_app  # noqa: E402
from _client import check_server, req  # noqa: E402

check_server()

# --- юніт-тести execute_* напряму (без HTTP, без Claude) ---

conn = sqlite3.connect(dict_app.DB_PATH)
conn.row_factory = sqlite3.Row
before = conn.execute("SELECT COUNT(*) FROM grammar_notes").fetchone()[0]

result = dict_app.execute_save_grammar_note(conn, {
    "title": "test-note-родовий відмінок", "content": "Пояснення правила з прикладами.",
})
assert result["ok"] is True and result["id"], result
note_id = result["id"]
print("1. save_grammar_note створює нотатку і повертає id")

fetched = dict_app.execute_get_grammar_note(conn, {"id": note_id})
assert fetched == {"ok": True, "id": note_id, "title": "test-note-родовий відмінок",
                    "content": "Пояснення правила з прикладами."}, fetched
print("2. get_grammar_note повертає повний текст за id")

missing = dict_app.execute_get_grammar_note(conn, {"id": 999999})
assert missing == {"ok": False, "error": "нотатку не знайдено"}, missing
print("3. get_grammar_note для неіснуючого id -> ok: False")

bad = dict_app.execute_save_grammar_note(conn, {"title": "", "content": "щось"})
assert bad == {"ok": False, "error": "потрібні і title, і content"}, bad
print("4. save_grammar_note без title -> ok: False, нічого не створюється")

after = conn.execute("SELECT COUNT(*) FROM grammar_notes").fetchone()[0]
assert after == before + 1, (before, after)
print(f"5. кількість нотаток зросла рівно на 1: {before} -> {after}")

conn.execute("DELETE FROM grammar_notes WHERE id = ?", (note_id,))
conn.commit()
conn.close()
print("6. тестову нотатку прибрано (юніт-частина)")

# --- e2e через HTTP: /api/notes ---

_, base = req("/api/notes")
base_count = len(base["notes"])
print(f"7. базовий стан: {base_count} нотаток")

conn = sqlite3.connect(dict_app.DB_PATH)
conn.execute(
    "INSERT INTO grammar_notes (title, content, created_at) VALUES (?, ?, ?)",
    ("test-note-http", "Текст для http-тесту", "2026-07-11 10:00:00"),
)
conn.commit()
new_id = conn.execute(
    "SELECT id FROM grammar_notes WHERE title = 'test-note-http'").fetchone()[0]
conn.close()

_, data = req("/api/notes")
assert len(data["notes"]) == base_count + 1
note = next(n for n in data["notes"] if n["id"] == new_id)
assert note["title"] == "test-note-http" and note["content"] == "Текст для http-тесту"
print("8. GET /api/notes повертає створену нотатку")

status, _ = req(f"/api/notes/{new_id}", "DELETE")
assert status == 200
_, data = req("/api/notes")
assert len(data["notes"]) == base_count, len(data["notes"])
print(f"9. DELETE /api/notes/<id> прибирає нотатку; знову {base_count}")

print("\nВСЕ OK (жодного звернення до Claude API)")
