"""E2E тест відкладених слів: синхронізація, last-write-wins, каскадне видалення.

Створює лише тестове слово (uuid test-susp-1) і прибирає його за собою —
безпечно запускати проти реальної бази. Потребує запущений сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()

WORD = "test-susp-1"


def mine(data):
    return [s for s in data["suspensions"] if s["word_uuid"] == WORD]


def push(suspended, changed_at, word_uuid=WORD):
    _, data = req("/api/sync", "POST", {"words": [], "reviews": [], "suspensions": [
        {"word_uuid": word_uuid, "suspended": suspended, "changed_at": changed_at},
    ]})
    return data


req("/api/sync", "POST", {"words": [
    {"uuid": WORD, "georgian": "ჩოგბურთელი", "translation": "тенісист", "example": "",
     "created_at": "2026-11-18 10:00:00"},
]})

try:
    data = push(True, "2026-11-18 10:00:00")
    assert mine(data) == [{"word_uuid": WORD, "suspended": True,
                           "changed_at": "2026-11-18 10:00:00"}], mine(data)
    print("1. слово відкладено, /api/sync повертає позначку")

    data = push(False, "2026-11-18 09:00:00")
    assert mine(data)[0]["suspended"] is True, mine(data)
    print("2. старіша зміна не перекриває новішу")

    data = push(False, "2026-11-18 11:00:00")
    assert mine(data)[0]["suspended"] is False, mine(data)
    print("3. повернення (новіше) перемагає — рядок лишається з suspended=false")

    data = push(True, "2026-11-18 12:00:00", word_uuid="test-susp-unknown")
    assert not [s for s in data["suspensions"] if s["word_uuid"] == "test-susp-unknown"]
    print("4. позначка для невідомого слова ігнорується")

    push(True, "2026-11-18 13:00:00")
finally:
    req(f"/api/words/{WORD}", "DELETE")

_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
assert not mine(data), mine(data)
print("5. видалення слова прибирає його позначку")
print("OK")
