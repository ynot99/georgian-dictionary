"""E2E тест масового перейменування тега (/api/tags/rename).

Усі тестові слова мають штучні значення "test-tagr-*" — безпечно проти
реальної бази. Потребує запущений сервер (python app.py).
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

# три слова: одне з тегом-одруківкою, одне з тим самим тегом + інший тег,
# одне з "схожим" тегом-підрядком (не має зачепитись)
req("/api/sync", "POST", {"words": [
    {"uuid": "test-tagr-1", "georgian": "test-tagr-a", "translation": "а",
     "example": "", "tags": "їжааа", "created_at": "2026-07-10 10:00:00"},
    {"uuid": "test-tagr-2", "georgian": "test-tagr-b", "translation": "б",
     "example": "", "tags": "їжааа, дієслова", "created_at": "2026-07-10 10:00:00"},
    {"uuid": "test-tagr-3", "georgian": "test-tagr-c", "translation": "в",
     "example": "", "tags": "їжааа2", "created_at": "2026-07-10 10:00:00"},
], "reviews": []})
print("1. тестові слова створено")

_, c = req("/api/tags/rename", "POST", {"old": "їжааа", "new": "їжа"})
assert c == {"updated": 2}, c
print(f"2. перейменування: {c}")

_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
w1 = by_uuid(data, "test-tagr-1")
w2 = by_uuid(data, "test-tagr-2")
w3 = by_uuid(data, "test-tagr-3")
assert w1["tags"] == "їжа", w1
assert w2["tags"] == "їжа, дієслова", w2
assert w3["tags"] == "їжааа2", "тег-підрядок не має зачіпатись: " + w3["tags"]
print("3. тег перейменовано точно по токену, підрядок не зачеплений")

# повторне перейменування на ту саму назву — no-op
_, c = req("/api/tags/rename", "POST", {"old": "їжа", "new": "їжа"})
assert c == {"updated": 0}, c
print("4. old == new -> no-op")

# перейменування на тег, який у одного слова вже є — дублікат не з'являється
req("/api/sync", "POST", {"words": [
    {"uuid": "test-tagr-4", "georgian": "test-tagr-d", "translation": "г",
     "example": "", "tags": "напої, дієслова", "created_at": "2026-07-10 10:00:00"}],
    "reviews": []})
_, c = req("/api/tags/rename", "POST", {"old": "напої", "new": "дієслова"})
assert c == {"updated": 1}, c
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
w4 = by_uuid(data, "test-tagr-4")
assert w4["tags"] == "дієслова", f"дублікат тега не має з'являтись: {w4['tags']}"
print("5. рейменування в наявний тег дедуплікується")

# порожній/невалідний ввід -> no-op
_, c = req("/api/tags/rename", "POST", {"old": "", "new": "щось"})
assert c == {"updated": 0}, c
print("6. порожній old -> no-op")

# перейменування в зарезервоване слово ("усі"/"проблемні") -> no-op, бо
# normalize_tags() відфільтровує його в порожній new_tag
_, c = req("/api/tags/rename", "POST", {"old": "дієслова", "new": "Усі"})
assert c == {"updated": 0}, c
print("7. перейменування в зарезервоване слово -> no-op")

# зарезервоване слово ніколи не потрапляє в базу і через /api/sync
req("/api/sync", "POST", {"words": [
    {"uuid": "test-tagr-5", "georgian": "test-tagr-e", "translation": "д",
     "example": "", "tags": "проблемні, дієслова", "created_at": "2026-07-10 10:00:00"}],
    "reviews": []})
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
w5 = by_uuid(data, "test-tagr-5")
assert w5["tags"] == "дієслова", f"зарезервований тег не має зберігатись: {w5['tags']}"
print("8. зарезервований тег відфільтровано ще при синхронізації")

# --- e2e: /api/tags/delete (прибрати тег без заміни) ---

# на цей момент test-tagr-2/4/5 усі мають тег "дієслова" (з попередніх кроків)
req("/api/sync", "POST", {"words": [
    {"uuid": "test-tagd-1", "georgian": "test-tagd-a", "translation": "а",
     "example": "", "tags": "тест-дел, дієслова", "created_at": "2026-07-10 10:00:00"},
    {"uuid": "test-tagd-2", "georgian": "test-tagd-b", "translation": "б",
     "example": "", "tags": "тест-дел2", "created_at": "2026-07-10 10:00:00"},
], "reviews": []})
_, c = req("/api/tags/delete", "POST", {"tag": "тест-дел"})
assert c == {"deleted": 1}, c
print(f"9. видалення тега: {c}")

_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
wd1 = by_uuid(data, "test-tagd-1")
wd2 = by_uuid(data, "test-tagd-2")
assert wd1["tags"] == "дієслова", f"тег прибрано, інші лишились: {wd1['tags']}"
assert wd2["tags"] == "тест-дел2", "тег-підрядок (тест-дел2) не має зачіпатись"
print("10. тег прибрано точно по токену, інші теги й підрядки не зачеплені")

# порожній тег -> no-op
_, c = req("/api/tags/delete", "POST", {"tag": ""})
assert c == {"deleted": 0}, c
print("11. порожній тег -> no-op")

# повторне видалення того самого тега (уже відсутній) -> 0
_, c = req("/api/tags/delete", "POST", {"tag": "тест-дел"})
assert c == {"deleted": 0}, c
print("12. повторне видалення відсутнього тега -> 0")

# прибирання
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
for w in data["words"]:
    if w["uuid"].startswith("test-tagr-") or w["uuid"].startswith("test-tagd-"):
        req(f"/api/words/{w['uuid']}", "DELETE")
_, data = req("/api/sync", "POST", {"words": [], "reviews": []})
assert len(data["words"]) == base_count, len(data["words"])
print(f"13. прибирання: знову {base_count} слів")

print("\nВСЕ OK")
