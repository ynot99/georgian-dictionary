"""Тест find_duplicates.py — пошуку слів з однаковим грузинським написанням.

Напряму, без сервера, на тимчасовій базі (реальна dictionary.db не чіпається:
DB_PATH підміняється на час тесту, а сам скрипт її й так відкриває read-only).
"""
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import find_duplicates  # noqa: E402

tmp_dir = Path(tempfile.mkdtemp())
orig_db_path = find_duplicates.DB_PATH

try:
    find_duplicates.DB_PATH = tmp_dir / "dictionary.db"
    conn = sqlite3.connect(find_duplicates.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE words (id INTEGER PRIMARY KEY, uuid TEXT, georgian TEXT, "
        "translation TEXT, example TEXT, tags TEXT, created_at TEXT)"
    )
    conn.execute(
        "CREATE TABLE reviews (word_uuid TEXT, direction TEXT, level INTEGER, "
        "due_at TEXT, reviewed_at TEXT, lapses INTEGER)"
    )

    def add(word_id, uuid, georgian, translation, example="", tags=""):
        conn.execute(
            "INSERT INTO words VALUES (?, ?, ?, ?, ?, ?, ?)",
            (word_id, uuid, georgian, translation, example, tags, "2026-01-05 10:00:00"),
        )

    # унікальне слово — у звіт не потрапляє
    add(1, "u-1", "ხე", "дерево")
    # дублікат на 2 слова
    add(2, "u-2", "ბუ", "сова", "ბუ ხეზე ზის", "тварини")
    add(3, "u-3", "ბუ", "сова (птах)")
    # дублікат на 3 слова — має йти першим (найбільша група)
    add(4, "u-4", "წელი", "рік")
    add(5, "u-5", "წელი", "талія")
    add(6, "u-6", "წელი", "поперек")
    conn.commit()

    groups = find_duplicates.find_duplicate_groups(conn)
    assert [g[0] for g in groups] == ["წელი", "ბუ"], [g[0] for g in groups]
    print("1. знайдено лише групи з 2+ слів, найбільша — першою (унікальне 'ხე' не потрапило)")

    assert [w["id"] for w in groups[0][1]] == [4, 5, 6]
    assert [w["id"] for w in groups[1][1]] == [2, 3]
    print("2. у кожній групі всі її слова, впорядковані за id")

    # SRS: без прогресу -> «—»
    assert find_duplicates.srs_summary(conn, "u-3") == "—"
    print("3. srs_summary() для нетренованого слова -> «—»")

    conn.execute(
        "INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?)",
        ("u-2", "ka2uk", 3, "2026-02-01 00:00:00", "2026-01-05 00:00:00", 0),
    )
    conn.execute(
        "INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?)",
        ("u-2", "uk2ka", 1, "2026-01-20 00:00:00", "2026-01-05 00:00:00", 0),
    )
    conn.commit()
    assert find_duplicates.srs_summary(conn, "u-2") == "3/1"
    print("4. srs_summary() показує рівні обох напрямків: ka→uk/uk→ka")

    # лише один напрямок тренувався -> другий рахується як 0, а не як «—»
    conn.execute(
        "INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?)",
        ("u-5", "ka2uk", 2, "2026-02-01 00:00:00", "2026-01-05 00:00:00", 0),
    )
    conn.commit()
    assert find_duplicates.srs_summary(conn, "u-5") == "2/0"
    print("5. тренований лише один напрямок -> '2/0' (а не «—»)")

    # база без жодного дубліката -> порожній звіт, не падає
    conn.execute("DELETE FROM words WHERE georgian != 'ხე'")
    conn.commit()
    assert find_duplicates.find_duplicate_groups(conn) == []
    print("6. база без дублікатів -> порожній список груп")

    conn.close()
finally:
    find_duplicates.DB_PATH = orig_db_path
    shutil.rmtree(tmp_dir, ignore_errors=True)


# --- чисті хелпери відображення (без бази) ---

assert find_duplicates.fit("коротко", 20) == "коротко"
assert find_duplicates.fit("дуже довгий текст", 10) == "дуже довг…"
assert find_duplicates.fit("рядок\nз переносом", 40) == "рядок з переносом"
assert find_duplicates.fit(None, 10) == ""
print("7. fit() обрізає задовге, прибирає переноси, витримує None")

table = find_duplicates.render_table(
    ["id", "переклад"], [[2, "сова"], [3, "сова (птах)"]], [5, 24]
)
lines = table.split("\n")
assert lines[0] == "id | переклад   ", repr(lines[0])
assert lines[1] == "---+------------", repr(lines[1])
assert lines[2] == "2  | сова       ", repr(lines[2])
assert lines[3] == "3  | сова (птах)", repr(lines[3])
print("8. render_table() вирівнює колонки за найширшим значенням")

# колонка ширша за ліміт -> значення обрізається, таблиця не розповзається
table = find_duplicates.render_table(["приклад"], [["ბუ ხეზე ზის და უყურებს"]], [10])
assert table.split("\n")[2] == "ბუ ხეზე ზ…", repr(table.split("\n")[2])
print("9. render_table() тримає колонку в межах ліміту ширини")

print("\nВСЕ OK: пошук дублікатів і таблиці коректні (реальна база не чіпалась)")
