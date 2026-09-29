# Service Contracts — Stage 3

Five services, five contracts, plus one shared substrate. These are **interfaces
only**. No implementation moved in Stage 3; every contract here was written
against code that is still exactly where it was.

| Contract | Service | Surface |
|---|---|---|
| [`identity-access.v1.yaml`](identity-access.v1.yaml) | Identity & Access | HTTP (OpenAPI 3.1) |
| [`model-gateway.v1.yaml`](model-gateway.v1.yaml) | Model Gateway | internal (typed schema) |
| [`agent-runtime.v1.yaml`](agent-runtime.v1.yaml) | Agent Runtime | HTTP + WebSocket + internal |
| [`memory-knowledge.v1.yaml`](memory-knowledge.v1.yaml) | Memory & Knowledge | HTTP + internal |
| [`perception-actuation.v1.yaml`](perception-actuation.v1.yaml) | Perception & Actuation | internal — **unimplemented by design** |
| [`observability.v1.yaml`](observability.v1.yaml) | shared substrate | internal write, HTTP read |

Machine-readable ownership lives in [`ownership.yaml`](ownership.yaml). The gap
between those boundaries and today's code is [`VIOLATIONS.md`](VIOLATIONS.md),
which is **generated**, not written — a hand-maintained register is stale the
first time somebody adds a query.

## The rules these contracts are held to

1. **No reaching into another service's tables.** Ownership is declared in
   `ownership.yaml` and enforced by
   `backend/scripts/check_service_boundaries.py`, which runs in CI.
2. **A contract is a schema artifact, not something implied by code.** If the
   only place an interface exists is a Python signature, there is no contract —
   there is an implementation that other people have to read.
3. **Breaking a contract requires a version bump, not a coordinated deploy.**
   See *Changing a contract* below.
4. **Contracts are topology-agnostic.** Nothing here assumes an in-process call.
   Every operation is described as a request and a response, so the same
   contract holds whether the call is a function today or a network hop after
   Phase B moves the system. A contract that assumes in-process calling is one
   you rewrite the moment it stops being true.

## Internal contracts are not "less real" than HTTP ones

Four of these six have no HTTP surface today. They are still written as explicit
request/response schemas rather than as Python protocols, for the same reason
rule 2 exists: a `Protocol` class is a type hint for the current implementation,
and it moves when the implementation moves. A schema is a statement about the
message, which is what actually has to survive Phase B.

Internal contracts use this shape:

```yaml
operations:
  <operation_name>:
    summary: what it does
    request:  { type: object, properties: {...}, required: [...] }
    response: { type: object, properties: {...} }
    errors:   [ list of named failure modes ]
```

## Changing a contract

**Additive change** — a new optional field, a new operation, a new enum value
that old callers can ignore. Edit the `v1` file. No version bump. Note it under
`changelog` in that file.

**Breaking change** — removing or renaming a field, making an optional field
required, changing a type, changing the meaning of an existing value. Copy the
file to `*.v2.yaml` and leave `v1` in place. Both versions exist until every
caller has moved. This is the whole point of rule 3: a breaking change must
never require two services to deploy together, because that is precisely the
coupling these contracts exist to remove.

**Rule of thumb:** if an existing caller that has not been updated would still
work, it is additive. If you have to check who calls it first, it is breaking.

## Deliberate omissions

- **No contract is defined for the workspace domain** (projects, tasks, ideas,
  ventures, blueprint, notifications, sync). Those are real, in production, and
  belong to none of the five named contexts. They are recorded in
  `ownership.yaml` under `unassigned` and raised as **V-01** in the register
  rather than being quietly filed under whichever service looked closest.
- **Perception & Actuation has no implementation.** The contract exists anyway,
  because Phase A's vision work and Phase C's robotics work need a defined place
  to land rather than being bolted onto Agent Runtime after the fact.
