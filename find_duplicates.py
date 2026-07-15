"""Шукає слова з однаковим грузинським написанням і друкує окрему таблицю на кожну групу.

Дублікат — не завжди помилка: у грузинській є омоніми (однакове написання,
різне значення), тому застосунок при додаванні лише попереджає, але не блокує.
Тож скрипт нічого не змінює — лише показує групи, щоб вирішити вручну: лишити
як омоніми, злити чи прибрати зайве. Разом зі словом показує його SRS-прогрес —
щоб випадково не видалити саме ту копію, яку вже тренував.

Групування точно за georgian — та сама умова (`WHERE georgian = ?`), за якою
чат-інструменти (edit_word/retag_word) відмовляються редагувати неоднозначне
слово, а CSV-імпорт шукає слово без uuid. Тобто скрипт показує рівно ті групи,
які насправді заважають застосунку.
"""
import sqlite3
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "dictionary.db"

# межі ширини колонок (символів) — щоб довгий приклад не розтягував таблицю
COLUMN_LIMITS = [5, 24, 32, 18, 5, 10]
COLUMN_HEADERS = ["id", "переклад", "приклад", "теги", "SRS", "створено"]


def srs_summary(conn, word_uuid):
    """'3/1' — рівні ka→uk/uk→ka; '—', якщо слово ще не тренувалось."""
    rows = conn.execute(
        "SELECT direction, level FROM reviews WHERE word_uuid = ?", (word_uuid,)
    ).fetchall()
    if not rows:
        return "—"
    levels = {r["direction"]: r["level"] for r in rows}
    return f"{levels.get('ka2uk', 0)}/{levels.get('uk2ka', 0)}"


def find_duplicate_groups(conn):
    """[(georgian, [рядок слова, ...]), ...] — лише групи з 2+ слів,
    найбільші групи першими."""
    dupes = conn.execute(
        "SELECT georgian FROM words GROUP BY georgian HAVING COUNT(*) > 1 "
        "ORDER BY COUNT(*) DESC, georgian"
    ).fetchall()
    groups = []
    for row in dupes:
        words = conn.execute(
            "SELECT * FROM words WHERE georgian = ? ORDER BY id", (row["georgian"],)
        ).fetchall()
        groups.append((row["georgian"], words))
    return groups


def fit(text, width):
    """Обрізає до width символів (переноси рядків — у пробіли), решта — '…'."""
    text = (text or "").replace("\n", " ").strip()
    return text if len(text) <= width else text[: width - 1] + "…"


def render_table(headers, rows, limits):
    """Проста текстова таблиця: колонки за найширшим значенням, але не ширші limits."""
    cells = [[fit(str(value), limits[i]) for i, value in enumerate(row)] for row in rows]
    widths = [
        max(len(headers[i]), *(len(row[i]) for row in cells)) if cells else len(headers[i])
        for i in range(len(headers))
    ]
    lines = [" | ".join(headers[i].ljust(widths[i]) for i in range(len(headers)))]
    lines.append("-+-".join("-" * w for w in widths))
    for row in cells:
        lines.append(" | ".join(row[i].ljust(widths[i]) for i in range(len(headers))))
    return "\n".join(lines)


def group_rows(conn, words):
    return [
        [
            w["id"],
            w["translation"],
            w["example"],
            w["tags"],
            srs_summary(conn, w["uuid"]),
            (w["created_at"] or "")[:10],   # лише дата, час тут нічого не додає
        ]
        for w in words
    ]


def main():
    if not DB_PATH.exists():
        print(f"База не знайдена: {DB_PATH}")
        sys.exit(1)
    # read-only: скрипт лише звітує, тож і технічно не може нічого зіпсувати,
    # і безпечний для запуску, коли сервер працює
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        groups = find_duplicate_groups(conn)
        if not groups:
            print("Дублікатів не знайдено — усі грузинські написання унікальні.")
            return
        extra = sum(len(words) for _, words in groups) - len(groups)
        print(f"Груп дублікатів: {len(groups)} (зайвих слів: {extra}).")
        print("SRS: рівні ka→uk/uk→ka, «—» — слово ще не тренувалось.")
        print("Омоніми (однакове написання, різне значення) — нормально, це лише звіт.")
        for georgian, words in groups:
            print(f"\n{georgian}  ({len(words)} слова)")
            print(render_table(COLUMN_HEADERS, group_rows(conn, words), COLUMN_LIMITS))
    finally:
        conn.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
