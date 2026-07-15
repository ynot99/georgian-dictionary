"""Тест create_backup()/prune_backups()/last_backup_at() у backup_db.py, і
_seconds_until_next_backup() у app.py (логіка "скільки чекати" для автобекапу).

Напряму, без запущеного сервера — і з тимчасовою базою/текою бекапів (не
чіпає реальні backups/ користувача підміною BACKUP_DIR/DB_PATH на час тесту).
"""
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import app  # noqa: E402
import backup_db  # noqa: E402

tmp_dir = Path(tempfile.mkdtemp())
orig_db_path = backup_db.DB_PATH
orig_backup_dir = backup_db.BACKUP_DIR

try:
    backup_db.DB_PATH = tmp_dir / "dictionary.db"
    backup_db.BACKUP_DIR = tmp_dir / "backups"

    # бази ще нема -> None, нічого не падає і не створюється
    assert backup_db.create_backup() is None
    print("1. create_backup() без бази -> None")

    conn = sqlite3.connect(backup_db.DB_PATH)
    conn.execute("CREATE TABLE words (id INTEGER)")
    conn.commit()
    conn.close()

    dest = backup_db.create_backup()
    assert dest is not None and dest.exists(), dest
    assert backup_db._BACKUP_NAME_RE.match(dest.name), dest.name
    print(f"2. create_backup() створює файл за очікуваним шаблоном: {dest.name}")

    check = sqlite3.connect(dest)
    assert check.execute("SELECT COUNT(*) FROM words").fetchone()[0] == 0
    check.close()
    print("3. бекап — справжня робоча копія бази (читається, та сама схема)")

    # прибираємо файл із кроку 2 — далі тестуємо prune_backups() з повністю
    # контрольованим набором файлів (не залежним від сьогоднішньої дати)
    dest.unlink()

    # prune_backups: лишає тільки `keep` найновіших, "before-restore" не чіпає
    for d in range(1, 6):
        (backup_db.BACKUP_DIR / f"dictionary-2026-01-{d:02d}_00-00-00.db").write_bytes(b"")
    before_restore = "dictionary-before-restore-2020-01-01_00-00-00.db"
    (backup_db.BACKUP_DIR / before_restore).write_bytes(b"")

    backup_db.prune_backups(keep=3)
    remaining = sorted(p.name for p in backup_db.BACKUP_DIR.iterdir())
    assert before_restore in remaining, "ротація не має чіпати dictionary-before-restore-*.db"
    regular = sorted(n for n in remaining if n != before_restore)
    assert regular == [
        "dictionary-2026-01-03_00-00-00.db",
        "dictionary-2026-01-04_00-00-00.db",
        "dictionary-2026-01-05_00-00-00.db",
    ], regular
    print("4. prune_backups(keep=3) лишає 3 найновіші звичайні бекапи, before-restore не чіпає")

    backup_db.prune_backups(keep=0)
    remaining_after_zero = list(backup_db.BACKUP_DIR.iterdir())
    assert before_restore in [p.name for p in remaining_after_zero]
    assert all(p.name == before_restore for p in remaining_after_zero), remaining_after_zero
    print("5. prune_backups(keep=0) прибирає всі звичайні бекапи (before-restore лишається)")

    # last_backup_at(): лише "before-restore" -> None (це не звичайний бекап)
    assert backup_db.last_backup_at() is None
    print("6. last_backup_at() без звичайних бекапів -> None (before-restore не рахується)")

    for name in ["dictionary-2026-02-01_00-00-00.db", "dictionary-2026-03-15_12-30-00.db",
                 "dictionary-2026-01-01_00-00-00.db"]:
        (backup_db.BACKUP_DIR / name).write_bytes(b"")
    assert backup_db.last_backup_at() == datetime(2026, 3, 15, 12, 30, 0)
    print("7. last_backup_at() повертає найпізнішу мітку часу серед звичайних бекапів")

finally:
    backup_db.DB_PATH = orig_db_path
    backup_db.BACKUP_DIR = orig_backup_dir
    shutil.rmtree(tmp_dir, ignore_errors=True)


# app._seconds_until_next_backup(): чиста функція, без файлової системи —
# саме логіка "скільки чекати", яку викликає фоновий потік автобекапу

now = datetime.now()

assert app._seconds_until_next_backup(None, now) == 0
print("8. бекапів ще не було -> чекати 0 (робити одразу)")

remaining = app._seconds_until_next_backup(now - timedelta(hours=1), now)
assert 82790 < remaining < 82810, remaining   # ~23 год лишилось з доби
print(f"9. бекап годину тому -> лишилось чекати ~23 год: {remaining:.0f} с")

overdue = app._seconds_until_next_backup(now - timedelta(hours=30), now)
assert overdue == 0, overdue
print("10. останній бекап 30 год тому (комп'ютер довго був вимкнений) -> 0, робити одразу")

exactly_due = app._seconds_until_next_backup(now - timedelta(seconds=app.AUTO_BACKUP_INTERVAL), now)
assert exactly_due == 0, exactly_due
print("11. рівно AUTO_BACKUP_INTERVAL тому -> 0, не негативне значення")

print("\nВСЕ OK: автобекап, ротація і логіка розкладу коректні (реальні backups/ користувача не займались)")
