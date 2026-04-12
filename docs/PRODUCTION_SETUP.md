# Production setup (Postgres, Docker, Koyeb)

**See also:** [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) (full env reference), [`HOSTING_OPTIONS_AND_HOME_LAB.md`](HOSTING_OPTIONS_AND_HOME_LAB.md) (hosting / backup context), root [`.env.example`](../.env.example).

The app is **Postgres-only** in all modes. There is **no** SQLite production path.

---

## Image vs process

| Step | What it does |
|------|----------------|
| **`docker build`** | Produces an **image** (layers + tag). Nothing runs yet except build-time commands. |
| **`docker run`** (or Koyeb / Compose starting a container) | Creates a **container** from that image and runs **`node backend/dist/server.js`**. That is when the server listens on **`PORT`** and connects to Postgres. |

So yes: after **`docker build`**, you still **`docker run`** (or let your platform start the container).

---

## Passing configuration: env file vs flags

The backend reads **`process.env`** (validated in [`backend/src/config/env.ts`](../backend/src/config/env.ts)). It also tries to load a **repo-root** `.env` file when present (useful locally); in Docker that path is **`/app/.env`** only if you **copy or mount** a file there.

**Option A — Docker `--env-file` (recommended for `docker run`)**

Use a file in **Docker env-file** format (one `KEY=value` per line, `#` comments allowed; **no** `export ` prefix):

```bash
docker run --rm -p 4000:4000 \
  --env-file /path/to/your/production.env \
  your-registry/household-finance:latest
```

Variables from `--env-file` are injected into the container environment before Node starts. You do **not** have to mount `.env` into `/app` for this to work.

**Option B — Mount `.env` at `/app/.env`**

```bash
docker run --rm -p 4000:4000 \
  -v /path/to/.env:/app/.env:ro \
  your-registry/household-finance:latest
```

Dotenv loads that file at startup (values already set by Docker still win if your dotenv config does not override — this repo uses default dotenv behavior: existing **`process.env`** entries are not overwritten by the file).

**Option C — `-e` / platform UI**

Set each variable in Koyeb’s environment panel, or `docker run -e MODE=PROD -e JWT_SECRET=...`, etc.

**Important:** Use **`MODE=PROD`**, a strong **`JWT_SECRET`** (≥ 16 characters), and correct **`DATABASE_*`** for your **external** Postgres. For managed Postgres, **`DATABASE_SSL=1`** is typical.

---

## Docker image (API + SPA, no Postgres in-container)

The repo root [**`Dockerfile`**](../Dockerfile) builds **backend + frontend**, prunes dev dependencies, and runs the same combined server as local prod: API + static **`frontend/dist`** when **`MODE=PROD`**.

```bash
# From repository root
docker build -t your-registry/household-finance:latest .

docker run --rm -p 4000:4000 --env-file ./prod.env your-registry/household-finance:latest
```

**Persistence:** Import staging, export ZIPs, and restore uploads use paths under **`data/`** inside the container (see [`backend/src/paths.ts`](../backend/src/paths.ts)). For anything you must keep across container restarts, attach a **volume** (e.g. `-v hf_data:/app/data`) or use your platform’s disk addon.

**CPU architecture:** If you build on Apple Silicon and deploy to **AMD64** (typical Koyeb workers), build with:

`docker buildx build --platform linux/amd64 -t your-registry/household-finance:latest --push .`

### App container + Postgres from Compose (local)

Inside a container, **`127.0.0.1`** is **that container’s loopback**, not your laptop and not the Postgres container. A DB GUI on the host uses **`localhost:5433`** because Compose **published** `5432 → 5433` on the host; the app container does **not** see that mapping.

If Postgres is started with **`docker compose`** from this repo, attach the app to the **same network** (see **`docker network ls`** — often **`<folder>_default`**, e.g. **`household-finance-app_default`**) and point the app at the **Compose service name** and **container port**:

| Variable | Typical value (Compose sidecar) |
|----------|----------------------------------|
| **`DATABASE_HOST`** | **`postgres`** (service name in `docker-compose.yml`; same as **`DNSNames`** / aliases on the Postgres container) |
| **`DATABASE_PORT`** | **`5432`** (not host **`5433`**) |
| **`DATABASE_SSL`** | **`0`** for local Postgres without TLS |

```bash
docker run --rm -p 4000:4000 \
  --network household-finance-app_default \
  --env-file .env \
  -e MODE=PROD \
  -e DATABASE_HOST=postgres \
  -e DATABASE_PORT=5432 \
  -e DATABASE_SSL=0 \
  your-registry/household-finance:latest
```

