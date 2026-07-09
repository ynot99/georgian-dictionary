"""Спільний HTTP-клієнт для серверних тестів. Не є тестом сам по собі."""
import json
import os
import urllib.error
import urllib.request

BASE_URL = os.environ.get("DICTIONARY_URL", "https://127.0.0.1:5000")


def req(path, method="GET", body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        BASE_URL + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(r) as resp:
            payload = resp.read().decode("utf-8-sig")
            return resp.status, (payload if raw else json.loads(payload))
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8-sig")
        try:
            return e.code, json.loads(payload)
        except json.JSONDecodeError:
            return e.code, payload


def check_server():
    try:
        urllib.request.urlopen(BASE_URL + "/api/words", timeout=3)
    except Exception as e:
        raise SystemExit(
            f"Не вдалося з'єднатися з {BASE_URL} ({e}).\n"
            f"Запусти сервер (python app.py) перед тестами."
        )
