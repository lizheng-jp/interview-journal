# Interview Journal — Private interview practice recorder

> **Status:** Independent MVP source project. No changes have been made to DPES, Vision, existing Docker containers, production Caddy, or PostgreSQL.

A glassmorphism Next.js + FastAPI recording journal designed for private interview practice on your existing AWS Lightsail. It records browser audio, saves categories/tags/notes, lists searchable recordings, streams audio for replay, and supports asynchronous CPU speech transcription with timestamped transcript segments. AI evaluation and Career Memory are intentionally out of scope for v0.1.

## Stack
- Next.js (App Router), React, TypeScript, custom glass UI
- FastAPI + SQLAlchemy
- SQLite for fully isolated smoke tests; optional **existing PostgreSQL** for production, separate database and role
- `faster-whisper` multilingual speech transcription (optional CPU worker, `base` INT8)
- Docker Compose, reverse proxy through existing Caddy **only after approval**

## Why these isolation rules?
- New Compose project name (`interview-journal`), no shared container names, no new public ports.
- `web` listens on **127.0.0.1:13080** only; verify that port is unused before starting. Backend/database are never exposed by Compose.
- The default data store is a separate named Docker volume and a private SQLite DB. **It does not attach to existing PostgreSQL.**
- Optional overlay `docker-compose.postgres.yml` attaches only the new API/worker to an approved existing Docker network. Do not run the overlay until the existing Postgres network, hostname, resources, and database permissions are confirmed.
- The transcription worker is in a Compose profile, so it **does not start by default**.
- Never apply the Caddy reference snippet automatically. Before any public-facing use, put the application behind a TLS reverse proxy with authentication; localhost-only access is safe for an isolated smoke test, not a production login solution.

## Local development (no Docker needed)

Python 3.12 and Node 22 recommended.

```sh
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 (the Next.js rewrite proxies `/api/*` to localhost:8000). The app writes development audio/SQLite data to `.storage/`, ignored by Git. Use **localhost** for development; do not expose this unauthenticated API to the internet.

### Optional CPU transcription locally

```sh
cd backend
. .venv/bin/activate
pip install -r requirements-worker.txt
WHISPER_MODEL=base WHISPER_CPU_THREADS=1 python -m app.worker
```

The first launch downloads model weights into the local cache. Without the worker, recordings remain safely stored with `pending` transcription status. **A 2-vCPU shared Lightsail should not run this worker until CPU/RAM headroom is confirmed.** No transcript is fabricated; all uploaded recordings are preserved even when transcription fails.

## Docker Compose smoke test — requires host port approval

Only after checking existing container/resource/port status:

```sh
cp .env.example .env
# verify free host port: ss -ltnp | grep :13080
# check load: free -h; docker stats --no-stream; df -h
# build on a separate machine/CI if Lightsail resources are tight

docker compose up -d --build web api
curl http://127.0.0.1:13080/api/health
```

Do not execute these commands on a live Lightsail until they have been reviewed. A new reverse proxy route needs separate user approval.

Optional postgres overlay, **review first**:

```sh
# 1. Review infra/postgres-REVIEW-ONLY.sql and create an isolated db/user manually.
# 2. Set DATABASE_URL and EXISTING_POSTGRES_NETWORK in .env.
# 3. Confirm network and DB name with docker inspect and psql.
docker compose -f docker-compose.yml -f docker-compose.postgres.yml config
# launch only after explicit approval
```

When the web/API are stable and spare resources confirmed:

```sh
docker compose --profile transcription up -d transcription
```

The worker is capped at 1 CPU and 1.5GB RAM in Compose but may contend with existing services; it is intentionally off by default.

## MVP routes
- `GET /api/health` — liveness
- `GET /api/categories` — category labels
- `GET /api/recordings` — list/search/filter (title, tags, notes, transcript)
- `POST /api/recordings` — multipart upload, max 100 MB by default, safe generated filename
- `GET /api/recordings/{id}` — metadata + transcript segments
- `GET /api/recordings/{id}/audio` — controlled audio playback/download, HTTP range via FileResponse
- `PATCH /api/recordings/{id}` — edit title/category/tags/notes
- `PATCH /api/recordings/{id}/segments/{segment_id}` — correct a transcript segment
- `POST /api/recordings/{id}/retry-transcription`
- `DELETE /api/recordings/{id}` — permanently delete recording and transcript
- `GET /api/stats` — aggregate practice stats

## Security boundaries and production readiness

**This is a private single-owner MVP, not a public SaaS.** There is no app-managed login yet. The Compose port is bound to loopback; public access must be protected with Caddy basic authentication or an equivalent access gateway. Before allowing other users, implement trusted user identity, server-side per-resource authorization, HTTPS, account deletion, quotas/rate limits, database migrations and independent backups. Data is private by deployment, not by a UI login. Backend `owner_id` exists as a forward compatibility field, not as a completed multi-user access control feature.

Store environment secrets outside Git. Audio is stored in a dedicated volume, never a public Next.js `/public` directory. Backup both the volume and the database; SQLite or disk snapshots on the same Lightsail instance do not provide independent backup protection. The upload handler checks MIME type and byte limit but should include payload/codec probing before public release. Extremely large uploads may still be buffered by the edge proxy; impose body limits there too.

## Known limits in v0.1
- Transcript worker is opt-in and has not yet been benchmarked on your shared Lightsail.
- Browser sleep/lock may interrupt recording; current recorder keeps captured data in memory until saved, not durable offline chunked storage.
- Current frontend library searches title/tags/notes in loaded results; API supports transcript search too, but frontend should be switched to server-side search before scale.
- No AI scoring yet, and no live AI interviewing.
- UI is a style approximation based on the requested DPES/Vision glass aesthetic; the existing projects' source/design tokens have not been accessible for an exact match.