Place **`-e ...`** after **`--env-file`** so host-oriented values in `.env` (`127.0.0.1`, `5433`, often **`MODE=TEST`** for local `npm run dev`) are overridden for this container. **If `MODE` is not `PROD`,** Express does **not** mount `frontend/dist` — **`GET /`** returns **Cannot GET /** (API routes like **`/health`** still work).

**Alternative:** reach the host’s published port from the app container with **`DATABASE_HOST=host.docker.internal`** and **`DATABASE_PORT=5433`** on Docker Desktop; on Linux use **`docker run --add-host=host.docker.internal:host-gateway ...`**.

---

## Database lifecycle: migrations vs seeds

### Migrations (schema changes)

- **Location:** [`backend/db/migrations_pg/`](../backend/db/migrations_pg/) (`*.sql`, ordered by filename).
- **When they run:** On **every** application startup, the first Postgres connection runs **`applyPendingPgMigrations`** (see [`backend/src/db/query.ts`](../backend/src/db/query.ts)). Only files **not** already recorded in **`schema_migrations`** are applied.
- **Shipping new migrations:** Add a new `NNNN_description.sql` in the repo, **rebuild the Docker image** (or redeploy whatever artifact embeds `backend/db/migrations_pg/`), then **restart** the app. The new migration runs automatically on next boot. You do **not** run a separate migration CLI in production unless you choose to (e.g. [`scripts/db.sh`](../scripts/db.sh) `--init` only) — the app is the default applier.

So for **incremental schema patches**: commit SQL → **new deploy (new image)** → restart container. **Yes, you rebuild the image** whenever the app **or** migration files change, because migrations ship **inside** the image.

### Seeds (bootstrap data, not auto on every request)

- **Bootstrap (production-style):** [`backend/db/seeds_pg/0001_bootstrap.sql`](../backend/db/seeds_pg/0001_bootstrap.sql) — global categories, built-in rules, bootstrap household, default login user (change password after first login). **Not** applied by `node server.js`; you apply via script when you intend to.
- **Dev-only sample accounts:** [`backend/db/seeds_pg/dev/`](../backend/db/seeds_pg/dev/) — only with **`--dev-seeds`** (local smoke).

**Brand-new empty database (first install):**

1. Create database + role on your provider; set **`DATABASE_*`** in env.
2. **Either** start the app once (applies **migrations** only), **or** run **`npm run db:init`** / **`scripts/db.sh --init`** from a machine that has the repo and network access to Postgres (applies migrations only).
3. Run **bootstrap seed once:** from repo root, with the same **`DATABASE_*`** pointing at that database:

   ```bash
   npm run db:seed
   ```

   (equivalent: **`scripts/db.sh --init --seed`** — runs migrations then all `*.sql` under **`seeds_pg/`** except `dev/` unless you add `--dev-seeds`).

4. **Change default credentials** immediately (Settings / password).

**Do not** re-run **`npm run db:seed`** blindly on a database that already has bootstrap data: seed SQL is **not** tracked like migrations and may **fail** on duplicate keys or duplicate rows.

**Subsequent releases:**

- **Schema:** new migration files only; applied on next app start.
- **Reference / taxonomy data:** if you add new **`*.sql`** under **`seeds_pg/`** for production, treat it like a **one-off** or **idempotent** script and run **`scripts/db.sh --init --seed`** from CI or an operator workstation when you intend to apply it — or use a proper migration if the change is schema + data that must be versioned together.

**Normal operation:** After first bootstrap, the **database already has** your households, transactions, etc. Deploying a new **app** image does **not** wipe the DB; only **migrations** add/alter schema as needed.

---

## Koyeb

### Option 1 — Dockerfile (external Postgres)

Point Koyeb at the repo [**`Dockerfile`**](../Dockerfile), set **environment variables** to match [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md), attach **no** in-platform Postgres if you use a managed instance elsewhere.

| Topic | Configure |
|--------|-----------|
| **`PORT`** | Must match the port the service exposes (Koyeb may inject **`PORT`**). The app reads **`PORT`** in [`env.ts`](../backend/src/config/env.ts). |
| **Health check** | Prefer **HTTP GET** **`/health`** — expect **200** and JSON like `{"status":"ok"}`. |
| **`MODE`** | **`MODE=PROD`** so the SPA is served from **`frontend/dist`** bundled in the image. |

### Option 2 — Buildpack (Node from repo, no Docker)

Koyeb can still build from **Node** using the root **`package.json`**. Use a **build** that produces **both** workspaces (e.g. **`npm ci && npm run build`** at repo root) and a **run** command that starts the backend (e.g. **`npm run start -w backend`**). You must ensure **`frontend/dist`** exists so **`MODE=PROD`** can serve the UI.

| Override | Typical value |
|----------|----------------|
| **Work directory** | **`.`** (repo root) |
| **Build command** | **`npm ci && npm run build`** |
| **Run command** | **`npm run start -w backend`** |

If work directory is **`backend/`**, use **`npm start`** there and adjust paths if needed.

**`FRONTEND_PORT`** is for **local Vite** only; omit for API runtime on Koyeb.

---

## Institution list

Curated institution labels and household custom names are app-level (Connected accounts). No separate production SQL for the catalog.

---

## Summary checklist

1. **External Postgres** created; **`DATABASE_SSL`** matches provider (usually **on**).
2. **First time:** migrations (app start or `db.sh --init`) → **once** **`npm run db:seed`** → change default password.
3. **Each app release:** build + deploy new image (or buildpack build); **migrations** apply on startup; **data** stays in Postgres.
4. **Secrets** only in env / secret store — never committed.
