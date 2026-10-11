# Lightsail deployment review — not applied

Read-only inspection on 2026-10-11 confirmed that the existing Lightsail runs DPES/Signals, Vision, Caddy, PostgreSQL, Qdrant, Prometheus and node exporter. This task did not restart any production container, write any production configuration or create any production database/role. Current host addresses, mounted production paths, credentials and populated environment files are not committed here.

## Observed capacity and integration

| Item | Read-only observation | Consequence |
| --- | --- | --- |
| CPU | 2 vCPU, load average approximately 0.07–0.16 at inspection | Build images off-host; do not run Whisper by default |
| RAM | About 3.8 GiB total, about 2 GiB available | Web/API caps total 1 GiB; snapshot is not a peak-load guarantee |
| Disk | About 59 GiB free | Audio quota/retention and independent backup still needed |
| Proxy | Existing containerized Caddy imports a separate sites directory | Add one approved site; do not rewrite existing routes |
| Network | Caddy and PostgreSQL share an existing Docker network | Attach only new application containers with a unique web alias |
| PostgreSQL | Existing business database; only current login role is a superuser | Create a dedicated database and least-privilege login; do not reuse that role |
| Monitoring | Existing Prometheus and node exporter | Retain host monitoring; application scrape/alert changes need separate approval |
| Ports | 80/443 public; existing private service ports occupied | Production overlay exposes no new host ports |

Final read-only inspection also found that the DPES/Signals frontend/backend image revisions had changed since the first inspection and the new containers had only been running a few minutes. This task issued only read-only remote commands; the cause of that separate environment change was not investigated. Caddy, PostgreSQL and Vision were still running with restart count zero. Therefore repeat the integration/resource baseline immediately before any approved deployment rather than assuming the environment stayed unchanged. The host is x86_64 and Compose v5.6.0 supports the prepared overlay syntax.

## Work requiring confirmation

Deployment is stopped before all of these changes:

1. Create the separate `interview_db` and `interview_user` from the review-only SQL template; set its password privately on the server. Existing business databases and privileges stay untouched.
2. Connect the new application's containers to the approved shared network, using `interview-journal-web` as a unique Caddy upstream alias.
3. Choose a domain, provision DNS, create an authenticated HTTPS Caddy site using the review-only snippet, then validate and reload Caddy. A reload changes existing proxy configuration and therefore needs your explicit confirmation.
4. Select an independent backup destination and retention policy before using the server as the only copy of important recordings.

The existing role is not suitable for the new application. The existing Caddy configuration also needs an additional site. These are the concrete permission/configuration blockers requested by the user; the read-only inspection does not authorize applying them.

## Prepared, reviewable configuration

- `docker-compose.yml`: isolated application, private API, opt-in worker, resource caps and health checks.
- `docker-compose.lightsail.yml`: existing external network, dedicated PostgreSQL URL required, no host listener, unique web alias.
- `infra/postgres-REVIEW-ONLY.sql`: independent role/database only.
- `infra/caddy-REVIEW-ONLY.Caddyfile`: whole-site basic authentication, request-size limit, privacy headers, unique upstream.

Populate the production `.env` **on the server**, outside Git, with the approved PostgreSQL URL, network and exact HTTPS `APP_ORIGIN`. Browser writes from other origins are rejected. Password must be URI encoded. Do not copy the local-development `.env` or local PostgreSQL overlay into production. The production overlay requires Compose 2.24.4+ for `!reset`. Verify the host's Compose version before changing anything. Domain/hash placeholders must be replaced privately; raw passwords or tokens do not belong in chat, source, shell logs or CI.

After confirmation, the implementation sequence is:

1. Repeat read-only resource checks at peak-relevant load and record existing container IDs/health/restart counts. If capacity/permissions conflict, stop.
2. Build and validate images for the server architecture on a development machine/CI. API/web images were built and exercised on Linux amd64 in the successful GitHub Actions run linked in verification. The optional CPU Worker was exercised on local Linux ARM64 and macOS ARM64; validate it on the target architecture before any approved production use. Avoid consuming shared production CPU/RAM during builds.
3. Provision only the new role/database; verify login to that database with no superuser/create-role/create-db powers. Check ownership, table initialization and storage permissions.
4. Validate the combined Compose model with secrets redacted, confirm it uses only the dedicated PostgreSQL URL, and start only the new API/web containers with the production overlay. Keep the `transcription` profile disabled. Never run broad `docker compose down`, prune or cleanup commands against existing projects.
5. Verify the new service from inside the approved network before proxy integration. Compare existing services' health and resource consumption; stop if they deteriorate.
6. Add one standalone authenticated Caddy site to the already imported sites directory. Back up that configuration, validate the full Caddy model, then perform the approved reload. Verify DPES and Vision HTTPS endpoints immediately afterward.
7. Check unauthenticated access returns 401 and authenticated upload/list/playback/byte ranges work. Check microphone capture over HTTPS on the user's actual device. Establish independent backups and test restore.
8. Use the existing host monitoring to observe CPU, memory, disk and existing-service health. Add an application health probe/alerts only if separately approved. Do not claim monitoring integration solely from a running health endpoint.

Rollback only removes the new site (followed by an approved Caddy validation/reload), stops Interview Journal containers and disconnects their network endpoints. Preserve its audio volume/database for recovery. Never remove shared networks, existing containers or business data.

No public Interview Journal URL is live as part of this delivery. The usable address is the local loopback app described in README.
