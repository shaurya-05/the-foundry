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
- `NEXT_PUBLIC_API_URL` = `https://your-railway-backend.up.railway.app`
- `NEXT_PUBLIC_WS_URL` = `wss://your-railway-backend.up.railway.app`

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
