"""Enforce service boundaries at the import level.

`check_service_boundaries.py` catches one service reading another's TABLES. That
is necessary and not sufficient: Model Gateway owns almost no tables, and every
way of violating its boundary is an import. Twenty modules were reaching into
`ai_router`, `model_provider`, `claude` and `embeddings` directly before Stage 4
moved it, and the table checker saw none of it.

**Enforcement is progressive, by design.** A service is enforced only once it
declares a `facade:` in `ownership.yaml` — i.e. once Stage 4 has actually moved
it. Services still awaiting their turn are reported but not failed. Turning this
on for all six at once would mean either a wall of failures or a baseline so
large it means nothing; enforcing each service the moment it moves means the
boundary is real from the day it exists.

Usage:
    python scripts/check_service_imports.py           # fail on violations of moved services
    python scripts/check_service_imports.py --report  # show everything, exit 0
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

BACKEND = Path(__file__).resolve().parent.parent
OWNERSHIP = BACKEND.parent / "docs" / "contracts" / "ownership.yaml"

IMPORT_PATTERNS = [
    re.compile(r"^\s*from\s+(app\.[a-z0-9_.]+)\s+import\s+(.+)$", re.M),
    re.compile(r"^\s*import\s+(app\.[a-z0-9_.]+)\s*$", re.M),
]
FROM_PACKAGE = re.compile(r"^\s*from\s+(app\.[a-z0-9_.]+)\s+import\s+([a-z0-9_,\s]+)$", re.M)


def module_path(dotted: str) -> str:
    return dotted.replace(".", "/") + ".py"


def main() -> int:
    doc = yaml.safe_load(OWNERSHIP.read_text(encoding="utf-8"))

    module_service: dict[str, str] = {}
    facades: dict[str, str] = {}
    for name, svc in (doc.get("services") or {}).items():
        for m in svc.get("modules") or []:
            module_service[m] = name
        if svc.get("facade"):
            facades[name] = svc["facade"]
    for name, sh in (doc.get("shared") or {}).items():
        for m in (sh.get("write_only_via") or []) + (sh.get("read_only_via") or []):
            module_service[m] = f"shared:{name}"
        for m in sh.get("modules") or []:
            module_service[m] = f"shared:{name}"
    infra: set[str] = set()
    for _n, i in (doc.get("infrastructure") or {}).items():
        infra.update(i.get("modules") or [])

    findings: list[dict] = []
    for path in sorted(BACKEND.rglob("*.py")):
        if "__pycache__" in path.parts or ".venv" in str(path):
            continue
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("scripts/", "tests/")) or "_archived" in rel:
            continue

        importer = module_service.get(rel)
        if importer is None or rel in infra:
            continue

        text = path.read_text(encoding="utf-8", errors="ignore")
        targets: set[str] = set()
        for pat in IMPORT_PATTERNS:
            for m in pat.finditer(text):
                targets.add(module_path(m.group(1)))
        # `from app.services import x, y` imports modules, not names.
        for m in FROM_PACKAGE.finditer(text):
            pkg = m.group(1)
            for nm in m.group(2).split(","):
                nm = nm.strip()
                if nm:
                    targets.add(module_path(f"{pkg}.{nm}"))

        for target in sorted(targets):
            if target == rel:
                continue
            owner = module_service.get(target)
            if owner is None or owner == importer or target in infra:
                continue
            if owner.startswith("shared:"):
                continue  # shared substrates are callable by everyone
            facade = facades.get(owner)
            if facade is None:
                findings.append({
                    "importer": rel, "service": importer, "target": target,
                    "owner": owner, "enforced": False,
                })
            elif target != facade:
                findings.append({
                    "importer": rel, "service": importer, "target": target,
                    "owner": owner, "enforced": True, "facade": facade,
                })

    enforced = [f for f in findings if f["enforced"]]
    pending = [f for f in findings if not f["enforced"]]

    moved = ", ".join(sorted(facades)) or "none"
    print(f"Import scan: {len(enforced)} enforced violation(s), "
          f"{len(pending)} in services not yet moved.")
    print(f"Enforced services (have a facade): {moved}")

    if "--report" in sys.argv:
        by_owner: dict[str, list] = defaultdict(list)
        for f in pending:
            by_owner[f["owner"]].append(f)
        for owner in sorted(by_owner):
            print(f"\n  {owner} (not yet moved) - {len(by_owner[owner])} inbound imports:")
            for f in sorted(by_owner[owner], key=lambda x: x["importer"])[:40]:
                print(f"    {f['importer']} -> {f['target']}")
        return 0

    if enforced:
        print(f"\nFAILED: {len(enforced)} import(s) bypass a moved service's facade:\n",
              file=sys.stderr)
        for f in enforced:
            print(f"  {f['importer']}\n"
                  f"      imports {f['target']}, which is internal to {f['owner']}\n"
                  f"      import {f['facade']} instead",
                  file=sys.stderr)
        return 1

    print("OK - no moved service has its internals imported from outside.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
