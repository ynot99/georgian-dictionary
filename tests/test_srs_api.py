"""E2E тест синхронізації SRS-прогресу: конфлікти, напрямки, каскадне видалення.

Створює лише тестове слово (uuid test-srs-1) — безпечно проти реальної бази.
Потребує запущений сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()


def find_review(data, uuid, direction):
    return next((r for r in data["reviews"]
                 if r["word_uuid"] == uuid and r["direction"] == direction), None)


_, base = req("/api/sync", "POST", {"words": [], "reviews": []})
base_words, base_reviews = len(base["words"]), len(base["reviews"])
print(f"0. базовий стан: {base_words} слів, {base_reviews} оцінок")

_, data = req("/api/sync", "POST", {
    "words": [{"uuid": "test-srs-1", "georgian": "ტესტი", "translation": "тест",
               "example": "", "created_at": "2026-07-06 10:00:00"}],
    "reviews": [{"word_uuid": "test-srs-1", "direction": "ka2uk", "level": 1,
                 "due_at": "2026-07-07 10:00:00", "reviewed_at": "2026-07-06 10:05:00"}],
})
r = find_review(data, "test-srs-1", "ka2uk")
assert r and r["level"] == 1, r
print("1. слово + оцінка (level 1) синхронізовані")

_, data = req("/api/sync", "POST", {"words": [], "reviews": [
    {"word_uuid": "test-srs-1", "direction": "ka2uk", "level": 2,
     "due_at": "2026-07-09 11:00:00", "reviewed_at": "2026-07-06 11:00:00"}]})
assert find_review(data, "test-srs-1", "ka2uk")["level"] == 2
print("2. новіша оцінка перекрила стару (level 2)")

_, data = req("/api/sync", "POST", {"words": [], "reviews": [
    {"word_uuid": "test-srs-1", "direction": "ka2uk", "level": 0,
     "due_at": "2026-07-06 09:00:00", "reviewed_at": "2026-07-06 09:00:00"}]})
assert find_review(data, "test-srs-1", "ka2uk")["level"] == 2, "старіша оцінка не мала перекрити!"
print("3. старіша оцінка проігнорована (last-write-wins працює)")

_, data = req("/api/sync", "POST", {"words": [], "reviews": [
    {"word_uuid": "test-srs-1", "direction": "uk2ka", "level": 1,
     "due_at": "2026-07-07 12:00:00", "reviewed_at": "2026-07-06 12:00:00"}]})
assert find_review(data, "test-srs-1", "ka2uk")["level"] == 2
assert find_review(data, "test-srs-1", "uk2ka")["level"] == 1
print("4. два напрямки — незалежний прогрес")

_, data = req("/api/sync", "POST", {"words": [], "reviews": [
    {"word_uuid": "no-such-word", "direction": "ka2uk", "level": 5,
     "due_at": "2026-07-07 10:00:00", "reviewed_at": "2026-07-06 10:00:00"}]})
assert find_review(data, "no-such-word", "ka2uk") is None
print("5. оцінка для неіснуючого слова відкинута")

_, data = req("/api/sync", "POST", {"words": [], "reviews": [
    {"word_uuid": "test-srs-1", "direction": "hack", "level": 9,
     "due_at": "2026-07-07 10:00:00", "reviewed_at": "2026-07-06 23:00:00"}]})
assert find_review(data, "test-srs-1", "hack") is None
print("6. невалідний напрямок відкинутий")

req("/api/words/test-srs-1", "DELETE")
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
assert len(data["words"]) == base_words, len(data["words"])
assert find_review(data, "test-srs-1", "ka2uk") is None
assert find_review(data, "test-srs-1", "uk2ka") is None
assert len(data["reviews"]) == base_reviews
print(f"7. каскадне видалення оцінок працює; база повернулась до {base_words} слів")

print("\nВСЕ OK")
