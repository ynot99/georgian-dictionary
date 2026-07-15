"""Точка входу: створення Flask-застосунку, реєстрація модулів, запуск сервера."""
import sys
import threading
import time
from datetime import datetime

from flask import Flask, render_template

from backup_db import create_backup, last_backup_at, prune_backups
from server.chat import chat_bp
from server.db import close_db, init_db
from server.mkcert import CERT_FILE, KEY_FILE, ensure_cert, find_mkcert, local_ip, mkcert_bp
from server.words import words_bp

AUTO_BACKUP_INTERVAL = 24 * 60 * 60  # раз на добу

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


def _seconds_until_next_backup(last, now):
    """0, якщо бекапів ще не було або інтервал уже минув (робимо одразу);
    інакше — скільки секунд лишилось чекати до наступного запланованого
    бекапу. Винесено окремою чистою функцією (без сну/циклу), щоб можна було
    перевірити тестом саму логіку "скільки чекати", не запускаючи фоновий потік."""
    if last is None:
        return 0
    return max(0, AUTO_BACKUP_INTERVAL - (now - last).total_seconds())


def _auto_backup_loop():
    """Бекап раз на AUTO_BACKUP_INTERVAL — але прив'язаний до РЕАЛЬНОГО часу
    останнього бекапу (з файлів у backups/), а не до "сервер працює 24 год
    поспіль": комп'ютер не завжди увімкнений (dual-boot, вимкнення на ніч),
    тож при кожному старті рахуємо, скільки часу лишилось до наступного
    запланованого бекапу. Якщо бекапів ще не було, або минуло більше
    інтервалу (комп'ютер довго був вимкнений) — робимо одразу; якщо минуло
    менше (частий перезапуск сервера) — чекаємо залишок, щоб не плодити
    майже-дублікати."""
    while True:
        wait = _seconds_until_next_backup(last_backup_at(), datetime.now())
        if wait > 0:
            time.sleep(wait)
        try:
            create_backup()
            prune_backups()
        except Exception as e:
            # НЕ AUTO_BACKUP_INTERVAL: якщо create_backup() постійно падає,
            # last_backup_at() не оновлюється, і без цієї паузи цикл вище
            # рахував би "прострочено" (wait=0) і молотив спробами миттєво
            print(f"  Автобекап бази не вдався: {e}")
            time.sleep(60)


if __name__ == "__main__":
    # консоль Windows за замовчуванням не UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    init_db()
    threading.Thread(target=_auto_backup_loop, daemon=True).start()

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
    # threaded=True: без цього однопотоковий dev-сервер блокує геть усі інші
    # запити (навіть відкрити сторінку в іншій вкладці) на весь час стрімінгу
    # відповіді чату — а саме цього фонова генерація й мала уникнути
    app.run(host="0.0.0.0", port=port, debug=False, ssl_context=ssl_context, threaded=True)
