"""E2E тест довідника: додавання, оновлення за (georgian, pos), валідація, версія.

Створює лише тестові записи (pos "test-catalog") і видаляє їх за собою —
безпечно запускати проти реальної бази. Потребує запущений сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()

POS = "test-catalog"


def mine(data):
    return [e for e in data["entries"] if e["pos"] == POS]


_, before = req("/api/sync", "POST", {"words": [], "reviews": []})
version_before = before["catalog_version"]

try:
    entry = {"georgian": "წყალი", "pos": POS, "translation": "вода", "gloss": "water",
             "forms": "წყლის  წყალს წყლით", "rank": 7}
    status, res = req("/api/catalog", "POST", {"entries": [entry, {"georgian": "", "translation": "x"},
                                                             {"georgian": "x", "translation": ""}]})
    assert status == 200 and res == {"created": 1, "updated": 0, "invalid": [1, 2]}, res
    print("1. запис додано, порожні відхилено")

    _, data = req("/api/catalog")
    rows = mine(data)
    assert len(rows) == 1 and rows[0]["forms"] == "წყლის წყალს წყლით", rows
    assert rows[0]["rank"] == 7 and rows[0]["gloss"] == "water", rows
    print("2. /api/catalog повертає запис із нормалізованими формами")

    _, res = req("/api/catalog", "POST", {"entries": [{**entry, "translation": "вода, водичка"}]})
    assert res == {"created": 0, "updated": 1, "invalid": []}, res
    _, data = req("/api/catalog")
    rows = mine(data)
    assert len(rows) == 1 and rows[0]["translation"] == "вода, водичка", rows
    print("3. повторне надсилання оновлює запис, а не дублює")

    _, after = req("/api/sync", "POST", {"words": [], "reviews": []})
    assert after["catalog_version"] != version_before, after["catalog_version"]
    assert data["version"] == after["catalog_version"]
    print("4. версія довідника в /api/sync змінилась")
finally:
    _, data = req("/api/catalog")
    for row in mine(data):
        req(f"/api/catalog/{row['id']}", "DELETE")

_, data = req("/api/catalog")
assert not mine(data)
print("5. тестові записи видалено")
print("OK")
