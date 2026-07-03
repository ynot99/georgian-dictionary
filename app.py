import csv
import io
import socket
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, redirect, render_template, request, url_for, Response

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
                georgian TEXT NOT NULL,
                translation TEXT NOT NULL,
                example TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)


@app.after_request
def no_cache(response):
    # щоб браузер на телефоні ніколи не показував застарілу версію
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------- routes ----------

@app.route("/")
def index():
    q = request.args.get("q", "").strip()
    db = get_db()
    if q:
        rows = db.execute(
            "SELECT * FROM words WHERE georgian LIKE ? OR translation LIKE ? "
            "ORDER BY id DESC",
            (f"%{q}%", f"%{q}%"),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM words ORDER BY id DESC").fetchall()
    total = db.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    return render_template("index.html", words=rows, q=q, total=total)


@app.route("/add", methods=["POST"])
def add():
    georgian = request.form.get("georgian", "").strip()
    translation = request.form.get("translation", "").strip()
    example = request.form.get("example", "").strip()
    if georgian and translation:
        db = get_db()
        db.execute(
            "INSERT INTO words (georgian, translation, example, created_at) "
            "VALUES (?, ?, ?, ?)",
            (georgian, translation, example,
             datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
        )
        db.commit()
    return redirect(url_for("index"))


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


@app.route("/delete/<int:word_id>", methods=["POST"])
def delete(word_id):
    db = get_db()
    db.execute("DELETE FROM words WHERE id = ?", (word_id,))
    db.commit()
    return redirect(url_for("index"))


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


if __name__ == "__main__":
    # консоль Windows за замовчуванням не UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    init_db()
    port = 5000
    print()
    print("  Словник запущено!")
    print(f"  На цьому комп'ютері:  http://127.0.0.1:{port}")
    print(f"  З телефону (Wi-Fi):   http://{local_ip()}:{port}")
    print()
    app.run(host="0.0.0.0", port=port, debug=False)
