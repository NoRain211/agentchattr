"""Ensure agentchattr server is running. Starts it in the background if not.
Used by CC/Codex hooks to auto-start on session begin."""

import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
HOST = "127.0.0.1"
PORT = 8200


def is_running() -> bool:
    try:
        with socket.create_connection((HOST, PORT), timeout=1):
            return True
    except OSError:
        return False


def ensure_venv():
    if not VENV_PYTHON.exists():
        subprocess.run([sys.executable, "-m", "venv", str(ROOT / ".venv")], check=True)
        subprocess.run(
            [str(VENV_PYTHON), "-m", "pip", "install", "-q", "-r", str(ROOT / "requirements.txt")],
            check=True,
        )


def start_server():
    ensure_venv()
    subprocess.Popen(
        [str(VENV_PYTHON), str(ROOT / "run.py")],
        cwd=str(ROOT),
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print("agentchattr server started in background")


if __name__ == "__main__":
    if is_running():
        print("agentchattr already running")
    else:
        start_server()
