"""HTTPS через mkcert — потрібен iOS для service worker/офлайну (Safari дозволяє
SW лише в "безпечному контексті", без винятків для локальної мережі)."""
import glob
import os
import shutil
import socket
import subprocess
from pathlib import Path

from flask import Blueprint, send_file

from .db import BASE_DIR

CERT_DIR = BASE_DIR / "certs"
CERT_FILE = CERT_DIR / "cert.pem"
KEY_FILE = CERT_DIR / "key.pem"
META_FILE = CERT_DIR / "meta.txt"

mkcert_bp = Blueprint("mkcert", __name__)


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


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
    if (
        META_FILE.exists()
        and CERT_FILE.exists()
        and META_FILE.read_text().strip() == ip
    ):
        return True
    CERT_DIR.mkdir(exist_ok=True)
    try:
        subprocess.run(
            [
                mkcert_path,
                "-cert-file",
                str(CERT_FILE),
                "-key-file",
                str(KEY_FILE),
                ip,
                "localhost",
                "127.0.0.1",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, OSError) as e:
        print(f"  Не вдалося згенерувати сертифікат mkcert: {e}")
        return False
    META_FILE.write_text(ip)
    return True


@mkcert_bp.route("/install-cert")
def install_cert():
    mkcert_path = find_mkcert()
    caroot = find_caroot(mkcert_path) if mkcert_path else None
    if not caroot or not (caroot / "rootCA.pem").exists():
        return "Кореневий сертифікат mkcert не знайдено на сервері.", 404
    return send_file(
        caroot / "rootCA.pem",
        mimetype="application/x-x509-ca-cert",
        download_name="mkcert-rootCA.pem",
    )
