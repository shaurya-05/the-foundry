"""Find code that reaches across a service boundary.

Stage 3 defines the five contracts. This is what stops them from being a
document nobody reads: it takes `docs/contracts/ownership.yaml` as the source of
truth and reports every place a module touches a table its service does not own.

**Nothing moves in Stage 3**, so the current tree has real violations by
construction — that is the point of the register. They are recorded in
`boundary-baseline.json`. CI fails on anything NOT in that baseline, which means
the known debt is visible and frozen while new debt is impossible to add
quietly. A violations list with no gate is a list that grows.

Detection is deliberately lexical: SQL in this codebase is written as string
literals, so table references are found by scanning for `FROM|JOIN|INTO|UPDATE|
DELETE FROM <name>` and keeping hits that match a table the migrations actually
create. That will miss a table name built by string concatenation and will not
understand an ORM. Both are acceptable: this codebase writes raw SQL, and a
checker that is obvious about what it looks at is easier to trust than one that
claims completeness it cannot have.

Usage:
    python scripts/check_service_boundaries.py              # fail on new violations
    python scripts/check_service_boundaries.py --report     # print all, exit 0
    python scripts/check_service_boundaries.py --update-baseline
    python scripts/check_service_boundaries.py --markdown   # emit the register
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
OWNERSHIP = REPO / "docs" / "contracts" / "ownership.yaml"
BASELINE = REPO / "docs" / "contracts" / "boundary-baseline.json"

SQL_REF = re.compile(
    r"\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TABLE)\s+([a-z_][a-z0-9_]*)", re.I
)


def known_tables() -> set[str]:
    tables: set[str] = set()
    for f in (BACKEND / "migrations").glob("*.sql"):
        for m in re.finditer(
            r"CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)",
            f.read_text(encoding="utf-8"), re.I,
        ):
            tables.add(m.group(1).lower())
    return tables


def load_model() -> dict:
    doc = yaml.safe_load(OWNERSHIP.read_text(encoding="utf-8"))

    table_owner: dict[str, str] = {}
    module_service: dict[str, str] = {}

    for name, svc in (doc.get("services") or {}).items():
        for t in svc.get("tables") or []:
            table_owner[t] = name
        for m in svc.get("modules") or []:
            module_service[m] = name

    shared_tables: dict[str, dict] = {}
    for name, sh in (doc.get("shared") or {}).items():
        for t in sh.get("tables") or []:
            table_owner[t] = f"shared:{name}"
            shared_tables[t] = sh
        # The named read/write paths ARE the shared substrate's implementation;
        # without this they look like modules belonging to no service.
        for m in (sh.get("write_only_via") or []) + (sh.get("read_only_via") or []):
            module_service[m] = f"shared:{name}"

    exempt: set[str] = set()
    for _name, infra in (doc.get("infrastructure") or {}).items():
        exempt.update(infra.get("modules") or [])

    for name, grp in (doc.get("unassigned") or {}).items():
        for t in grp.get("tables") or []:
            table_owner[t] = f"unassigned:{name}"
        for m in grp.get("modules") or []:
            module_service[m] = f"unassigned:{name}"

    return {
        "table_owner": table_owner,
        "module_service": module_service,
        "shared_tables": shared_tables,
        "exempt": exempt,
        "doc": doc,
    }


def scan() -> list[dict]:
    model = load_model()
    tables = known_tables()
    table_owner = model["table_owner"]
    module_service = model["module_service"]
    shared = model["shared_tables"]
    exempt = model["exempt"]

    findings: list[dict] = []
    for path in sorted(BACKEND.rglob("*.py")):
        if "__pycache__" in path.parts or ".venv" in str(path):
            continue
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith("scripts/") or rel.startswith("tests/"):
            continue
        # Archived code is dead; flagging it adds noise without adding safety.
        if "_archived" in rel:
            continue
        if rel in exempt:
            continue

        service = module_service.get(f"app/{rel[4:]}" if rel.startswith("app/") else rel)
        if service is None:
            service = module_service.get(rel)

        text = path.read_text(encoding="utf-8", errors="ignore")
        touched = {m.group(1).lower() for m in SQL_REF.finditer(text)} & tables
        if not touched:
            continue

        if service is None:
            findings.append({
                "module": rel, "service": None, "table": sorted(touched)[0],
                "owner": "?", "kind": "unmapped_module",
                "detail": f"module is in no service; touches {', '.join(sorted(touched))}",
            })
            continue

        for t in sorted(touched):
            owner = table_owner.get(t)
            if owner is None:
                findings.append({
                    "module": rel, "service": service, "table": t, "owner": "?",
                    "kind": "unmapped_table",
                    "detail": "table is owned by nothing in ownership.yaml",
                })
                continue
            if owner.startswith("shared:"):
                allowed = set(shared[t].get("write_only_via") or []) | set(
                    shared[t].get("read_only_via") or []
                )
                mod_key = f"app/{rel[4:]}" if rel.startswith("app/") else rel
                if mod_key not in allowed:
                    findings.append({
                        "module": rel, "service": service, "table": t, "owner": owner,
                        "kind": "shared_table_direct_access",
                        "detail": f"shared table reached outside its named path ({', '.join(sorted(allowed))})",
                    })
                continue
            if owner != service:
                findings.append({
                    "module": rel, "service": service, "table": t, "owner": owner,
                    "kind": "cross_service_table_access",
                    "detail": f"{service} reads/writes a table owned by {owner}",
                })
    return findings


def key(f: dict) -> str:
    return f"{f['module']}::{f['table']}::{f['kind']}"


def main() -> int:
    args = set(sys.argv[1:])
    findings = scan()

    if "--markdown" in args:
        print(render_markdown(findings))
        return 0

    if "--update-baseline" in args:
        BASELINE.write_text(
            json.dumps({"violations": sorted(key(f) for f in findings)}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"baseline written: {len(findings)} known violations")
        return 0

    baseline = set()
    if BASELINE.exists():
        baseline = set(json.loads(BASELINE.read_text(encoding="utf-8"))["violations"])

    new = [f for f in findings if key(f) not in baseline]
    fixed = baseline - {key(f) for f in findings}

    by_kind: dict[str, int] = defaultdict(int)
    for f in findings:
        by_kind[f["kind"]] += 1

    print(f"Boundary scan: {len(findings)} violations "
          f"({', '.join(f'{k}={v}' for k, v in sorted(by_kind.items()))})")
    print(f"Baseline: {len(baseline)} known, {len(new)} new, {len(fixed)} fixed")

    if "--report" in args:
        for f in findings:
            print(f"  [{f['kind']}] {f['module']} -> {f['table']} ({f['detail']})")
        return 0

    if fixed:
        print("\nViolations resolved since the baseline was taken:")
        for k in sorted(fixed):
            print(f"  - {k}")
        print("Run --update-baseline to lock the improvement in.")

    if new:
        print(f"\nFAILED: {len(new)} NEW boundary violation(s):\n", file=sys.stderr)
        for f in new:
            print(f"  {f['module']} -> {f['table']}\n"
                  f"      {f['detail']}\n"
                  f"      Use {f['owner']}'s contract instead of its tables.",
                  file=sys.stderr)
        return 1

    print("OK - no new boundary violations.")
    return 0


def render_markdown(findings: list[dict]) -> str:
    by_service: dict[str, list[dict]] = defaultdict(list)
    for f in findings:
        by_service[f["service"] or "(unmapped)"].append(f)

    out = ["| Module | Reaches | Owned by | Kind |", "|---|---|---|---|"]
    for svc in sorted(by_service):
        for f in sorted(by_service[svc], key=lambda x: (x["module"], x["table"])):
            out.append(f"| `{f['module']}` | `{f['table']}` | {f['owner']} | {f['kind']} |")
    return "\n".join(out)


if __name__ == "__main__":
    raise SystemExit(main())
