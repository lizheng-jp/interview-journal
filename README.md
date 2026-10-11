# Interview Journal — AI Career Growth Platform

A usable private interview practice MVP built on the existing Next.js/FastAPI project. Browser recording, pause/resume, preview/save, existing-audio upload, searchable recording history, metadata editing, replay/download, timestamped transcription and a practice dashboard are implemented. English, Japanese, Chinese and automatic language detection use an opt-in **faster-whisper CPU INT8** worker.

**Local app:** http://localhost:13080. **Private source:** https://github.com/lizheng-jp/interview-journal. No production application, Caddy configuration, PostgreSQL role or monitoring configuration has been changed. See [verification](docs/verification.md) and [Lightsail deployment review](docs/lightsail-deployment.md).

## Run locally with PostgreSQL (recommended)

Requirements: Docker Compose 2.24.4+, available localhost ports 13080 and 15432. This creates a separate PostgreSQL container, network and storage; it does not use DPES/Vision infrastructure.

```sh
cp .env.example .env
# Set LOCAL_POSTGRES_PASSWORD to a random hexadecimal value in .env.
# Generate one locally: python3 -c 'import secrets; print(secrets.token_hex(24))'
chmod 600 .env
# Verify ports are unused first: lsof -nP -iTCP:13080 -iTCP:15432 -sTCP:LISTEN

docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --wait db api web
```

Open **http://localhost:13080**, allow microphone access, record, pause/resume, finish, preview and save. The detail page can edit metadata, replay audio and jump to transcript timestamps. Categories: Behavioral, Coding, System Design, English Practice, Other. The library searches title, tags, notes and transcript text on the server, with category/language filters and pagination.

The worker is **off by default**. Audio is stored and marked pending until explicitly enabled. For automatic processing locally:

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile transcription up -d --build transcription
# Stop only this application's worker when finished:
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile transcription stop transcription
# Or process one pending recording and exit (build the optional image first):
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile transcription build transcription
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile transcription run --rm transcription python -m app.worker --once
```

The first launch downloads the multilingual `base` model; subsequent launches reuse the model cache. CPU is capped at one core and worker RAM at 1536 MB. The API and web remain separate. An exclusive renewable database lease prevents two workers processing the same queue and permits recovery after a crash (lease expires after 120 seconds). Status distinguishes pending, processing, completed and failed. A failed transcript can be retried. Changing the spoken language requeues transcription; editing language/deleting audio is blocked while processing.

Do not enable a worker on shared production hardware without a fresh resource check and approval.

Stop this local application without deleting recordings:

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile transcription down
```

## Development without Docker

Python 3.12+, Node 22+. SQLite is a fallback for isolated development, not the recommended deployment database.

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. Next.js proxies `/api/*` to localhost:8000. Use `INTERNAL_API_URL` before building to select another backend. A production standalone build fixes that rewrite target at build time; Compose supplies `http://api:8000`.

Optional development transcription uses the same DB and storage settings as the API:

```sh
backend/.venv/bin/pip install -r backend/requirements-worker.txt
cd backend
WHISPER_CPU_THREADS=1 .venv/bin/python -m app.worker
```

## Verification

```sh
# SQLite API + worker mechanics (model is a test double):
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
# Real PostgreSQL in the isolated local Compose above; tests use disposable schemas:
backend/.venv/bin/python scripts/test_postgres.py
# Types, production build and real browser MediaRecorder/playback:
npm --prefix frontend run lint
npm --prefix frontend run build
cd frontend
npx playwright install chromium
npm run test:e2e
```

The ordinary browser suite uses a synthetic Chromium microphone, exercises real MediaRecorder/HTTP/database/audio playback and injects failures only for recovery checks. The optional real transcript browser test requires `E2E_TRANSCRIPT_ID` referencing a completed local test recording. See [verification details](docs/verification.md) for the real three-language speech smoke and tested limits. CI repeats SQLite/PostgreSQL tests, Docker builds and four ordinary browser tests. It does not download Whisper or claim transcription accuracy.

## Stack and storage

- Next.js App Router, TypeScript, Tailwind v4, adapted shadcn/ui Radix Button/Input primitives, Lucide.
- Dark glass panels, soft gradients, rounded cards, responsive layouts, keyboard focus and reduced-motion support; informed by the current DPES and Vision visual sources.
- FastAPI, SQLAlchemy, PostgreSQL 16; optional isolated SQLite.
- PyAV validates actual audio, measures duration server-side and remuxes Chrome WebM without re-encoding to supply duration/seek information. Upload limit: 100 MB; duration limit: 12 hours; audio-only files required.
- Dedicated volume for audio; metadata and transcript segments in the database. No audio or credentials in Git/public assets.

Schema initialization currently uses SQLAlchemy `create_all`, including the additive `worker_lease` table. It does not migrate existing columns. The phase-one schema is compatible with the supplied initial code; use versioned migrations before changing an existing schema.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Database readiness and live worker heartbeat |
| `GET /api/categories` | Five practice categories |
| `GET /api/recordings` | Search `q`, `category`, `language`, `status`, `limit`, `offset` |
| `POST /api/recordings` | Multipart audio and metadata, server-side validation |
| `GET /api/recordings/{id}` | Metadata and ordered transcript segments |
| `GET /api/recordings/{id}/audio` | Audio streaming/download, HTTP byte ranges |
| `PATCH /api/recordings/{id}` | Title/category/language/tags/notes |
| `PATCH /api/recordings/{id}/segments/{segment_id}` | Transcript correction |
| `POST /api/recordings/{id}/retry-transcription` | Queue another attempt |
| `DELETE /api/recordings/{id}` | Delete audio/metadata/transcript |
| `GET /api/stats` | Practice count, cumulative duration and category totals |

## Boundaries

This is a **single-owner private application**. It has no app-managed accounts. Loopback-only local access is supported; any public deployment requires authenticated HTTPS, with the prepared Caddy route protecting the entire site and API. `owner_id` is a server configuration boundary, not a multi-user login system.

Captured audio stays in browser memory until saved. Reload, browser termination or device sleep can lose unsaved audio; normal link navigation/reload prompts before discarding. Uploaded audio survives failed transcription; upload failures keep the browser preview for retry. Chromium desktop was tested; Safari/iOS microphone capture and background interruption remain to be checked on actual devices. Speech quality is not guaranteed; timestamped text is editable.

Back up **both PostgreSQL and the audio volume** to an independent destination and test restoration before relying on production retention. Automated off-host backup, multi-user auth, AI evaluation and career memory are outside this MVP. Lightsail remains pending approval for dedicated DB provisioning, shared-network attachment and a new Caddy site; no public deployment address is currently live.

Implementation references: [shadcn/ui Radix Button](https://ui.shadcn.com/docs/components/radix/button), [faster-whisper CPU INT8](https://github.com/SYSTRAN/faster-whisper).

## Public source, private recordings

The GitHub repository contains application code and synthetic test fixtures only. Audio,
transcripts, database files, populated environment files and deployment credentials are
excluded from Git. Publishing the source does not make recordings public.

The MVP has one workspace and does not implement per-user accounts. Every deployed
route, including audio and API routes, must be protected by the reverse proxy's
whole-site authentication. Do not publish an anonymous writable instance. The optional
Whisper worker remains disabled until explicitly started.

Production images can be built off-host with `scripts/build_release.sh`. Use
`docker-compose.images.yml` alongside the production overlay to run those verified
Linux amd64 images with `--no-build`, without compiling on the shared Lightsail host.
The generated `.storage/releases` bundles are ignored by Git.
