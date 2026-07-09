"""Тест API чату: історія, конфігурація, валідація.

НЕ відправляє справжніх повідомлень до Claude — це коштує грошей за токени,
тож не має відбуватись автоматично щоразу під час прогону тестів. Перевіряє
лише шляхи, які не доходять до платного виклику API. Потребує запущений
сервер (python app.py).
"""
import sys

from _client import check_server, req

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
check_server()

status, data = req("/api/chat")
assert status == 200 and "configured" in data and "messages" in data, data
configured = data["configured"]
print(f"1. GET /api/chat: configured={configured}, повідомлень: {len(data['messages'])}")

# порожнє повідомлення відкидається ДО виклику Claude незалежно від наявності ключа
status, data = req("/api/chat", "POST", {"message": "   "})
if configured:
    assert status == 400, (status, data)
    print("2. порожнє повідомлення (ключ налаштований) -> 400, без виклику API")
else:
    assert status == 503 and ".env" in data["error"], (status, data)
    print("2. без ключа -> 503 з підказкою про .env")

print("\nВСЕ OK (жодного платного повідомлення до Claude не надіслано)")
