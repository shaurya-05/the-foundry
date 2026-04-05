# THE FOUNDRY — by h3ros

AI-powered builder operating system. Source → Forge → Cast → Ship.

## Quick Start

### 1. Clone & configure environment

```bash
cp .env.example .env
```

Fill in:
- `ANTHROPIC_API_KEY` — your Anthropic API key
- `VOYAGE_API_KEY` — your Voyage AI key (for embeddings)
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — optional (auth, leave blank for dev)

### 2. Start infrastructure + backend

```bash
docker compose up -d
```

This starts: PostgreSQL + pgvector, Redis, Neo4j, FastAPI backend, Celery worker.

The database schema is auto-applied on first run via the init SQL.

### 3. Start frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

---

## Architecture

```
frontend/     Next.js 14 (App Router) + TypeScript + Tailwind
backend/      FastAPI + asyncpg + Redis + Neo4j
workers/      Celery pipeline worker
migrations/   PostgreSQL schema (auto-applied via Docker)
```

### Key Services
| Service | Port | Purpose |
|---|---|---|
| Next.js | 3000 | Frontend |
| FastAPI | 8000 | REST API + WebSocket |
| PostgreSQL | 5432 | Primary DB + pgvector |
| Redis | 6379 | Cache + pub/sub |
| Neo4j | 7474/7687 | Knowledge graph |

---

## Section Map

| URL | Name | Accent |
|---|---|---|
| /dashboard | The Forge Floor | Red |
| /knowledge | The Archive | Blue |
| /projects | The Workshop | Red |
| /ideas | The Crucible | Orange |
| /launchpad | The Launch Bay | Green |
| /workspace | The Blueprint | Purple |
| /tasks | The Runsheet | Teal |
| /context | The Signal Room | Purple |
| /agents | The Crew | Purple |

### Global Overlays
- **⌘K** — Forge Command (command palette)
- **⌘J** — Forge Copilot (AI assistant slide-over)
- **Bell** — Forge Signals (notification feed)

---

## API Endpoints

Full map in `backend/app/main.py` and individual routers in `backend/app/routers/`.

All Claude calls stream via SSE. Pipeline runs stream step-by-step.

---

## AI Models

- **LLM**: `claude-sonnet-4-20250514` (all generation, streaming)
- **Embeddings**: `voyage-large-2` via Voyage AI (1024-dim vectors)

---

## Design System

Dark theme by default. Toggle via `.light` class on `<html>`.

Four glass tiers: `.gl0` → `.gl1` → `.gl2` → `.gl3`

Fonts: Barlow Condensed (headings) · Barlow (body) · IBM Plex Mono (labels)
