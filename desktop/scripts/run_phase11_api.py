"""Launch backend for Phase 11 verify: SQLite + host-reachable services."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.environ["PYTHONPATH"] = str(BACKEND) + os.pathsep + os.environ.get("PYTHONPATH", "")
load_dotenv(BACKEND / ".env", override=True)

db_path = ROOT / "desktop" / "data" / f"phase11_style_verify_{os.getpid()}.db"
db_path.parent.mkdir(parents=True, exist_ok=True)

os.environ["DATABASE_BACKEND"] = "sqlite"
os.environ["SQLITE_DB_PATH"] = str(db_path)
os.chdir(BACKEND)

import uvicorn

uvicorn.run("app.main:app", host="127.0.0.1", port=8010, reload=False)
