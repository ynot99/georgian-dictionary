"""Точка входу: створення Flask-застосунку, реєстрація модулів, запуск сервера."""
import sys

from flask import Flask, render_template

from server.chat import chat_bp
from server.db import close_db, init_db
from server.mkcert import CERT_FILE, KEY_FILE, ensure_cert, find_mkcert, local_ip, mkcert_bp
from server.words import words_bp

app = Flask(__name__)
app.register_blueprint(words_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(mkcert_bp)
app.teardown_appcontext(close_db)


@app.after_request
def no_cache(response):
    # щоб браузер на телефоні ніколи не показував застарілу версію
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/sw.js")
def service_worker():
    return app.send_static_file("sw.js")


if __name__ == "__main__":
    # консоль Windows за замовчуванням не UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    init_db()

    ip = local_ip()
    mkcert_path = find_mkcert()
    ssl_context = None
    if mkcert_path and ensure_cert(ip, mkcert_path):
        ssl_context = (str(CERT_FILE), str(KEY_FILE))

    port = 5000
    scheme = "https" if ssl_context else "http"
    print()
    print("  Словник запущено!")
    print(f"  На цьому комп'ютері:  {scheme}://127.0.0.1:{port}")
    print(f"  З телефону (Wi-Fi):   {scheme}://{ip}:{port}")
    if ssl_context:
        print(f"  Разово на iPhone: відкрий {scheme}://{ip}:{port}/install-cert,")
        print(
            "  встанови профіль (Settings > General > VPN & Device Management > Install),"
        )
        print(
            "  потім увімкни довіру (Settings > General > About > Certificate Trust Settings)."
        )
    else:
        print(
            "  mkcert не знайдено — офлайн-режим на iPhone працювати не буде (потрібен HTTPS)."
        )
    print()
    app.run(host="0.0.0.0", port=port, debug=False, ssl_context=ssl_context)
