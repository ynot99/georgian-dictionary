"""Прогонити всі тести: `python tests/run_all.py`.

Перед запуском стартуй сервер в іншому вікні (python app.py). Ганяє серверні
тести (tests/test_*.py, потрібен запущений сервер) і клієнтські (tests/js/test_*.js,
потрібен Node.js) — вони перевіряють JS-логіку прямо з templates/index.html.
"""
import subprocess
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).parent
sys.path.insert(0, str(TESTS_DIR))

from _client import check_server  # noqa: E402


def run(cmd, cwd):
    result = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return result.returncode == 0, (result.stdout + result.stderr)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    check_server()

    py_tests = sorted(TESTS_DIR.glob("test_*.py"))
    js_tests = sorted((TESTS_DIR / "js").glob("test_*.js"))

    results = []
    for f in py_tests:
        ok, output = run([sys.executable, str(f)], cwd=TESTS_DIR)
        results.append((f"python/{f.name}", ok, output))
    for f in js_tests:
        ok, output = run(["node", str(f)], cwd=TESTS_DIR / "js")
        results.append((f"js/{f.name}", ok, output))

    failed = [name for name, ok, _ in results if not ok]
    for name, ok, output in results:
        print(f"[{'OK  ' if ok else 'FAIL'}] {name}")
        if not ok:
            print(output.strip())
            print()

    print(f"\n{len(results) - len(failed)}/{len(results)} тестів пройшло.")
    if failed:
        print("Провалились:", ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
