"""Тест вправ від моделі (server/ai.py): генерація, збереження, редагування,
перевірка й видалення.

Без запущеного сервера: Flask test_client на тимчасовій базі, а запит до
OpenRouter підмінено фейком — справжній API тести не викликають (це платно).
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import app  # noqa: E402
from server import ai, db  # noqa: E402

tmp_dir = Path(tempfile.mkdtemp())
orig_db_path = db.DB_PATH
orig_call = ai.call_openrouter
orig_env = {k: os.environ.get(k) for k in ("OPENROUTER_API_KEY", "OPENROUTER_MODEL")}

calls = []
replies = []


def fake_call(messages, model, api_key):
    calls.append(messages)
    return replies.pop(0), {"model": model, "cost": 0.0005, "prompt_tokens": 100,
                            "completion_tokens": 50}


def reply(*items):
    return json.dumps({"exercises": list(items)}, ensure_ascii=False)


try:
    db.DB_PATH = tmp_dir / "dictionary.db"
    db.init_db()
    ai.call_openrouter = fake_call
    client = app.app.test_client()
    client.post("/api/sync", json={"words": [
        {"uuid": "w-1", "georgian": "ბინა", "translation": "квартира", "example": "",
         "tags": "", "created_at": "2026-01-01 00:00:00"},
        {"uuid": "w-2", "georgian": "წყალი", "translation": "вода", "example": "",
         "tags": "", "created_at": "2026-01-01 00:00:00"},
    ]})

    # без ключа генерація вимкнена, список працює
    os.environ.pop("OPENROUTER_API_KEY", None)
    os.environ["OPENROUTER_MODEL"] = "test/model"
    r = client.post("/api/ai/exercises/generate", json={"word_uuids": ["w-1"]})
    assert r.status_code == 503, r.get_json()
    assert client.get("/api/ai/exercises").get_json()["enabled"] is False
    assert not calls
    print("1. без ключа: 503, модель не викликається")

    os.environ["OPENROUTER_API_KEY"] = "test-key"
    # відповідь у ```json```, плюс непридатні: чужий id, дубль слова, еталон кирилицею
    replies.append("```json\n" + reply(
        {"word": "w1", "uk": "Наша квартира велика.", "ka": "ჩვენი ბინა დიდია.", "hint": "-ია = є"},
        {"word": "w1", "uk": "Дубль.", "ka": "ბინა.", "hint": ""},
        {"word": "w9", "uk": "Чуже слово.", "ka": "სხვა.", "hint": ""},
        {"word": "w2", "uk": "Я п'ю воду.", "ka": "Я п'ю воду.", "hint": ""},
    ) + "\n```")
    r = client.post("/api/ai/exercises/generate", json={"word_uuids": ["w-1", "w-2", "w-1"]})
    data = r.get_json()
    assert r.status_code == 200, data
    assert len(data["exercises"]) == 1 and data["skipped"] == 1, data
    ex = data["exercises"][0]
    assert ex["word_uuid"] == "w-1" and ex["georgian"] == "ბინა" and ex["model"] == "test/model"
    assert ex["answer"] == "ჩვენი ბინა დიდია." and ex["review"] == "" and ex["flagged"] is False
    sent = json.loads(calls[-1][1]["content"])
    assert [w["word"] for w in sent] == ["w1", "w2"], "дубль uuid не надсилається двічі"
    print("2. придатна вправа збережена, чужий id / дубль / кирилиця в еталоні відкинуті")

    # незрозуміла відповідь — один повтор, тоді 502; обидві спроби в журналі
    replies.extend(["не json", "{}"])
    r = client.post("/api/ai/exercises/generate", json={"word_uuids": ["w-2"]})
    assert r.status_code == 502, r.get_json()
    assert not replies, "мала бути рівно одна повторна спроба"
    listing = client.get("/api/ai/exercises").get_json()
    assert listing["enabled"] and len(listing["exercises"]) == 1
    assert abs(listing["spent"] - 0.0015) < 1e-9, listing["spent"]
    print("3. незрозуміла відповідь: повтор, 502, вартість усіх спроб у журналі")

    # помилка API — без повтору
    def failing_call(messages, model, api_key):
        calls.append(messages)
        raise ai.AiError("На OpenRouter закінчились кредити.")
    ai.call_openrouter = failing_call
    before = len(calls)
    r = client.post("/api/ai/exercises/generate", json={"word_uuids": ["w-2"]})
    assert r.status_code == 502 and "кредити" in r.get_json()["error"]
    assert len(calls) == before + 1
    ai.call_openrouter = fake_call
    print("4. помилка API показується як є, без повторної платної спроби")

    # перевірка Claude, позначка учня, редагування тексту скидає обидві
    url = f"/api/ai/exercises/{ex['id']}"
    r = client.patch(url, json={"review": "bad", "review_note": "має бути დიდია"})
    assert r.get_json()["review"] == "bad" and r.get_json()["review_note"] == "має бути დიდია"
    assert client.patch(url, json={"review": "maybe"}).status_code == 400
    assert client.patch(url, json={"flagged": True}).get_json()["flagged"] is True
    assert client.patch(url, json={"answer": "  "}).status_code == 400
    same = client.patch(url, json={"hint": "-ია = є"}).get_json()
    assert same["review"] == "bad" and same["flagged"], "незмінений текст перевірку не скидає"
    edited = client.patch(url, json={"answer": "ჩვენი ბინა დიდია!"}).get_json()
    assert edited["answer"] == "ჩვენი ბინა დიდია!"
    assert edited["review"] == "" and edited["review_note"] == "" and not edited["flagged"]
    ok = client.patch(url, json={"answer": "ჩვენი ბინა დიდია.", "review": "ok"}).get_json()
    assert ok["review"] == "ok", "перевірка разом із виправленням зберігається"
    assert client.patch("/api/ai/exercises/999999", json={}).status_code == 404
    print("5. review / flagged / редагування працюють, зміна тексту скидає перевірку")

    # видалення слова прибирає і його вправи; окреме видалення вправи
    replies.append(reply({"word": "w1", "uk": "Вода холодна.", "ka": "წყალი ცივია.", "hint": ""}))
    second = client.post("/api/ai/exercises/generate", json={"word_uuids": ["w-2"]}).get_json()
    client.delete("/api/words/w-1")
    left = client.get("/api/ai/exercises").get_json()["exercises"]
    assert [e["word_uuid"] for e in left] == ["w-2"], left
    client.delete(f"/api/ai/exercises/{second['exercises'][0]['id']}")
    assert client.get("/api/ai/exercises").get_json()["exercises"] == []
    print("6. видалення слова каскадно прибирає вправи, вправу можна видалити окремо")

    print("\ntest_ai_exercises: OK")
finally:
    db.DB_PATH = orig_db_path
    ai.call_openrouter = orig_call
    for key, value in orig_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
