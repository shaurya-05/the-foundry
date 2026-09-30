"""Assert every migration file is accounted for, and emit the apply order.

Two jobs, deliberately in one place:

1. **Coverage.** Every `*.sql` under `backend/migrations/` — recursively — must
   be either listed in `order.txt` (the Postgres chain) or owned by a backend
   that has its own verifier. Nothing is allowed to sit in the tree unexecuted
   by anything. `migrations/sqlite/schema.sql` was exactly that for months: real
   schema, shipped to the desktop build, applied by nothing in CI because the
   Postgres glob does not recurse.

2. **Order.** Runners read `order.txt` rather than globbing, so the chain is a
   stated dependency graph instead of whatever `sort` happens to produce. The
   `000b`/`000c` bug was a filename ordering accident; the fix that renamed them
   to `006_*` works only because `conversation` sorts before `copilot`.

Usage:
    python scripts/check_migrations.py               # verify coverage, exit 1 on drift
    python scripts/check_migrations.py --print-order # emit filenames, one per line
"""
from __future__ import annotations

import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
ORDER_FILE = MIGRATIONS / "order.txt"

# SQL owned by a non-Postgres backend, each with the verifier that covers it.
# A file listed here is NOT applied by the Postgres chain, but it is not
# uncovered either — the named script is what proves it builds from cold.
OTHER_BACKENDS = {
    "sqlite/schema.sql": "scripts/verify_sqlite_identity.py",
}


def read_order() -> list[str]:
    if not ORDER_FILE.exists():
        print(f"ERROR: {ORDER_FILE} is missing", file=sys.stderr)
        raise SystemExit(2)
    names: list[str] = []
    for raw in ORDER_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        names.append(line)
    return names


def discover() -> set[str]:
    return {
        p.relative_to(MIGRATIONS).as_posix()
        for p in MIGRATIONS.rglob("*.sql")
    }


def main() -> int:
    order = read_order()
    on_disk = discover()
    declared = set(order) | set(OTHER_BACKENDS)

    problems: list[str] = []

    uncovered = sorted(on_disk - declared)
    for name in uncovered:
        problems.append(
            f"  {name}\n"
            f"      Present on disk but applied by nothing. Add it to order.txt, or\n"
            f"      register it in OTHER_BACKENDS with the verifier that covers it."
        )

    missing = sorted(set(order) - on_disk)
    for name in missing:
        problems.append(f"  {name}\n      Listed in order.txt but not on disk.")

    dupes = sorted({n for n in order if order.count(n) > 1})
    for name in dupes:
        problems.append(f"  {name}\n      Listed more than once in order.txt.")

    for name, verifier in sorted(OTHER_BACKENDS.items()):
        if name not in on_disk:
            problems.append(f"  {name}\n      Registered to {verifier} but not on disk.")

    if problems:
        print("Migration coverage check FAILED:\n", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        return 1

    print(f"Migration coverage OK - {len(order)} in the Postgres chain, "
          f"{len(OTHER_BACKENDS)} owned by another backend, 0 uncovered.")
    return 0


if __name__ == "__main__":
    if "--print-order" in sys.argv:
        # Force LF even on Windows. A shell loop reading this output treats a
        # trailing \r as part of the filename, and the resulting "file not
        # found" points at the migration rather than at the line ending.
        try:
            sys.stdout.reconfigure(newline="\n")
        except AttributeError:  # pragma: no cover - Python < 3.7
            pass
        for name in read_order():
            sys.stdout.write(name + "\n")
        raise SystemExit(0)
    raise SystemExit(main())
