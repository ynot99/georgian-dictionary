"""E2E тест базового API слів: sync, дедуплікація, delete, CSV-експорт.

Створює лише тестові слова (uuid test-api-*) і прибирає їх за собою —
безпечно запускати проти реальної бази. Потребує запущений сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()

_, base = req("/api/sync", "POST", {"words": [], "reviews": []})
base_count = len(base["words"])
print(f"0. базовий стан: {base_count} слів")

payload = {"words": [
    {"uuid": "test-api-1", "georgian": "მადლობა", "translation": "дякую",
     "example": "", "created_at": "2026-07-03 05:00:00"},
    {"uuid": "test-api-2", "georgian": "კარგი", "translation": "добре",
     "example": "ძალიან კარგი — дуже добре", "created_at": "2026-07-03 05:01:00"},
]}
_, data = req("/api/sync", "POST", payload)
assert len(data["words"]) == base_count + 2, len(data["words"])
print(f"1. sync (2 нових): слів стало {len(data['words'])}")

_, data = req("/api/sync", "POST", payload)
assert len(data["words"]) == base_count + 2, "дублікати з'явились!"
print("2. повторний sync тих самих uuid — дублікатів немає")

_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
w = next(w for w in data["words"] if w["uuid"] == "test-api-1")
assert w["id"] and w["uuid"], w
print(f"3. порожній sync повертає стан; тестове слово отримало id={w['id']}")

_, csv_text = req("/export.csv", raw=True)
assert csv_text.splitlines()[0] == "uuid,georgian,translation,example,tags,created_at"
assert "მადლობა" in csv_text and "дякую" in csv_text
print("4. CSV-експорт містить uuid і синхронізовані слова")

req("/api/words/test-api-1", "DELETE")
req("/api/words/test-api-2", "DELETE")
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
assert len(data["words"]) == base_count, len(data["words"])
print(f"5. видалення по uuid: знову {base_count} слів (реальні слова не зачеплені)")

print("\nВСЕ OK")
