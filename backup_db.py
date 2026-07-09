"""Створює копію dictionary.db у backups/ з міткою часу.

Використовує SQLite Online Backup API (Connection.backup()) — на відміну від
звичайного копіювання файлу, це безпечно робити навіть коли сервер (app.py)
запущений і в базу саме йде запис.
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "dictionary.db"
BACKUP_DIR = BASE_DIR / "backups"


def main():
    if not DB_PATH.exists():
        print(f"База не знайдена: {DB_PATH}")
        sys.exit(1)

    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dest_path = BACKUP_DIR / f"dictionary-{stamp}.db"

    src = sqlite3.connect(DB_PATH)
    dest = sqlite3.connect(dest_path)
    with dest:
        src.backup(dest)
    src.close()
    dest.close()

    print(f"Бекап створено: {dest_path}")


if __name__ == "__main__":
    main()
