"""Validate the Stage 3 contract artifacts.

A contract that nothing checks is a document that drifts. This asserts the
things that make the set usable rather than decorative:

  - every service named in ownership.yaml points at a contract file that exists
  - every contract file parses, and declares a version and a changelog
  - HTTP contracts are structurally OpenAPI (openapi / info / paths)
  - internal contracts declare operations, and every operation declares a
    request, a response and an errors list -- an operation missing its error
    cases is the one that surprises a caller
  - every table in ownership.yaml actually exists in the migrations, and every
    table the migrations create is assigned to somebody

That last pair is the one that catches real drift: a migration adding a table
nobody owns, or an ownership entry for a table that was renamed.

Usage:
    python scripts/check_contracts.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

BACKEND = Path(__file__).resolve().parent.parent
CONTRACTS = BACKEND.parent / "docs" / "contracts"

_failures: list[str] = []


def fail(msg: str) -> None:
    _failures.append(msg)
    print(f"[FAIL] {msg}")


def ok(msg: str) -> None:
    print(f"[PASS] {msg}")


def migration_tables() -> set[str]:
    tables: set[str] = set()
    for f in (BACKEND / "migrations").glob("*.sql"):
        for m in re.finditer(
            r"CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)",
            f.read_text(encoding="utf-8"), re.I,
        ):
            tables.add(m.group(1).lower())
    return tables


def main() -> int:
    ownership = yaml.safe_load((CONTRACTS / "ownership.yaml").read_text(encoding="utf-8"))

    # ── Every service has a contract file that exists and parses ────────────
    docs: dict[str, dict] = {}
    for name, svc in (ownership.get("services") or {}).items():
        cfile = svc.get("contract")
        if not cfile:
            fail(f"{name} declares no contract file")
            continue
        path = CONTRACTS / cfile
        if not path.exists():
            fail(f"{name}: contract file {cfile} does not exist")
            continue
        try:
            docs[name] = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            fail(f"{name}: {cfile} does not parse - {str(e)[:120]}")
    for name, sh in (ownership.get("shared") or {}).items():
        cfile = sh.get("contract")
        path = CONTRACTS / cfile if cfile else None
        if not path or not path.exists():
            fail(f"shared:{name}: contract file missing")
        else:
            docs[f"shared:{name}"] = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not _failures:
        ok(f"all {len(docs)} contract files exist and parse")

    # ── Structure ───────────────────────────────────────────────────────────
    for name, doc in docs.items():
        if not doc:
            fail(f"{name}: contract is empty")
            continue
        is_openapi = "openapi" in doc
        if is_openapi:
            for key in ("info", "paths"):
                if key not in doc:
                    fail(f"{name}: OpenAPI contract missing '{key}'")
            if "version" not in (doc.get("info") or {}):
                fail(f"{name}: OpenAPI contract has no info.version")
            if "x-changelog" not in doc:
                fail(f"{name}: OpenAPI contract has no x-changelog")
        else:
            if "version" not in doc:
                fail(f"{name}: contract declares no version")
            if "changelog" not in doc:
                fail(f"{name}: contract has no changelog")
            operations = doc.get("operations")
            if operations is None:
                # Perception & Actuation is allowed to be empty of tables, but
                # not of operations -- a contract with no operations says
                # nothing at all.
                fail(f"{name}: internal contract declares no operations")
                continue
            for op_name, op in operations.items():
                for key in ("request", "response", "errors"):
                    if key not in op:
                        fail(f"{name}.{op_name}: missing '{key}'")
    if not _failures:
        ok("every contract is structurally complete (version, changelog, operations)")

    # ── Table coverage both ways ────────────────────────────────────────────
    declared: dict[str, str] = {}
    for group in ("services", "shared", "unassigned"):
        for name, entry in (ownership.get(group) or {}).items():
            for t in entry.get("tables") or []:
                if t in declared:
                    fail(f"table '{t}' is claimed by both {declared[t]} and {name}")
                declared[t] = name

    real = migration_tables()
    known_unmigrated = {
        e["table"] for e in (ownership.get("unmigrated") or [])
    }
    ghosts = sorted(set(declared) - real - known_unmigrated)
    orphans = sorted(real - set(declared))

    for t in sorted(known_unmigrated):
        print(f"[KNOWN] '{t}' is referenced by code but created by no Postgres "
              f"migration (VIOLATIONS.md V-08)")

    for t in ghosts:
        fail(f"ownership.yaml assigns '{t}' to {declared[t]}, but no migration "
             f"creates it and it is not in the 'unmigrated' list")
    for t in orphans:
        fail(f"migrations create '{t}' but ownership.yaml assigns it to nobody")

    if not ghosts and not orphans:
        ok(f"all {len(real)} tables are assigned; "
           f"{len(known_unmigrated)} known unmigrated reference(s) recorded")

    if _failures:
        print(f"\n{len(_failures)} contract problem(s).")
        return 1
    print("\nContracts OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
