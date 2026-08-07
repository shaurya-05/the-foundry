"""Launch Phase 7b cloud (Postgres) uvicorn with correctly encoded DATABASE_URL."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env.local-prod"


def load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8002
    vars = load_dotenv(ENV_FILE)
    pw = quote(vars["POSTGRES_PASSWORD_LOCAL_PROD"], safe="")
    os.environ["DATABASE_BACKEND"] = "postgres"
    os.environ["CACHE_BACKEND"] = "memory"
    os.environ["GRAPH_BACKEND"] = "none"
    os.environ["CELERY_ENABLED"] = "0"
    # Receive push without enabling desktop outbound sync on the cloud instance.
    os.environ["CLOUD_SYNC_ENABLED"] = "0"
    os.environ["JWT_SECRET"] = vars["JWT_SECRET_LOCAL_PROD"]
    os.environ["DATABASE_URL"] = (
        f"postgresql://foundry:{pw}@127.0.0.1:5433/foundry_db"
    )
    os.environ["REDIS_URL"] = "redis://127.0.0.1:6380"
    os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:3000"
    os.environ.pop("SQLITE_DB_PATH", None)

    # backend/.env uses load_dotenv(override=True) and would clobber the
    # DATABASE_URL above (dev compose port 5432). Keep process env winning.
    import dotenv as _dotenv

    _dotenv.load_dotenv = lambda *args, **kwargs: None  # type: ignore

    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    os.chdir(ROOT / "backend")
    sys.path.insert(0, str(ROOT / "backend"))
    main()
