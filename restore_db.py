"""Відновлює dictionary.db з бекапу, створеного backup_db.py.

За замовчуванням бере НАЙНОВІШИЙ файл з backups/. Можна вказати конкретний
бекап аргументом командного рядка — повним шляхом або просто іменем файлу
всередині backups/:

    python restore_db.py
    python restore_db.py dictionary-2026-07-09_23-41-05.db

Перед заміною поточна dictionary.db переміщується (не видаляється) в
backups/ з позначкою "before-restore" — щоб випадково не втратити те, що
було, якщо відновлення виявиться помилкою.

ВАЖЛИВО: зупини сервер (python app.py) перед запуском цього скрипта.
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "dictionary.db"
BACKUP_DIR = BASE_DIR / "backups"


def latest_backup():
    backups = sorted(BACKUP_DIR.glob("dictionary-*.db"))
    return backups[-1] if backups else None


def resolve_source(arg):
    """Приймає повний шлях, шлях відносно поточної теки, або просто ім'я
    файлу всередині backups/."""
    candidate = Path(arg)
    if candidate.exists():
        return candidate
    candidate = BACKUP_DIR / arg
    if candidate.exists():
        return candidate
    return None


def check_valid_db(path):
    """Легка перевірка, що це справді наша база, а не сторонній/пошкоджений файл."""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        conn.execute("SELECT COUNT(*) FROM words")
        conn.close()
        return True
    except sqlite3.Error as e:
        print(f"Файл не схожий на коректну базу словника: {e}")
        return False


def main():
    if len(sys.argv) > 1:
        source = resolve_source(sys.argv[1])
        if source is None:
            print(f"Бекап не знайдено: {sys.argv[1]} (шукав і в backups/)")
            sys.exit(1)
    else:
        source = latest_backup()
        if source is None:
            print(f"У {BACKUP_DIR} немає жодного бекапу (dictionary-*.db).")
            print("Спершу створи бекап: python backup_db.py")
            sys.exit(1)

    if not check_valid_db(source):
        sys.exit(1)

    print(f"Відновлюю з: {source}")
    answer = input(
        "Це замінить поточну dictionary.db (стара версія збережеться в "
        "backups/). Продовжити? [y/N]: "
    ).strip().lower()
    if answer not in ("y", "yes", "так", "т"):
        print("Скасовано.")
        return

    if DB_PATH.exists():
        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        archived = BACKUP_DIR / f"dictionary-before-restore-{stamp}.db"
        DB_PATH.rename(archived)
        print(f"Поточну базу переміщено в: {archived}")

    # копіюємо через SQLite backup API (не просто shutil.copy), щоб коректно
    # відновити і з бекапу, який хтось міг лишити у стані з відкритим WAL
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dest = sqlite3.connect(DB_PATH)
    with dest:
        src.backup(dest)
    src.close()
    dest.close()

    print(f"Готово: {DB_PATH} відновлено з {source.name}")


if __name__ == "__main__":
    main()
