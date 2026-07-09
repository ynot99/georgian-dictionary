"""E2E тест імпорту CSV: оновлення по uuid, захисна сітка для AI, теги.

Усі тестові слова мають штучні (не грузинські) значення "test-imp-*", щоб
гарантовано не перетнутися з реальним словником користувача. Безпечно
проти реальної бази. Потребує запущений сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()


def by_uuid(data, u):
    return next((w for w in data["words"] if w["uuid"] == u), None)


_, base = req("/api/sync", "POST", {"words": [], "reviews": []})
base_count = len(base["words"])
print(f"0. базовий стан: {base_count} слів")

# слово, яке потім "виправимо" імпортом
req("/api/sync", "POST", {"words": [
    {"uuid": "test-imp-1", "georgian": "test-imp-tiger", "translation": "тигр (з помилкой)",
     "example": "", "tags": "", "created_at": "2026-07-06 10:00:00"}], "reviews": []})
print("1. тестове слово створено")

# імпорт: виправлення по uuid + нове без uuid + нове з невідомим uuid + порожній рядок
_, c = req("/api/import", "POST", {"words": [
    {"uuid": "test-imp-1", "georgian": "test-imp-tiger", "translation": "тигр",
     "example": "приклад з тигром", "tags": "тварини", "created_at": ""},
    {"uuid": "", "georgian": "test-imp-mountain", "translation": "гора",
     "example": "", "tags": "", "created_at": ""},
    {"uuid": "test-imp-new", "georgian": "test-imp-sea", "translation": "море",
     "example": "", "tags": "", "created_at": ""},
    {"uuid": "", "georgian": "", "translation": "порожнє", "example": "", "tags": "", "created_at": ""},
]})
assert c == {"updated": 1, "created": 2, "unchanged": 0, "skipped": 1}, c
print(f"2. імпорт: {c}")

_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
w1 = by_uuid(data, "test-imp-1")
assert (w1["translation"] == "тигр" and w1["example"] == "приклад з тигром"
        and w1["tags"] == "тварини"), w1
assert len(data["words"]) == base_count + 3
print("3. слово виправлено по uuid (з тегами), дублікатів немає")

# повторний імпорт того ж набору -> все unchanged
_, c = req("/api/import", "POST", {"words": [
    {"uuid": "test-imp-1", "georgian": "test-imp-tiger", "translation": "тигр",
     "example": "приклад з тигром", "tags": "тварини", "created_at": ""},
    {"uuid": "test-imp-new", "georgian": "test-imp-sea", "translation": "море",
     "example": "", "tags": "", "created_at": ""},
]})
assert c == {"updated": 0, "created": 0, "unchanged": 2, "skipped": 0}, c
print("4. повторний імпорт ідемпотентний")

# захисна сітка: uuid поламаний, але однозначний збіг за georgian -> оновлення
_, c = req("/api/import", "POST", {"words": [
    {"uuid": "BROKEN-uuid-from-ai", "georgian": "test-imp-tiger",
     "translation": "тигр (виправлено ще раз)", "example": "", "tags": "тварини",
     "created_at": ""}]})
assert c == {"updated": 1, "created": 0, "unchanged": 0, "skipped": 0}, c
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
matches = [w for w in data["words"] if w["georgian"] == "test-imp-tiger"]
assert len(matches) == 1 and matches[0]["uuid"] == "test-imp-1", matches
print("5. захисна сітка: поламаний uuid не створив дублікат")

# омоніми: два слова з однаковим georgian -> сітка не вгадує, створює нове
req("/api/sync", "POST", {"words": [
    {"uuid": "test-imp-h1", "georgian": "test-imp-homonym", "translation": "бар",
     "example": "", "tags": "", "created_at": "2026-07-06 10:00:00"},
    {"uuid": "test-imp-h2", "georgian": "test-imp-homonym", "translation": "лопата",
     "example": "", "tags": "", "created_at": "2026-07-06 10:00:00"}], "reviews": []})
_, c = req("/api/import", "POST", {"words": [
    {"uuid": "", "georgian": "test-imp-homonym", "translation": "бар (нове)",
     "example": "", "tags": "", "created_at": ""}]})
assert c["created"] == 1, c
print("6. неоднозначний збіг (омоніми) -> нове слово, сітка не вгадує")

_, csv_text = req("/export.csv", raw=True)
assert csv_text.splitlines()[0] == "uuid,georgian,translation,example,tags,created_at"
assert "test-imp-tiger" in csv_text and "тварини" in csv_text
print("7. CSV-експорт містить uuid і колонку tags")

_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
for w in data["words"]:
    if w["uuid"].startswith("test-imp-") or w["georgian"].startswith("test-imp-"):
        req(f"/api/words/{w['uuid']}", "DELETE")
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
assert len(data["words"]) == base_count, len(data["words"])
print(f"8. прибирання: знову {base_count} слів")

print("\nВСЕ OK")
