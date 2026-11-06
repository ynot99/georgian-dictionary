"""E2E тест вправ на реченнях: додавання, валідація, дублікати, каскадне видалення.

Створює лише тестове слово (uuid test-sent-1) і прибирає його за собою —
безпечно запускати проти реальної бази. Потребує запущений сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()

WORD = "test-sent-1"


def mine(data):
    return [s for s in data["sentences"] if s["word_uuid"] == WORD]


req("/api/sync", "POST", {"words": [
    {"uuid": WORD, "georgian": "წყალი", "translation": "вода", "example": "",
     "created_at": "2026-11-06 10:00:00"},
]})

try:
    good = {"word_uuid": WORD, "sentence": "მე ____ ვსვამ.", "answer": "წყალს",
            "translation": "Я п'ю воду.", "hint": "წყალი, давальний відмінок"}
    status, res = req("/api/sentences", "POST", {"sentences": [good]})
    assert status == 200 and res == {"created": 1, "duplicates": 0, "invalid": []}, res
    print("1. речення додано")

    _, res = req("/api/sentences", "POST", {"sentences": [good]})
    assert res == {"created": 0, "duplicates": 1, "invalid": []}, res
    print("2. повторне додавання не створює дубліката")

    _, res = req("/api/sentences", "POST", {"sentences": [
        {**good, "sentence": "без пропуску"},
        {**good, "sentence": "____ і ____"},
        {**good, "sentence": "ще ____ одне", "answer": ""},
        {**good, "sentence": "ще ____ два", "translation": ""},
        {**good, "sentence": "ще ____ три", "word_uuid": "test-sent-unknown"},
        {**good, "sentence": "ще ____ чотири", "hint": ""},
    ]})
    assert res == {"created": 1, "duplicates": 0, "invalid": [0, 1, 2, 3, 4]}, res
    print("3. некоректні рядки відхилено, коректний додано")

    _, data = req("/api/sync", "POST", {"words": [], "reviews": []})
    rows = mine(data)
    assert len(rows) == 2, rows
    assert rows[0]["answer"] == "წყალს" and rows[0]["hint"], rows[0]
    print("4. /api/sync повертає речення для офлайн-копії")

    _, listed = req("/api/sentences")
    assert len(mine(listed)) == 2, listed
    status, _ = req(f"/api/sentences/{rows[1]['id']}", "DELETE")
    assert status == 200
    _, listed = req("/api/sentences")
    assert len(mine(listed)) == 1, listed
    print("5. видалення одного речення")
finally:
    req(f"/api/words/{WORD}", "DELETE")

_, listed = req("/api/sentences")
assert not mine(listed), listed
print("6. видалення слова прибирає його речення")
print("OK")
