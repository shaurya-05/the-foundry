# THE FOUND3RY — Deployment Guide

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Vercel CDN │────▶│  Next.js Frontend │────▶│  FastAPI API  │
│  (Frontend) │     │  Static + SSR     │     │  (Backend)    │
└─────────────┘     └──────────────────┘     └──────┬───────┘
                                                     │
                          ┌──────────────────────────┼──────────────┐
                          │                          │              │
                    ┌─────▼─────┐          ┌────────▼──┐   ┌──────▼──┐
                    │ PostgreSQL │          │   Redis    │   │  Neo4j  │
                    │ + pgvector │          │  (Cache)   │   │ (Graph) │
                    └───────────┘          └───────────┘   └─────────┘
```

## Option A: Vercel (Frontend) + Railway (Backend + DBs)

**Cheapest and fastest to deploy. Recommended for launch.**

### 1. Frontend → Vercel

```bash
cd frontend
npx vercel --prod
```

Set environment variables in Vercel dashboard:
- `NEXT_PUBLIC_API_URL` = `https://api.found3ry.com`
- `NEXT_PUBLIC_WS_URL` = `wss://api.found3ry.com`

> **Phase 2 §3.1 hardening:** the production frontend MUST point at the
> custom domain `api.found3ry.com`, never the raw Railway hostname.
> `next.config.mjs` will refuse to build a production bundle if either env
> var contains `.up.railway.app`.

### 2. Backend → Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and init
railway login
railway init

# Add services (Railway will auto-detect Dockerfile)
railway add --plugin postgresql
railway add --plugin redis

# Set env vars
railway variables set JWT_SECRET=$(openssl rand -hex 32)
railway variables set ENVIRONMENT=production
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set VOYAGE_API_KEY=pa-...
railway variables set RESEND_API_KEY=re_...
railway variables set FRONTEND_URL=https://your-vercel-app.vercel.app
railway variables set ALLOWED_ORIGINS=https://your-vercel-app.vercel.app

# Deploy
railway up
```

**Cost:** ~$5-10/month (Railway Hobby plan + Vercel free tier)

### 3. Run Migrations

```bash
railway run psql $DATABASE_URL -f backend/migrations/001_initial.sql
railway run psql $DATABASE_URL -f backend/migrations/002_collab_visibility.sql
railway run psql $DATABASE_URL -f backend/migrations/003_auth.sql
railway run psql $DATABASE_URL -f backend/migrations/004_email_verification.sql
```

---

## Option B: Docker Compose (VPS)

**Full control. Use a VPS like Hetzner ($5/mo), DigitalOcean ($6/mo), or AWS Lightsail.**

### 1. Generate Secrets

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "REDIS_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "NEO4J_PASSWORD=$(openssl rand -hex 16)" >> .env
```

### 2. Deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 3. Add a Reverse Proxy (Caddy — auto HTTPS)

```bash
# Install Caddy
sudo apt install -y caddy

# /etc/caddy/Caddyfile
yourdomain.com {
    reverse_proxy localhost:3000
}

api.yourdomain.com {
    reverse_proxy localhost:8000
}
```

---

## Pre-Deploy Checklist

- [ ] Generate strong `JWT_SECRET`: `openssl rand -hex 32`
- [ ] Set all database passwords to random values
- [ ] Set `ENVIRONMENT=production`
- [ ] Set `ALLOWED_ORIGINS` to your production domain
- [ ] Set `FRONTEND_URL` to your production domain
- [ ] Set `RESEND_API_KEY` for email delivery
- [ ] Verify `.env` is in `.gitignore`
- [ ] Run all migrations on production database
- [ ] Test health endpoint: `curl https://api.yourdomain.com/health`

## Post-Deploy

- [ ] Set up Sentry for error tracking (`SENTRY_DSN`)
- [ ] Set up database backups (Railway auto-backs up, VPS needs cron)
- [ ] Monitor health endpoint with UptimeRobot (free) or Better Stack
- [ ] Set up domain and SSL certificates

---

## Phase 2 §3.1 — Backend custom-domain cutover

The Railway-issued hostname (`*.up.railway.app`) must not appear in the
production CSP `connect-src`. The fix is a custom subdomain on the Railway
service and a one-time env-var flip in Vercel.

### 1. DNS (GoDaddy)

Add the two records Railway requests when you provision the custom domain:

| Type   | Name                 | Value                                 |
|--------|----------------------|---------------------------------------|
| CNAME  | `api`                | `<your-service>.up.railway.app`       |
| TXT    | `_railway-verify.api`| `railway-verify=<token-from-railway>` |

### 2. Railway

- Service → **Settings** → **Networking** → **Custom Domain**
- Add `api.found3ry.com`
- Wait for both verification ✓ and TLS-provision ✓ (typically 2–10 min)

### 3. Vercel env-var flip

In each environment (Production, Preview, Development):

```
NEXT_PUBLIC_API_URL=https://api.found3ry.com
NEXT_PUBLIC_WS_URL=wss://api.found3ry.com
```

Redeploy. `next.config.mjs` validates these at build time and refuses to
build if either contains `.up.railway.app`.

### 4. Backend CORS

In Railway env vars on the backend service, ensure `ALLOWED_ORIGINS`
contains both: `https://found3ry.com,https://www.found3ry.com`. The
backend itself doesn't need a value change — it serves on whatever
hostname Railway routes to it.

### 5. Verify

```bash
# DNS
dig +short CNAME api.found3ry.com
dig +short TXT   _railway-verify.api.found3ry.com

# Live API
curl -sI https://api.found3ry.com/health

# CSP must not contain railway hostname
curl -sI https://found3ry.com/ | grep -i content-security-policy | grep -ic railway
# Expected: 0
```
