import csv
import glob
import io
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import uuid as uuidlib
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, redirect, render_template, request, url_for, Response, send_file

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "dictionary.db"

app = Flask(__name__)


# ---------- database ----------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT,
                georgian TEXT NOT NULL,
                translation TEXT NOT NULL,
                example TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        # міграція старої бази без колонки uuid
        cols = [row[1] for row in db.execute("PRAGMA table_info(words)")]
        if "uuid" not in cols:
            db.execute("ALTER TABLE words ADD COLUMN uuid TEXT")
        for (word_id,) in db.execute(
            "SELECT id FROM words WHERE uuid IS NULL OR uuid = ''"
        ).fetchall():
            db.execute("UPDATE words SET uuid = ? WHERE id = ?",
                       (str(uuidlib.uuid4()), word_id))
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_words_uuid ON words(uuid)")
        # прогрес SRS-повторень: одна картка = слово + напрямок (ka2uk / uk2ka)
        db.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                word_uuid TEXT NOT NULL,
                direction TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 0,
                due_at TEXT NOT NULL,
                reviewed_at TEXT NOT NULL,
                PRIMARY KEY (word_uuid, direction)
            )
        """)


def utcnow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def word_dict(row):
    return {
        "id": row["id"],
        "uuid": row["uuid"],
        "georgian": row["georgian"],
        "translation": row["translation"],
        "example": row["example"],
        "created_at": row["created_at"],
    }


def review_dict(row):
    return {
        "word_uuid": row["word_uuid"],
        "direction": row["direction"],
        "level": row["level"],
        "due_at": row["due_at"],
        "reviewed_at": row["reviewed_at"],
    }


@app.after_request
def no_cache(response):
    # щоб браузер на телефоні ніколи не показував застарілу версію
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------- routes ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/sw.js")
def service_worker():
    return app.send_static_file("sw.js")


@app.route("/api/words")
def api_words():
    rows = get_db().execute("SELECT * FROM words ORDER BY id DESC").fetchall()
    return {"words": [word_dict(r) for r in rows]}


@app.route("/api/sync", methods=["POST"])
def api_sync():
    """Приймає несинхронізовані слова і прогрес повторень, повертає повний стан.

    Слова: дедуплікація по uuid (INSERT OR IGNORE).
    Повторення: last-write-wins по reviewed_at — новіша оцінка перекриває старішу.
    """
    payload = request.get_json(silent=True) or {}
    db = get_db()
    for w in payload.get("words", []):
        georgian = (w.get("georgian") or "").strip()
        translation = (w.get("translation") or "").strip()
        if not (georgian and translation):
            continue
        db.execute(
            "INSERT OR IGNORE INTO words (uuid, georgian, translation, example, "
            "created_at) VALUES (?, ?, ?, ?, ?)",
            ((w.get("uuid") or "").strip() or str(uuidlib.uuid4()),
             georgian, translation, (w.get("example") or "").strip(),
             (w.get("created_at") or "").strip() or utcnow()),
        )
    for r in payload.get("reviews", []):
        word_uuid = (r.get("word_uuid") or "").strip()
        direction = r.get("direction")
        due_at = (r.get("due_at") or "").strip()
        reviewed_at = (r.get("reviewed_at") or "").strip()
        if direction not in ("ka2uk", "uk2ka") or not (word_uuid and due_at and reviewed_at):
            continue
        word_exists = db.execute(
            "SELECT 1 FROM words WHERE uuid = ?", (word_uuid,)).fetchone()
        if not word_exists:
            continue
        existing = db.execute(
            "SELECT reviewed_at FROM reviews WHERE word_uuid = ? AND direction = ?",
            (word_uuid, direction)).fetchone()
        if existing is None or reviewed_at > existing["reviewed_at"]:
            db.execute(
                "INSERT OR REPLACE INTO reviews (word_uuid, direction, level, "
                "due_at, reviewed_at) VALUES (?, ?, ?, ?, ?)",
                (word_uuid, direction, int(r.get("level") or 0),
                 due_at, reviewed_at),
            )
    db.commit()
    words = db.execute("SELECT * FROM words ORDER BY id DESC").fetchall()
    reviews = db.execute("SELECT * FROM reviews").fetchall()
    return {"words": [word_dict(r) for r in words],
            "reviews": [review_dict(r) for r in reviews]}


@app.route("/api/words/<word_uuid>", methods=["DELETE"])
def api_delete(word_uuid):
    db = get_db()
    db.execute("DELETE FROM words WHERE uuid = ?", (word_uuid,))
    db.execute("DELETE FROM reviews WHERE word_uuid = ?", (word_uuid,))
    db.commit()
    return {"ok": True}


@app.route("/edit/<int:word_id>", methods=["GET", "POST"])
def edit(word_id):
    db = get_db()
    word = db.execute("SELECT * FROM words WHERE id = ?", (word_id,)).fetchone()
    if word is None:
        return redirect(url_for("index"))
    if request.method == "POST":
        georgian = request.form.get("georgian", "").strip()
        translation = request.form.get("translation", "").strip()
        example = request.form.get("example", "").strip()
        if georgian and translation:
            db.execute(
                "UPDATE words SET georgian = ?, translation = ?, example = ? "
                "WHERE id = ?",
                (georgian, translation, example, word_id),
            )
            db.commit()
        return redirect(url_for("index"))
    return render_template("edit.html", word=word)


@app.route("/export.csv")
def export_csv():
    db = get_db()
    rows = db.execute(
        "SELECT georgian, translation, example, created_at FROM words ORDER BY id"
    ).fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["georgian", "translation", "example", "created_at"])
    for row in rows:
        writer.writerow([row["georgian"], row["translation"],
                         row["example"], row["created_at"]])
    # BOM, щоб Excel коректно відкривав UTF-8
    data = "﻿" + buf.getvalue()
    filename = f"dictionary-{datetime.now().strftime('%Y-%m-%d')}.csv"
    return Response(
        data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------- startup ----------

def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


# ---------- HTTPS через mkcert (потрібен iOS для service worker/офлайну) ----------

CERT_DIR = BASE_DIR / "certs"
CERT_FILE = CERT_DIR / "cert.pem"
KEY_FILE = CERT_DIR / "key.pem"
META_FILE = CERT_DIR / "meta.txt"


def find_mkcert():
    exe = shutil.which("mkcert")
    if exe:
        return exe
    # winget кладе mkcert у версійовану папку, яка не одразу в PATH
    pattern = os.path.expandvars(
        r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\FiloSottile.mkcert_*\mkcert.exe"
    )
    matches = glob.glob(pattern)
    return matches[0] if matches else None


def find_caroot(mkcert_path):
    try:
        out = subprocess.check_output([mkcert_path, "-CAROOT"], text=True)
        return Path(out.strip())
    except (subprocess.CalledProcessError, OSError):
        return None


def ensure_cert(ip, mkcert_path):
    """Генерує сертифікат для поточної IP-адреси; перегенеровує, якщо IP змінилась."""
    if META_FILE.exists() and CERT_FILE.exists() and META_FILE.read_text().strip() == ip:
        return True
    CERT_DIR.mkdir(exist_ok=True)
    try:
        subprocess.run(
            [mkcert_path, "-cert-file", str(CERT_FILE), "-key-file", str(KEY_FILE),
             ip, "localhost", "127.0.0.1"],
            check=True, capture_output=True, text=True,
        )
    except (subprocess.CalledProcessError, OSError) as e:
        print(f"  Не вдалося згенерувати сертифікат mkcert: {e}")
        return False
    META_FILE.write_text(ip)
    return True


@app.route("/install-cert")
def install_cert():
    mkcert_path = find_mkcert()
    caroot = find_caroot(mkcert_path) if mkcert_path else None
    if not caroot or not (caroot / "rootCA.pem").exists():
        return "Кореневий сертифікат mkcert не знайдено на сервері.", 404
    return send_file(caroot / "rootCA.pem", mimetype="application/x-x509-ca-cert",
                      download_name="mkcert-rootCA.pem")


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
        print("  встанови профіль (Settings > General > VPN & Device Management > Install),")
        print("  потім увімкни довіру (Settings > General > About > Certificate Trust Settings).")
    else:
        print("  mkcert не знайдено — офлайн-режим на iPhone працювати не буде (потрібен HTTPS).")
    print()
    app.run(host="0.0.0.0", port=port, debug=False, ssl_context=ssl_context)
