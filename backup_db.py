"""Створює копію dictionary.db у backups/ з міткою часу.

Використовує SQLite Online Backup API (Connection.backup()) — на відміну від
звичайного копіювання файлу, це безпечно робити навіть коли сервер (app.py)
запущений і в базу саме йде запис. create_backup()/prune_backups() викликає і
цей CLI вручну, і фоновий потік автобекапу в app.py (AUTO_BACKUP_INTERVAL).
"""
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "dictionary.db"
BACKUP_DIR = BASE_DIR / "backups"

# скільки останніх бекапів лишати — і для ручного запуску, і для автобекапу
DEFAULT_KEEP = 30

# лише звичайні бекапи з міткою часу — НЕ чіпає dictionary-before-restore-*.db
# (їх свідомо створює restore_db.py як разову страховку перед відновленням,
# і автоматична ротація не повинна їх мовчки прибирати)
_BACKUP_NAME_RE = re.compile(r"^dictionary-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$")


def last_backup_at():
    """Час останнього ЗВИЧАЙНОГО бекапу (datetime), або None, якщо жодного ще
    нема. Мітка часу береться з імені файлу (не mtime) — так само надійно, а
    і не залежить від того, чи копіювання файлу зберегло час модифікації."""
    if not BACKUP_DIR.exists():
        return None
    stamps = []
    for p in BACKUP_DIR.iterdir():
        if _BACKUP_NAME_RE.match(p.name):
            stamp = p.name[len("dictionary-"):-len(".db")]
            stamps.append(datetime.strptime(stamp, "%Y-%m-%d_%H-%M-%S"))
    return max(stamps) if stamps else None


def create_backup():
    """Створює новий бекап і повертає шлях до нього; None, якщо бази ще нема."""
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dest_path = BACKUP_DIR / f"dictionary-{stamp}.db"

    src = sqlite3.connect(DB_PATH)
    dest = sqlite3.connect(dest_path)
    with dest:
        src.backup(dest)
    src.close()
    dest.close()
    return dest_path


def prune_backups(keep=DEFAULT_KEEP):
    """Лишає лише `keep` найновіших звичайних бекапів, старіші видаляє."""
    if not BACKUP_DIR.exists():
        return
    backups = sorted(p for p in BACKUP_DIR.iterdir() if _BACKUP_NAME_RE.match(p.name))
    for old in backups[:-keep] if keep > 0 else backups:
        old.unlink()


def main():
    dest_path = create_backup()
    if dest_path is None:
        print(f"База не знайдена: {DB_PATH}")
        sys.exit(1)
    print(f"Бекап створено: {dest_path}")
    prune_backups()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
