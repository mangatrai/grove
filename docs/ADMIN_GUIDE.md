# Admin Guide

Self-hosted household finance app. This guide covers deployment, configuration, database management, and operational procedures for administrators and sysadmins setting up Grove.

---

## 1. Overview and Architecture

Grove is a personal finance management application for self-hosted deployments. It consists of:

- **Backend:** Node.js 20 + Express (TypeScript), serving REST API + static SPA when `MODE=PROD`
- **Frontend:** React 18 + Vite (static SPA, bundled with backend for production)
- **Database:** PostgreSQL only (Postgres 17+ recommended; no SQLite in production)
- **Ingestion:** Pluggable bank adapter system for CSV/PDF statement imports; rule-based transaction classification
- **Persistence:** Financial transactions, balances, accounts, categories, rules, payslips, household data
- **Backup:** Export/restore via `.hfb` bundles (ZIP + JSON); encryption optional

### Architecture Goals

1. **Financial correctness first** — strict deduplication, transfer semantics, ACID guarantees
2. **Minimal operational friction** — single process, no external service dependencies required
3. **Self-hosted, LAN-first** — runs on home lab hardware (Pi, SFF PC) or cloud VMs; no SaaS auth required
4. **Modular design** — new bank adapters and classification rules integrate cleanly

### Key Design Principles

- **Single write path for canonicalization** — all transaction imports flow through one service to prevent inconsistency
- **Transactions stored once with fingerprint dedup** — exact and near-duplicates are flagged for user resolution, nothing is silently dropped
- **PostgreSQL for relational queries** — category hierarchies, transfer detection (cross-account joins), balance sheet aggregations all rely on SQL joins
- **Staged imports on disk** — raw files kept until canonicalization succeeds, enabling re-parse and audit trails

---

## 2. Local Development Setup

### 2.1 Prerequisites

- **Node.js** — v20 LTS or newer (see `.node-version` or run `node --version`)
- **npm** — comes with Node; this is a workspace monorepo at repo root
- **PostgreSQL** — see §5 for managed or local Docker setup
- **Ports** — defaults: UI `3000`, API `4000` (configurable in `.env`)
- **Git** — for cloning and updating the repo

### 2.2 One-Command Setup

From the repository root:

```bash
npm run setup
```

This runs `scripts/setup.sh`:
- `npm install` (both workspaces: backend + frontend)
- Creates `data/` and `.runtime/logs/` directories
- Applies database migrations
- Inserts bootstrap seed data (default household, owner user, global categories)
- Optionally loads dev sample accounts (BoA, Citi, Chase, Marcus)

Result: `.env` created from `.env.example` (you must edit `JWT_SECRET` for non-local use), Postgres initialized, app ready to run.

### 2.3 Manual Step-by-Step Setup

**1. Clone and install:**

```bash
git clone <your-repo-url> household-finance-app
cd household-finance-app
npm install
```

**2. Environment file:**

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET, DATABASE_*, PORT, etc. (see §4)
```

**3. Start Postgres (local Docker):**

```bash
docker compose up -d
# Postgres on host port 5433 (mapped from container 5432)
# Update DATABASE_HOST=127.0.0.1, DATABASE_PORT=5433, DATABASE_SSL=0 in .env
```

**4. Apply migrations and seeds:**

```bash
npm run db:seed          # migrations + bootstrap only (default household, owner user, global categories)
npm run db:seed:dev      # or: + sample BoA/Citi/Chase/Marcus accounts
```

**5. Run the application (two options):**

**Option A — Background services (logs in `.runtime/logs/`):**

```bash
npm run start:dev
# UI: http://127.0.0.1:3000
# API: http://127.0.0.1:4000
# Stop: npm run stop:dev
```

**Option B — Two terminals (foreground logs):**

```bash
# Terminal 1
npm run dev:backend      # API on PORT (default 4000)

# Terminal 2
npm run dev:frontend     # Frontend dev server on FRONTEND_PORT (default 3000)
```

**6. First sign-in:**

Open `http://127.0.0.1:3000` → sign in with the seeded user:
- **Email:** `owner@example.com`
- **Password:** `ChangeMe123!`

(Change immediately in production; see §4.)

### 2.4 Using Podman Instead of Docker (macOS)

Podman is a daemonless Docker-compatible alternative. On macOS, Podman runs a lightweight Linux VM. One-time machine setup is required before `podman run` or `podman compose` work.

**Step 1 — Initialize the Podman machine (once per machine):**

```bash
podman machine init --cpus 4 --memory 8192 --disk-size 50
```

Allocates 4 vCPUs, 8 GB RAM, and 50 GB disk to the VM. Adjust to your hardware.

**Step 2 — Start the machine:**

```bash
podman machine start
```

**Step 3 — Verify Podman is working:**

```bash
podman ps          # should return an empty table (no containers yet)
podman info        # shows machine/host details
```

**Step 4 — Start the Postgres container (pgvector image):**

Use `podman compose` as a drop-in replacement for `docker compose`:

```bash
podman compose up -d
# Postgres on host port 5433 — same as Docker setup
```

Or run the container directly without Compose:

```bash
podman run -d \
  --name household-finance-app-postgres-1 \
  -e POSTGRES_USER=household \
  -e POSTGRES_PASSWORD=<your-local-db-password> \
  -e POSTGRES_DB=household_finance_test \
  -p 5433:5432 \
  -v hf_pg_data:/var/lib/postgresql \
  pgvector/pgvector:pg18
```

**Start / stop the container:**

```bash
podman start household-finance-app-postgres-1
podman stop household-finance-app-postgres-1
```

**Start / stop the Podman VM itself (between work sessions):**

```bash
podman machine start   # before working
podman machine stop    # when done for the day (frees RAM/CPU)
```

**Inspect running containers:**

```bash
podman ps              # running containers
podman ps -a           # all containers including stopped
```

**Connect to the Postgres container directly:**

```bash
podman exec -it household-finance-app-postgres-1 \
  psql -U household -d household_finance_test
```

> Note: `docker` and `podman` commands are interchangeable for this project. If you have `podman-docker` installed, `docker compose up -d` routes through Podman automatically and no changes are needed.

---

### 2.5 Health Check and Smoke Tests

```bash
# API health
curl http://127.0.0.1:4000/health
# Expected: {"status":"ok"}

# UI should load without console errors
# Sign in succeeds
# Transactions and Settings pages open

# Run tests
npm run lint
npm test
```

### 2.6 Reset Local Data

Stop the API before cleanup:

```bash
npm run stop:dev
npm run db:cleanup       # Drops schema, re-applies migrations, bootstrap seed only
npm run db:reset:dev     # Same, but also loads sample dev accounts
npm run start:dev
```

---

## 3. Deployment Options

### 3.1 Koyeb (Managed Hosting — Recommended)

Koyeb provides a free managed PostgreSQL tier (limited) and free compute tier suitable for small to medium households.

#### Setup on Koyeb

1. **Point Koyeb to the repo** (GitHub link to this repo)
2. **Set environment variables** — use Koyeb's environment panel:
   - `MODE=PROD`
   - `JWT_SECRET=<strong-random-string>`  (e.g. `openssl rand -base64 48`)
   - `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` — from your managed Postgres
   - `DATABASE_SSL=1` (typical for managed TLS hosts)
   - `PORT=4000` (or whatever Koyeb assigns)
   - `LOG_LEVEL=info`

3. **Build command (Dockerfile):**
   - Koyeb auto-detects the [Dockerfile](../Dockerfile); uses `docker build` → `docker run node backend/dist/server.js`

4. **Build command (Buildpack alternative):**
   - If not using Docker, use a **build** that produces both workspaces:
     - **Build:** `npm ci && npm run build`
     - **Run:** `npm run start -w backend`
   - Work directory: `.` (repo root)

5. **Health check:**
   - Use HTTP GET `/health` on the PORT
   - Expected response: `200` with JSON `{"status":"ok"}`

6. **Managed Postgres:**
   - Koyeb's free tier includes ~5 compute hours/month on a small DB SKU, ~1 GB storage
   - Database may sleep after idle — fine for occasional use, not for continuous production
   - If you exceed free limits, upgrade or use an external provider

#### Important Notes for Koyeb

- **First deployment:** Migrations and bootstrap seed run automatically on first container start (app connects to Postgres, `applyPendingPgMigrations` runs).
- **New schema patches:** Rebuild the image and restart the container; migrations apply on boot.
- **Data persists in Postgres**, not in the container — imports, exports, backups are in `data/` (a container volume, not persistent across restarts unless you attach a disk addon).

### 3.2 Self-Hosted VMs / Docker

For full control: run on a personal or rented VM (e.g., VPS, home Pi, office PC). This guide covers OCI Always Free and generic Docker/systemd setups.

#### Docker Image Build and Run

From the repo root:

```bash
# Build image
docker build -t your-registry/household-finance:latest .

# Run with env file
docker run --rm -p 4000:4000 \
  --env-file /path/to/production.env \
  -v hf_data:/app/data \
  your-registry/household-finance:latest
```

**Important:** After `docker build`, you still need to **`docker run`** (or equivalent on your platform). The image contains the compiled app; the container is what executes it and connects to Postgres.

**If building on Apple Silicon for AMD64 deployment:**

```bash
docker buildx build --platform linux/amd64 \
  -t your-registry/household-finance:latest --push .
```

#### Docker + docker-compose (App Container + Postgres)

If you want Postgres also in a container:

1. Use the repo's [docker-compose.yml](../docker-compose.yml) for local Postgres (for testing, not production).
2. For the app container, attach it to the **same network** and point to the Postgres **service name**:

```bash
docker run --rm -p 4000:4000 \
  --network household-finance-app_default \
  --env-file .env \
  -e MODE=PROD \
  -e DATABASE_HOST=postgres \
  -e DATABASE_PORT=5432 \
  -e DATABASE_SSL=0 \
  -v hf_data:/app/data \
  your-registry/household-finance:latest
```

> **Inside a container, `127.0.0.1` is that container's loopback.** If Postgres is a Compose service, use the **service name** (`postgres`) as `DATABASE_HOST` and the **container port** (`5432`), not the host-published port (`5433`).

### 3.3 OCI (Oracle Cloud Infrastructure)

> **Capacity caveat (2026):** Always Free Ampere A1 capacity is frequently unavailable in popular regions (confirmed: no free machines in the Chicago region as of mid-2026, and the home region cannot be changed after signup). If you cannot get an A1 instance, use §3.5 (GCP/AWS) instead.

OCI Always Free Tier is the most generous self-hosted path **on paper** for $0/month recurring cost. It includes:

- **Compute:** 1 × Ampere A1 Flex VM (4 OCPU / 24 GB RAM — all resources can be allocated to one VM)
- **Storage:** 2 × 200 GB block volumes (for OS and data)
- **Networking:** 10 TB/month egress (far exceeds household use)

**TL;DR setup** (the full step-by-step is below):

1. Create OCI Ampere A1 Flex VM (4 OCPU, 24 GB RAM)
2. Install PostgreSQL 17, Node 20 via nvm, nginx
3. Clone repo, `npm ci`, `npm run build`
4. Create `.env` with strong `JWT_SECRET` and local Postgres connection
5. `npm run db:seed` (first time only)
6. systemd service for auto-start and auto-restart on crash
7. DuckDNS (free subdomain) + Certbot Let's Encrypt for HTTPS
8. nginx reverse proxy (port 80/443 → localhost:4000)

**Result:** Full production deployment on Always Free tier with HTTPS, auto-renewal, and backup infrastructure.

### 3.4 Database Options (Self-hosted Postgres vs Neon)

#### Self-Hosted Postgres (Recommended for Always Free / Home)

- **Where:** On the same OCI VM, on-premise hardware, or a separate managed VPS
- **Setup:** PostgreSQL 17 installed directly (no Docker); connection via TCP socket or local Unix socket
- **Pros:** No external dependencies, no monthly bills, full control
- **Cons:** You own backups, OS patching, security hardening

**Example (OCI VM):**

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -i -v 17
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Create app database and user
sudo -u postgres psql <<'SQL'
CREATE USER household WITH PASSWORD 'strong-password';
CREATE DATABASE household_finance OWNER household;
SQL
```

**Recommended Postgres tuning for a 24 GB OCI VM:**

```
shared_buffers = 6GB           # 25% of 24 GB RAM
effective_cache_size = 18GB    # 75% of RAM
max_connections = 50           # App uses ~5–10
```

#### Managed Postgres (Neon, Supabase, Aiven, etc.)

- **Koyeb Databases:** Small instance, ~5 compute hours/month, ~1 GB storage (free tier)
- **Neon, Supabase:** Generous free branches, generous storage; varies by provider
- **Pros:** Automatic backups, managed OS, no patching
- **Cons:** Vendor lock-in, may sleep/pause, per-connection costs at scale, external dependency

**For production with $0 target,** self-hosted Postgres is the right choice once you have a VM. Managed Postgres is best for **hybrid** setups (home app + managed DB for redundancy) or if you don't have hardware yet.

### 3.5 Hyperscaler Free Tiers (AWS / GCP / Azure) — Comparison and Runbooks

> **Verified 2026-07-06.** Free-tier terms change frequently — re-verify against the official pages before provisioning: [AWS Free Tier](https://aws.amazon.com/free/), [GCP Free Tier](https://cloud.google.com/free), [Azure Free Services](https://azure.microsoft.com/en-us/pricing/free-services). Migration work is tracked in GH issue #219 (epic); this section is the guide (#218).

#### 3.5.1 Hard constraint: the process must run 24/7

All schedulers (family agent digests, nightly backup, realty refresh, import cleanup, payslip poller — see `backend/src/server.ts`) are in-process `node-cron` jobs. **Scale-to-zero and serverless platforms (Cloud Run min-instances=0, Lambda, App Runner idle, Koyeb scale-to-zero) will silently skip cron fires.** Any target must be an always-on VM or a container with min-instances ≥ 1. Also set `TZ` explicitly on any new host — cloud VMs default to UTC and all crons use `env.TZ`.

#### 3.5.2 Free-tier landscape (as of mid-2026)

| Provider | What you actually get | Durable $0 host? |
|---|---|---|
| **AWS** (accounts created after 2025-07-15) | Credit-based: $100 at signup + up to $100 earned ($20 each for trying EC2, RDS, Lambda, Bedrock, Budgets). "Free plan" lasts **max 6 months or until credits run out — then the account is CLOSED** (90-day data grace) unless upgraded to a paid plan. The old 12-month free t2/t3.micro EC2 and db.t3.micro RDS are gone for new accounts. ~30 always-free services remain (Lambda, DynamoDB, SNS pub/sub) — but **no always-free EC2 or RDS**. | **No** — ~6 months near-free, then ~$5–25/mo |
| **GCP** | **e2-micro VM always free** (2 shared vCPU, 1 GB RAM), one per billing account, only in `us-west1`/`us-central1`/`us-east1`; includes 30 GB standard persistent disk + 1 GB/mo North-America egress. Plus $300/90-day new-account credits. No free Cloud SQL. | **Yes** — genuinely always-free, 24/7 |
| **Azure** | $200/30-day credit + 12 months of 750 h/mo burstable B-series VM (B1s / B2pts-v2 / B2ats-v2) for new accounts, then pay-as-you-go. No always-free VM; no spend cap — resources silently convert to billed after 12 months. | **No** — 12 months, then paid |
| **OCI** | Most generous on paper (4 ARM OCPU / 24 GB always free) but capacity-starved — see §3.3 caveat. | Only if you can get capacity |

**Bottom line:**
- **Cheapest durable setup ($0/mo + ~$10–12/yr domain):** GCP e2-micro (app) + Neon free Postgres (DB) + Cloudflare (domain registrar at cost, free DNS, free Email Routing) + S3 or GCS for backups (pennies) + SES or existing Resend SMTP for email.
- **All-AWS (if you prefer one console):** ~6 months near-free on credits, then steady-state ~$5–9/mo — EC2 `t4g.micro` (~$6–7/mo, ARM) or **Lightsail $5/mo bundle** (1 GB RAM, includes static IP + 2 TB transfer, simplest). Budget for the steady-state number, not the credit period.
- **Postgres: keep Neon regardless of provider.** RDS `db.t4g.micro` is ~$13+/mo with no free tier for new accounts — it is the single biggest avoidable cost. Postgres-on-the-VM is possible but 1 GB RAM is tight next to the Node process (~150–300 MB) and you forfeit managed backups/PITR. Neon's free tier (~100 compute-hrs/mo) suits this app's access pattern; keep `DATABASE_SSL=1`.

#### 3.5.3 Runbook A — GCP e2-micro (recommended $0 path)

1. **Account/project:** create a GCP project with billing enabled (always-free requires a billing account; you are not charged while inside free limits). Set a budget alert at $1 as a tripwire.
2. **VM:** Compute Engine → e2-micro, region `us-central1` (or us-west1/us-east1 — **only these three qualify**), 30 GB **standard** persistent disk (not SSD — SSD is not in the free allotment), Debian 12. Under Networking set **Standard network tier** (Premium tier egress bills differently) and reserve the ephemeral external IP as static (an in-use static IP is free).
3. **Do not install the Ops Agent** — it costs ~200 MB RAM you need. Add 1–2 GB swap instead:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
4. **App:** either Docker (`Dockerfile` at repo root is production-ready; on 1 GB RAM prefer plain Node to skip the Docker daemon overhead) or bare Node 20 + systemd:
   ```bash
   # Node 20 via nodesource, then:
   git clone <repo> && cd household-finance-app
   npm ci && npm run build && npm prune --omit=dev
   ```
   systemd unit (`/etc/systemd/system/household-finance.service`):
   ```ini
   [Service]
   WorkingDirectory=/opt/household-finance-app
   ExecStart=/usr/bin/node backend/dist/server.js
   Restart=always
   Environment=MODE=PROD
   Environment=TZ=America/Chicago
   EnvironmentFile=/opt/household-finance-app/.env
   User=hfapp
   [Install]
   WantedBy=multi-user.target
   ```
5. **TLS + domain:** point an A record (Cloudflare DNS) at the static IP; run [Caddy](https://caddyserver.com) as reverse proxy (`your.domain.example { reverse_proxy localhost:4000 }`) for automatic Let's Encrypt certs, or enable the Cloudflare orange-cloud proxy. Update `PUBLIC_BASE_URL`, `ALLOWED_ORIGIN`, `FRONTEND_APP_URL`, and the Google OAuth redirect URIs (Drive **and** Calendar) in the Google Cloud console.
6. **Firewall:** GCP firewall rules allow 80/443 only; port 4000 stays internal.
7. **Memory expectations:** Node app ~150–300 MB + OS leaves headroom on 1 GB with swap. If OOM-kills appear, `NODE_OPTIONS=--max-old-space-size=512`.

#### 3.5.4 Runbook B — AWS (EC2 or Lightsail)

1. **Account plan choice at signup:** pick the **paid plan** if this is meant to live past 6 months (credits still apply automatically, and the account is not closed when the free plan would expire). The "free plan" is only safe for a throwaway evaluation. Complete the five $20 credit activities (launch EC2, configure RDS *(then delete it)*, create a Lambda, call Bedrock once, set a Budget) within 6 months to collect the extra $100.
2. **Budget alarm first:** AWS Budgets → $5/mo alert. AWS has no spend cap; this is your tripwire.
3. **Compute — two options:**
   - **Lightsail $5/mo bundle** (1 GB RAM, 2 vCPU, 40 GB SSD, 2 TB transfer, static IP included) — fixed price, simplest console, same runbook as GCP step 4 onward.
   - **EC2 `t4g.micro`** (ARM Graviton, 1 GB RAM, ~$6–7/mo on-demand in us-east-2) + 8–16 GB gp3 EBS (~$1/mo) + an Elastic IP (free while attached). More knobs (security groups: 80/443 in, all out), same app setup. ARM note: Node 20 and all app deps are arch-neutral; the repo Dockerfile builds fine on arm64.
4. **App + TLS + domain:** identical to Runbook A steps 4–6 (systemd or Docker, Caddy or Cloudflare proxy, env URL updates).
5. **Database:** keep Neon (recommended, $0). If you insist on RDS: `db.t4g.micro`, 20 GB gp3, single-AZ, no Multi-AZ, no Performance Insights ≈ $13–15/mo — document the decision before paying it.

#### 3.5.5 Backups to S3 instead of Google Drive (planned — #219)

Current state: cloud backup is **hardcoded to Google Drive** (`backend/src/modules/export/gdrive-backup.service.ts`, nightly 11 PM scheduler). The migration epic (#219) introduces a storage-adapter interface (`BACKUP_STORAGE=gdrive|s3`) so encrypted `.hfb` files can go to an S3/GCS bucket instead. Cost context: the dumps are a few MB — S3 standard is ~$0.023/GB/mo, so pennies. Until that ships, Google Drive backup keeps working from any host — it only needs the OAuth env vars and outbound HTTPS.

Bucket hygiene when it ships: private bucket, versioning on, lifecycle rule expiring old versions at 90 days, and a dedicated IAM user/role scoped to `s3:PutObject`/`s3:ListBucket`/`s3:GetObject` on that one bucket.

#### 3.5.6 Email via SES (optional, config-only)

The mailer is pure SMTP (`backend/src/modules/mailer/mailer.service.ts`) — SES is a drop-in endpoint, no code change:

```
SMTP_HOST=email-smtp.us-east-2.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=<SES SMTP credential name>
SMTP_PASS=<SES SMTP credential secret>
SMTP_FROM=Household Finance <no-reply@your.domain.example>
```

Setup: verify your domain in SES (adds DKIM CNAMEs + SPF to Cloudflare DNS), create SMTP credentials, then **request production access** (new SES accounts are sandboxed to verified recipients only — the request form takes a day). Free allowance: 3,000 message charges/mo for the first 12 months of SES use, then $0.10 per 1,000 sends — effectively $0 at household digest volume. Keeping Resend is equally fine; this is a convenience consolidation, not a cost move.

#### 3.5.7 SMS — evaluated and skipped

AWS SNS / End User Messaging has **no meaningful free SMS tier** in 2026: ~$0.006–0.007 per US message plus carrier fees, plus an origination identity (toll-free number lease ~$2/mo). Email + in-app notifications cover the app's needs; SMS is out of scope unless a concrete requirement appears.

#### 3.5.8 Steady-state cost summary

| Path | After free period (monthly) |
|---|---|
| GCP e2-micro + Neon + Cloudflare DNS | **$0** (+ domain ~$10–12/yr) |
| AWS Lightsail 1 GB + Neon | $5 fixed |
| AWS EC2 t4g.micro + EBS + Neon | ~$7–9 |
| AWS EC2 + RDS db.t4g.micro | ~$20–25 |
| Azure B1s after month 12 | ~$8–10 |

---

## 4. Environment Variables Reference

The app reads a **repository root `.env`** file (created from `.env.example`). In Docker/Koyeb, provide variables via `--env-file`, platform UI, or by mounting a `.env` at `/app/.env`.

### 4.1 Required Variables (All Modes)

| Variable | Meaning | Example |
|----------|---------|---------|
| `MODE` | `TEST` or `PROD`. In `PROD`, the app serves static `frontend/dist`; in `TEST`, only API routes work. | `PROD` |
| `JWT_SECRET` | JWT signing secret; **≥32 characters required in `PROD`**, ≥16 in `TEST`. Never use the `.env.example` default in production. | `openssl rand -base64 48` output (64 chars) |
| `DATABASE_HOST` | Postgres hostname | `127.0.0.1` (local) or `postgres` (Docker service) or `db.example.com` (managed) |
| `DATABASE_PORT` | Postgres port | `5432` |
| `DATABASE_USER` | Postgres role name | `household` |
| `DATABASE_PASSWORD` | Password | ` ` |
| `DATABASE_NAME` | Database name | `household_finance` |
| `DATABASE_SSL` | `0` (false) for local unencrypted, `1` (true) for managed TLS | `0` (local) or `1` (managed) |

### 4.2 Runtime Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | Backend API listen port |
| `FRONTEND_PORT` | `3000` | Frontend dev server port (dev only; ignored in `MODE=PROD`) |
| `MODE` | (see above) | `TEST` or `PROD` |
| `TZ` | (system default) | Process timezone. Set to `America/Chicago` to anchor `new Date()` locale methods and log timestamps to US Central Time. **Required in Koyeb** — cloud servers default to UTC. Does not affect UTC-based DB timestamps. |
| `LOG_LEVEL` | `info` | Backend logging: `debug`, `info`, `warn`, `error`, `silent` |
| `LOG_FILE` | (unset) | Optional file path for log output (appended; stdout still printed). Repo-relative or absolute. |
| `ALLOWED_ORIGIN` | (unset in TEST, none in PROD) | CORS origin lock (e.g. `https://finance.example.com` in production) |

### 4.3 Transfer Matching (Optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRANSFER_MIN_AUTO_PAIR_SCORE` | `45` | Threshold (0–100) for auto-pairing transfers during import. Higher = stricter. |

### 4.4 PDF Payslip Extraction (Optional)

Required for **IBM and Deloitte payslip PDF parsing**, **protest chat**, **document OCR**, and **spending insights**. All LLM calls go through the adapter layer — the active provider is selected by `LLM_PROVIDER`.

#### Provider selection

| Variable | Purpose | Default |
|----------|---------|---------|
| `LLM_PROVIDER` | Active provider: `openai` or `anthropic` | `openai` |
| `EMBEDDING_PROVIDER` | Embedding provider (independent of LLM_PROVIDER): `openai` | `openai` |

#### OpenAI (when `LLM_PROVIDER=openai`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENAI_API_KEY` | OpenAI API key | _(required)_ |
| `OPENAI_MODEL` | Fast/cheap model — insights, summarization, PA agent brainstorm/formatting calls (search-query generation, digest prose) | `gpt-4.1` |
| `OPENAI_STRONG_MODEL` | Capable model — vision (payslip OCR), tool-use loops, PA agent judgment calls (coverage/coordination analysis, research synthesis, deadline triage), year-end summary narrative | `gpt-4o` |

> Recommended `OPENAI_MODEL=gpt-4.1` for payslip extraction. `gpt-4.1-mini`/`gpt-4o-mini` have known issues with column-type disambiguation on Deloitte stubs.

#### Anthropic (when `LLM_PROVIDER=anthropic`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | _(required)_ |
| `ANTHROPIC_MODEL` | Fast/cheap model — insights, summarization, PA agent brainstorm/formatting calls (search-query generation, digest prose) | `claude-haiku-4-5-20251001` |
| `ANTHROPIC_STRONG_MODEL` | Capable model — vision (payslip OCR), tool-use loops, PA agent judgment calls (coverage/coordination analysis, research synthesis, deadline triage), year-end summary narrative | `claude-sonnet-5` |

### 4.5 Tax Protest AI (Optional)

Required for the property tax protest chat assistant and live web search:

| Variable | Purpose |
|----------|---------|
| `TAVILY_API_KEY` | Tavily search API key for live web search during protest chat. Free tier: 1 000 credits/month. If unset, the `search_web` tool responds with a graceful "not configured" message — all other protest features remain functional. |
| `EMBEDDING_MODEL` | OpenAI embedding model for pgvector RAG. Default `text-embedding-3-small` (1536 dims). **Changing this requires a new DB migration and full re-embed of all document chunks.** |
| `EMBEDDING_MAX_INPUT_CHARS` | Characters passed to embedding API per chunk before truncation. Default `8000`. |
| `RAG_TOP_K` | Number of nearest-neighbour chunks returned per similarity query. Default `5`. Range 1–20. |
| `RAG_MIN_SIMILARITY` | Cosine similarity floor; chunks below this score are filtered from context. Default `0.65`. Range 0–1. |

**Document generation** (`GET /api/protest/:id/evidence-packet?format=pdf|docx`) uses `pdfkit` for PDF and the `docx` npm package for Word. Both are bundled dependencies — no system fonts or native binaries required.

**Deadline notifications** fire in-app and by email at 30, 7, and 1 day(s) before the `filing_deadline` and `hearing_date` stored on each protest worksheet. Notifications are triggered when the worksheet page is loaded (fire-and-forget, deduped per 2-day window). Email delivery requires SMTP to be configured (see §4.7). Notification types: `protest_filing_deadline_approaching`, `protest_hearing_approaching`.

### 4.6 Backup Encryption (Optional)

| Variable | Purpose | Example |
|----------|---------|---------|
| `BACKUP_ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256-GCM encryption of `.hfb` exports. If set, all exports are encrypted. | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Note:** Unencrypted exports can still be restored without this key. Encrypted exports require the matching key.

### 4.7 Email / SMTP (Optional, For Password Reset and Invites)

| Variable | Default | Example |
|----------|---------|---------|
| `SMTP_HOST` | (unset) | `smtp.gmail.com` or `smtp.resend.com` |
| `SMTP_PORT` | `587` | `587` (STARTTLS) or `465` (SSL) |
| `SMTP_SECURE` | `0` | `1` for port 465, `0` for port 587 |
| `SMTP_USER` | (unset) | Gmail: your address. Resend: literal `resend` |
| `SMTP_PASS` | (unset) | Gmail App Password or Resend API key |
| `SMTP_FROM` | (unset) | Display name + sender, e.g. `Household Finance <you@gmail.com>` |
| `PUBLIC_BASE_URL` | (unset) | Public app URL, e.g. `https://finance.example.com` (used in email links) |

**Email is optional** until password reset ships. If any `SMTP_*` are absent, email-dependent features degrade gracefully.

### 4.8 Google Drive Backup (Optional)

For Drive backup/restore (CR-106):

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth2 Web client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | Full redirect URI, e.g. `https://finance.example.com/gdrive/oauth/callback` (must match exactly in console) |
| `FRONTEND_APP_URL` | Optional: SPA origin for OAuth redirects, e.g. `http://localhost:3000`. Falls back to `PUBLIC_BASE_URL`. |

**If all three are missing,** Drive connect is disabled (button grayed out, `OAUTH_NOT_CONFIGURED` shown).

### 4.9 Frontend (Vite, Dev Only)

| Variable | Purpose |
|----------|---------|
| `VITE_PROXY_API` | API base URL for dev proxy; default `http://127.0.0.1:4000` |
| `VITE_DEV_SIGNIN_EMAIL` | Email prefill on `/` (dev only) |
| `VITE_DEV_SIGNIN_PASSWORD` | Password prefill on `/` (dev only) |

### 4.10 Background Schedulers

Five background jobs start automatically when the server boots using `node-cron` with IANA timezone strings (no UTC offset math, DST-safe). The stock quote scheduler runs in **all modes** (dev, test, prod). The rest are skipped in `MODE=TEST` to avoid hitting paid/auth-gated external APIs during automated test runs.

| Scheduler | Runs in | Trigger | What it does |
|-----------|---------|---------|--------------|
| **Stock quote** (`espp-stock.service.ts`) | All modes | On startup (once), then 4:15 PM ET weekdays | Fetches IBM last close via `yahoo-finance2` (free, no API key). Caches in memory. Serves stale cache outside market hours. |
| **Backup** (`gdrive-scheduler.service.ts`) | PROD only | Nightly 11 PM CT | Scans `household_gdrive_config` for households with auto-backup enabled and queues a job if the last successful backup is older than the configured interval. |
| **Realty** (`realty-scheduler.service.ts`) | PROD only | 1st of month, 10 PM CT | Refreshes Redfin AVM valuations for properties not updated in 28 days. Uses stored `api_property_id` for 1-credit API calls. |
| **Export cleanup** (`export-job.service.ts`) | All modes | Top of every hour | Deletes `.hfb` export files and marks `export_job` rows as `expired` for completed exports older than 48 hours. Also purges stale password reset tokens. |
| **Import file purge** (`import-session.service.ts`) | PROD only | Nightly 2 AM CT | Deletes staged import files from disk for sessions older than 30 days. DB rows (import_session, import_file) are never deleted — audit trail is preserved. |

No configuration is needed for the stock quote or export cleanup schedulers — they run unconditionally. If Yahoo Finance is unreachable at startup the stock chip is absent until the next 4:15 PM ET window or server restart.

---

### 4.11 Hardcoded Defaults (Non-Configurable)

| Item | Location | Details |
|------|----------|---------|
| **Bootstrap user** | `backend/db/seeds/0001_bootstrap.sql` | `owner@example.com` / bcrypt hash of `ChangeMe123!` |
| **Global categories** | `backend/db/seeds/0001_bootstrap.sql` | Taxonomy seed (income, expenses, assets, liabilities, etc.) |
| **Default global rules** | `backend/db/seeds/0001_bootstrap.sql` | Merchant pattern rules for categorization |

### 4.12 Household Inbox Email Ingestion (Optional)

Reuses the existing `SMTP_USER`/`SMTP_PASS` credentials (§8) as the IMAP login — the dedicated household Gmail account's App Password already configured for SMTP send works for IMAP too. Only the protocol-specific bits below are new.

| Variable | Default | Purpose |
|----------|---------|---------|
| `FAMILY_INBOX_IMAP_HOST` | (unset) | IMAP host, e.g. `imap.gmail.com` |
| `FAMILY_INBOX_IMAP_PORT` | `993` | IMAP port |
| `FAMILY_INBOX_IMAP_SECURE` | `true` | TLS on connect |
| `FAMILY_INBOX_IMAP_FOLDER` | `INBOX` | IMAP folder/label to poll |

**If `FAMILY_INBOX_IMAP_HOST` is unset, or `SMTP_USER`/`SMTP_PASS` are not set, the daily inbox poll no-ops silently.** See §10.4 for full setup steps and the rationale for using a dedicated IMAP mailbox instead of the per-parent Google OAuth integration.

### 4.13 PA Agent Task Loop (Optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PA_TASK_MAX_RUNS_PER_MONTH` | `60` | Per-household monthly ceiling on `runPATask` runs. See §10.6. |

---

## 5. Database Architecture

### 5.1 Schema Overview

**Platform:** PostgreSQL only (v15+, optimized for v17).

**Core tables:**

| Table | Purpose |
|-------|---------|
| `household` | Top-level container (one per instance or per multi-tenant account) |
| `app_user` | Registered users; bcrypt password hash |
| `financial_account` | Checking, savings, credit card, investment accounts |
| `transaction_canonical` | Posted ledger entries (deduped, classified, transfers linked) |
| `transaction_raw` | Parser output (staging before canonicalization) |
| `category` | Expense and income categories (global + household-custom) |
| `category_rule` | Household rules for auto-categorization |
| `category_rule_global` | Installation-wide default rules |
| `resolution_item` | Flagged rows: unknown category, exact/near duplicate, transfer ambiguity |
| `account_balance_snapshot` | Historical balance records (statement import + manual entry) |
| `payslip_snapshot` | Parsed payslip summaries |
| `import_session` | Statement import lifecycle (upload → review → finalize) |
| `import_file` | Uploaded files within a session (CSV/PDF + metadata) |
| `budget_category` | Monthly budget targets per category |
| `budget_recurring_override` | User-defined recurring expense templates |
| `household_custom_institution` | Household-scoped institution name overrides |
| `person_profile` | Tax filing status, W-4 data, household members |

**Schema source:** [`backend/db/migrations/0001_baseline.sql`](../backend/db/migrations/0001_baseline.sql) (squashed baseline) and incremental migrations in [`backend/db/migrations/`](../backend/db/migrations/) (numbered `0002`, etc.).

### 5.2 ESPP Tables (migration `0052_espp_tracker.sql`)

Two tables support the ESPP equity tracker:

**`espp_batch`** — one row per purchase date (unique per `household_id + purchase_date`):

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `household_id` | TEXT FK | References `household(id)` |
| `purchase_date` | TEXT | ISO YYYY-MM-DD |
| `shares_granted` | NUMERIC(12,6) | Shares allocated (from PDF) |
| `fmv_per_share` | NUMERIC(12,4) | Fair market value at purchase; NULL for CSV-only batches |
| `cost_basis_per_share` | NUMERIC(12,4) | Employee purchase price per share |
| `discount_per_share` | NUMERIC(12,4) | FMV − cost basis; NULL for CSV-only batches |
| `shares_transferred` | NUMERIC(12,6) | Shares released to broker (from CSV) |
| `payslip_id` | TEXT FK | Linked payslip (if pay date matches purchase date) |
| `espp_discount_payslip` | NUMERIC(12,2) | IBM-authoritative ESPP discount from payslip |
| `espp_salary_deduction` | NUMERIC(12,2) | ESPP salary deduction from payslip |
| `espp_other_deduction` | NUMERIC(12,2) | Other ESPP deductions from payslip |

**`espp_sale`** — one row per disposal event:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `batch_id` | TEXT FK | References `espp_batch(id)` |
| `household_id` | TEXT FK | References `household(id)` |
| `sale_date` | TEXT | ISO YYYY-MM-DD |
| `shares_sold` | NUMERIC(12,6) | Shares disposed |
| `sale_price_per_share` | NUMERIC(12,4) | Sale price per share |
| `proceeds` | NUMERIC(12,2) | shares_sold × sale_price |
| `ordinary_income` | NUMERIC(12,2) | discount_per_share × shares_sold (W-2 income) |
| `cap_gain_loss` | NUMERIC(12,2) | (sale_price − fmv_per_share) × shares_sold |

Both tables are registered in the export registry (restoreOrder 21–22) and included in `.hfb` backup bundles.

**Key indexes** (see migration files for full inventory). Highlights:

- **`transaction_canonical`:** Compound index `(household_id, txn_date DESC, status)` for ledger list, cash summary, budget queries
- **Transfer detection:** Index on `(household_id, account_id, txn_date)` for cross-account join performance
- **Dedup lookup:** Partial unique index on `(household_id, fingerprint)` where `status NOT IN ('duplicate', 'trashed')`
- **Full-text search:** GIN index on `search_document` (tsvector of merchant + memo)

**Why PostgreSQL?** Relational structure (categories, rules, transfer detection are multi-table joins); ACID guarantees for financial data; SQL aggregations (cash summary by category, budget actuals).

### 5.2 Migrations

**Auto-applied on startup:** When the app first connects to Postgres, it checks `schema_migrations` and runs any pending files from `backend/db/migrations/` in order.

**How to add a new migration:**

1. Create a new file: `backend/db/migrations/NNNN_description.sql` (increment the number)
2. Write idempotent SQL (use `IF NOT EXISTS`, `IF EXISTS`, etc.)
3. Commit the file to the repo
4. **Rebuild and redeploy** the Docker image or application (migrations ship inside the image)
5. On next container start, the migration runs automatically

**Important:** Migrations are **versioned inside the image**. If you edit a migration file after deployment, you must rebuild. Do not edit past migrations (breaks idempotency).

**Reset schema locally:** `npm run db:cleanup` drops the `public` schema and re-applies all migrations + bootstrap seed.

### 5.3 Backup and Restore

#### Export Backup (.hfb Bundle)

**Triggered by user:**

1. Settings → Data → Export
2. Job runs async; UI polls until complete
3. File available as persistent download link

**What's included:**

- `manifest.json` (version info, metadata)
- Per-table JSON files: household, users, accounts, categories, rules, transactions (canonical), balance snapshots, payslips, person profiles, memberships, and other registry tables
- **Global categories** are **not** included (re-seeded on restore via `db:seed`)
- **Household-custom rows** are included

**Rate limiting:** 10 exports per rolling hour.

**Storage:** Files stored in `data/exports/` (container volume in Docker). No auto-cleanup — delete manually if disk space is a concern.

**Encryption:** If `BACKUP_ENCRYPTION_KEY` is set, exports are encrypted with AES-256-GCM before being written to disk.

#### Restore from Backup

**User-initiated:**

1. Settings → Data → Import (upload `.hfb`)
2. Preview step shows row counts
3. On confirm: **destructive** — entire household wiped and replaced with bundle contents
4. All JWTs invalidated (`token_version` bumped for all users); users automatically signed out

**API (SEC #186, two-phase):**
1. `POST /exports/household/import/prepare` (multipart `file`) → validates the backup and returns
   `{ token, ...manifest }`. Nothing is modified yet.
2. `POST /exports/household/import/execute` (JSON `{ token }`) → `{ jobId }` → poll
   `GET /exports/import/:jobId`. The token is single-use and expires after 15 minutes.

A direct single-call "restore now" endpoint no longer exists — a script or client can no longer
skip the preview step and trigger a destructive restore in one shot.

**Backward compatibility:** Supports v1–v4 bundle formats (single `household-bundle.json` → split JSON).

**After restore:** Canonical transactions may reference deleted custom categories. Always use `LEFT JOIN category`, never `INNER JOIN` (see §5.1 and CLAUDE.md).

**Undoing a bad restore:** there is no automatic pre-restore safety snapshot. If a restore turns
out to be wrong, recover by restoring again from the most recent daily `pg_dump` backup (below) —
daily backups are the intended recovery path for this scenario, not an in-app undo.

#### Manual pg_dump Backup (OCI / Self-Hosted)

```bash
# Create backup
pg_dump -U household household_finance | gzip > /data/backups/hf-$(date +%Y%m%d-%H%M).sql.gz

# Automated daily backup at 02:00
(crontab -l 2>/dev/null; echo "0 2 * * * pg_dump -U household household_finance | gzip > /data/backups/hf-\$(date +\%Y\%m\%d).sql.gz") | crontab -

# Restore from dump
gunzip -c /data/backups/hf-20260101.sql.gz | psql -U household household_finance
```

**Before major changes or after adding lots of data, do a test restore** to a throwaway database to ensure backups are reliable.

---

## 6. Import Classification System

When statements are imported, the system classifies transactions via rule matching. The following sections describe the pipeline in detail.

### 6.1 Classification Flow

1. **Parser adapter** reads CSV/PDF, outputs **`transaction_raw`** rows (amount, date, description, etc.)
2. **Canonicalize** service converts raw → `transaction_canonical` and runs classification
3. **Rules matching** (in order):
   - Household **`category_rule`** rows (per-household, user-created or imported)
   - Installation **`category_rule_global`** rows (default built-in rules)
4. **First match wins;** if no rule matches, **`category_id = NULL`** and **`unknown_category`** resolution item is created
5. User resolves unknowns in **Transactions → Needs review**

### 6.2 Exact and Near Duplicates

**Exact duplicate:** Same fingerprint (`household_id + account_id + txn_date + rounded_amount + normalized_description`) or same **FITID** as existing posted row → inserted as `status = 'duplicate'` and flagged in **Needs review**. User can resolve (keep) or trash.

**Near-duplicate:** Same account, date, and amount, but slightly different description → `resolution_item(type: duplicate_ambiguity)` only; row is **not** inserted into canonical ledger.

**Idempotency:** Re-running canonicalize on the same session is safe (source_ref check skips already-canonicalized raw rows).

### 6.3 Transfer Detection

Cross-account debit/credit pairs are detected:
- Amount match (exact or within threshold)
- Date proximity (±2 days)
- Account relationship (same household)

**Outputs:**
- `transfer_confirmed` — high confidence, `transfer_group_id` assigned
- `transfer_suspected` — ambiguous, flagged in **Needs review**
- `not_transfer` — low confidence, treated as separate transactions

### 6.4 Custom Rules in the UI

**Categories → Rules** (`/categories/rules`) allows users to create household-scoped rules:

- **Condition:** Pattern match on normalized description (lowercase, alphanumeric + spaces)
- **Action:** Assign a category
- **Scope:** `any`, `credit_only`, or `debit_only` (for income vs expense)
- **Priority:** Order of evaluation (rules are processed in order until first match)

**Re-apply rules to ledger:** `POST /categories/rules/recategorize` applies all enabled rules to **all posted transactions** in the household (or `uncategorized_only` if preferred). Does not filter by import session; finalizes imports' rows are included.

---

## 7. Caching Architecture

The frontend uses **localStorage-based caching** to avoid re-running expensive backend queries on every page load. There is **no server-side cache layer.**

### 7.1 Cache Scopes

| Scope | Invalidated by | Endpoints cached |
|-------|---|---|
| `dashboard` | Any write to `transaction_canonical` | `GET /reports/cash-summary` |
| `networth` | Any write to `account_balance_snapshot` or `property_value_snapshot` | `GET /reports/balance-sheet*` (snapshot and history) |

### 7.2 Cached Endpoints

| Endpoint | Cache TTL | Why expensive |
|---|---|---|
| `GET /reports/cash-summary` | 7 days | ~30–40 table scans per month window |
| `GET /reports/balance-sheet/history` | 7 days | Up to 180 sequential queries (full balance sheet for each date) |
| `GET /reports/balance-sheet` (snapshot) | 24 hours | Joins accounts, snapshots, properties; fires on every load + filter |
| `GET /reports/balance-sheet/history?accountIds=…` (per-account) | 7 days | One call per expanded row; up to 10–20 calls |

### 7.3 Invalidation Trigger

After any successful non-GET request (POST/PATCH/DELETE), `apiJson()` calls `invalidateCacheByUrl(path)` to bump the scope version counter in localStorage. All entries for that scope are immediately stale; next refetch pulls from the server.

**Not cached:** Resolution summary, budget, recurring overrides, household settings, ledger list (must always reflect user's current filters).

### 7.4 Logout

`setToken(null)` removes the JWT token from localStorage. Data caches (`dashboard`, `networth`, `recurring`) are preserved across logout — they are household-scoped and shared by all members, so clearing them on logout would cause unnecessary cold-cache loads on re-login. Caches expire via their TTL or manual Refresh.

---

## 8. Email Infrastructure

Email is used for **password reset** (CR-095b) and future **invites, notifications, budget alerts, and timesheet reminders.**

### 8.1 Providers

| Provider | Free tier | Recommended use |
|---|---|---|
| **Gmail App Password** | 500/day | Quick start (uses existing Google account) |
| **Resend** | 3,000/month | Production (purpose-built, best deliverability) |
| **Brevo** | 300/day | Fallback |
| **AWS SES** | $0.10/1,000 after free tier | Scale (cost-optimized) |

### 8.2 Configuration

The app uses **nodemailer + SMTP** abstraction — no vendor SDK required. Provider is swapped by changing env vars.

**Gmail App Password example:**

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM=Household Finance <your-email@gmail.com>
PUBLIC_BASE_URL=https://finance.example.com
```

**Resend example:**

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxx  # Resend API key
SMTP_FROM=Household Finance <onboarding@resend.dev>
PUBLIC_BASE_URL=https://finance.example.com
```

### 8.3 Status

- **Password reset (CR-095b):** Implemented. If `SMTP_*` not set, admin reset (Settings → Members) remains the fallback.
- **Invites (CR-095a):** Planned (medium term).
- **Notifications (Budget alerts, timesheet reminders):** Planned (phase 3).

**If SMTP not configured,** email-dependent features degrade gracefully (no broken UI).

---

## 9. Operations Reference

### 9.1 Common Database Commands

**Connect to local Postgres (Docker):**

```bash
psql -h 127.0.0.1 -p 5433 -U household -d household_finance
```

**Count transactions:**

```sql
SELECT COUNT(*) FROM transaction_canonical WHERE household_id = '<household-id>';
```

**List accounts:**

```sql
SELECT id, name, account_type FROM financial_account WHERE household_id = '<household-id>';
```

**Check migrations applied:**

```sql
SELECT name FROM schema_migrations ORDER BY name;
```

**Manual balance snapshot (e.g., after statement reconciliation):**

```sql
INSERT INTO account_balance_snapshot (household_id, financial_account_id, balance, as_of_date, source)
VALUES ('<household-id>', '<account-id>', 12345.67, '2026-05-25', 'manual');
```

**Reset password (admin):**

```sql
UPDATE app_user SET password_hash = '<bcrypt-hash>' WHERE id = '<user-id>';
```

(Use `bcrypt` CLI or a bcrypt utility to generate the hash; see password reset flow in docs.)

### 9.2 Logs and Monitoring

**Backend logs (dev):**

```bash
npm run start:dev
# Logs appear in .runtime/logs/backend.log (if LOG_FILE set)
# Also printed to stdout
```

**Backend logs (production/OCI systemd):**

```bash
sudo journalctl -u household-finance -f
# Follow logs in real-time
```

**Adjust log level:**

```bash
LOG_LEVEL=debug npm run dev:backend
# or in .env: LOG_LEVEL=debug
```

**App health check:**

```bash
curl http://127.0.0.1:4000/health
# Expected: {"status":"ok"}
```

**Postgres logs (OCI):**

```bash
sudo tail -f /var/log/postgresql/postgresql-17-main.log
```

### 9.3 Troubleshooting

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| **Port in use** | Another process on 3000 or 4000 | Change `PORT` / `FRONTEND_PORT` in `.env` or kill the other process |
| **Cannot connect to Postgres** | Wrong host/port/credentials or Postgres not running | Verify `DATABASE_*` in `.env` matches running instance; `psql -h ... -U ... -d ...` test |
| **401 / invalid token** | Stale JWT or wrong JWT_SECRET | Clear browser storage for the site; sign out and sign in again |
| **Old data still showing after db:cleanup** | API still connected | Stop services (`npm run stop:dev`), then cleanup, then start |
| **Migrations failed on startup** | Syntax error in migration file or permission issue | Check logs; verify Postgres user has schema permissions; review the migration SQL |
| **Import processing hangs** | Parser or canonicalize taking too long | Check CPU/memory on the server; review logs for errors. For very large imports, consider async canonicalize (backlog item #12) |
| **Email not sending** | SMTP not configured or credentials wrong | Verify all `SMTP_*` are set correctly; test with `telnet smtp.gmail.com 587` |
| **Certbot renewal fails (OCI)** | Port 80 not open in firewall or DNS stale | Check OCI Security List and ufw (`sudo ufw status`); verify DuckDNS A record points to correct IP |

**Restore from backup (quick recovery):**

1. If data is corrupted or you need to revert, export a `.hfb` before major changes
2. From Settings → Data → Import, upload the `.hfb`
3. Confirm the destructive restore — household is wiped and replaced
4. All users are signed out (JWT invalidated)

**Purge old import staging files:**

```bash
npm run import:purge -- --help
# Removes old staged files to reclaim disk space
```

---

## 10. Family Planner — Google Calendar Integration

The Family Planner module (V6) reads all calendar data from Google Calendar via the Google Calendar API. Work calendar events are mirrored into Google Calendar via an iOS Shortcut on each parent's corporate iPhone.

### 10.1 Google Cloud Project Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) — reuse the existing Grove project if one exists from Google Drive setup.
2. **Enable API:** APIs & Services → Library → search "Google Calendar API" → Enable.
3. **OAuth consent screen:** APIs & Services → OAuth consent screen
   - User type: External
   - Fill in app name ("Grove"), support email, developer email
   - Scopes: add `https://www.googleapis.com/auth/calendar.readonly` (read calendars + events)
   - **Publish the app** (click "Publish App" → confirm). Both parents will see an "unverified app" warning on first sign-in — click Advanced → Continue. After that, tokens persist indefinitely.
   - Keeping the app in Testing status causes refresh tokens to expire after 7 days — always publish.
4. **OAuth credentials:** APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:4000/auth/google/callback` (dev) + your Koyeb URL `/auth/google/callback` (prod)
   - Download the client JSON; note the Client ID and Client Secret for env vars.

**Environment variables to add:**
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALENDAR_REDIRECT_URI=https://your-koyeb-app.koyeb.app/gcal/oauth/callback
```

> **Note:** `GOOGLE_CALENDAR_REDIRECT_URI` is distinct from `GOOGLE_REDIRECT_URI` (used by Google Drive backup). Calendar OAuth uses the `/gcal/oauth/callback` path; Drive uses `/gdrive/oauth/callback`. Both share the same `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If you use both features, register both redirect URIs in the Google Cloud console and set both env vars.

### 10.2 Per-Parent Google Calendar Connect

Each parent connects their personal Google account once via the Grove app (Family → Settings → Connect Google Calendar). The OAuth refresh token is stored per-user in the DB. The agent uses the stored token to query Google Calendar at runtime — no re-auth required after initial connect as long as the Google Cloud project is in Production status.

### 10.2a Calendar Roles (FIX #212 — calendar provenance)

Each connected calendar can be tagged with a **role**: `work` | `school` | `activities` | `other`, saved via `PATCH /gcal/calendar-roles` (per-user, stored as JSON in `oauth_integrations.calendar_roles`, migration `0079_gcal_calendar_roles.sql`). The Family Planner agent (Domains 1/2) treats `school`-role events as informational only — e.g. a school closure never counts as a parent being unavailable, unlike a `work`-role event at the same time. Without an explicit role saved, the agent falls back to a name heuristic (`heuristicCalendarRole` in `gcal.service.ts`): a calendar named "…ISD"/"…School"/"…Class" defaults to `school`; "…Camp"/"…Sport"/"…Activit…" defaults to `activities`; everything else defaults to `work`. Set roles explicitly in Settings → Family → Google Calendar rather than relying on the heuristic for anything ambiguous.

### 10.2b Tavily Search Quality — Credit Usage (FIX #210)

Domain 3 (proactive research) and Domain 4 (deadline sweep) both call `tavilySearch()` (`backend/src/llm/tools/tavily.ts`) with `search_depth: "advanced"` (was `"basic"`) to get richer snippets and an LLM-synthesized answer line. **Advanced depth costs 2 Tavily API credits per query, vs. 1 for basic** — at ~7 queries per agent run, this roughly doubles Tavily credit usage. On the free tier (1,000 credits/month, see `TAVILY_API_KEY` in §5), this is still negligible at the household's run cadence (daily delta + weekly full digest). If `TAVILY_API_KEY` is unset, Domain 3 falls back to LLM-only suggestions (graded `"lead"`, never `"verified"`, since nothing was actually searched); Domain 4 degrades similarly.

### 10.3 Work Calendar Mirroring — iOS Shortcut Setup

Both parents have corporate iPhones with the Exchange/O365 work calendar syncing natively. Work events are mirrored to a personal Google Calendar via an iOS Shortcut that runs twice daily.

**One-time setup per parent:**

**Step 1 — Add Google Account to iPhone Calendar**

Settings → Calendar → Accounts → Add Account → Google → sign in with personal Google account → ensure Calendars toggle is ON.

**Step 2 — Create "Work — Mirrored" calendar in Google Calendar**

On desktop at calendar.google.com: Other calendars (+) → Create new calendar → Name: `Work — Mirrored`. Do this separately for each parent's Google account.

**Step 3 — Build the Shortcut**

Open Shortcuts app → tap + → add these actions in order:

1. **Find Calendar Events**
   - Calendar: your work/Exchange calendar (e.g. "Work" or corporate email)
   - Date: is in the next 14 days

2. **Remove Events** (input: result from step 1)

3. **Find Calendar Events**
   - Calendar: your actual work/Exchange calendar (same as step 1)
   - Date: is in the next 14 days

4. **Repeat with Each** (input: result from step 3)

   Inside the loop:

   5. **Add New Event**
      - Title: `Repeat Item → Title`
      - Calendar: `Work — Mirrored` (your Google calendar)
      - Start Date: `Repeat Item → Start Date`
      - End Date: `Repeat Item → End Date`
      - All Day: `Repeat Item → Is All Day`
      - **Show Compose Sheet: OFF** ← critical; without this, iOS prompts confirmation for every event

   **End Repeat**

6. **Show Notification** — e.g. "Work calendar synced"

Rename the shortcut to **"Sync Work Calendar"**.

**Step 4 — Set Up Daily Automations**

Shortcuts → Automation tab → + → Personal Automation → Time of Day

- Create two automations: 6:00 AM and 6:00 PM, Daily
- Action: run "Sync Work Calendar"
- **Ask Before Running: OFF** on each automation

The 6am run ensures work events are in Google Calendar before the agent's morning planning pass. The 6pm run picks up same-day adds and next-day changes.

**Notes:**
- Each parent has their own `Work — Mirrored` calendar in their own Google account — the Shortcut only writes to the signed-in account, no cross-contamination.
- The Shortcut clears all future events in `Work — Mirrored` and recreates them on every run. This is intentional — clean dedup without needing API-level upsert logic.
- The agent reads `Work — Mirrored` as a regular Google Calendar — no special handling needed.

### 10.4 Household Inbox Email Ingestion (FIX #215, broadened CR-224)

The agent polls a **dedicated household Gmail account** daily (6:12am, `env.TZ`) over IMAP and turns actionable emails into review-first suggestion alerts (Family Planner → Alerts, tagged `[EMAIL]`, or `[EMAIL] [URGENT]` for a fraud alert or a same-week deadline). Nothing is written to `family_events` or Google Calendar without the user clicking **Add to Calendar** on the resulting alert.

**What kinds of emails are understood** — the model first identifies the email's genre, then extracts per that genre's rules:
- **school/activity** — permission slips, fundraisers, activity reminders, field trips.
- **order/delivery** — delivery dates, return-window deadlines, action needed on a failed delivery.
- **financial notice** — payment due dates, card expiry; low-balance/fraud alerts are flagged as info-only (never a full account number — last 4 digits only).
- **appointment/medical** — confirmations, reschedule links, prep instructions that carry a date.
- **invitation/social** — event date and RSVP deadline, extracted as two separate items when both are present.
- **utility/service/government** — renewal deadlines, service-interruption dates, registration/inspection windows.
- **promotional/newsletter** with no actionable item — no items extracted.

**Why IMAP + a dedicated account, not the existing Google OAuth integration:**

`oauth_integrations` (used for Calendar in §10.1–10.2 and Drive backup in §4.8) is scoped **per-parent** — each parent connects their own personal Google account. Routing inbox ingestion through that same table would mean either (a) picking one parent's personal inbox to poll, which is semantically wrong (school emails aren't "owned" by one parent), or (b) adding a household-level entry into a table whose every other row is a per-user OAuth grant — blurring the "whose account is this" semantics the FIX #212/#217 calendar-provenance work depends on staying clean. A **separate dedicated household Gmail account** (e.g. `yourfamily.grove@gmail.com`), authenticated via IMAP + App Password, avoids both problems: it's not tied to any one parent, and it never touches `oauth_integrations` at all. The tradeoff is one more account to provision — a one-time, ~5 minute setup below.

**Credentials are reused from SMTP (§8), not duplicated.** The dedicated household Gmail account's App Password is the same credential for both sending (SMTP) and polling (IMAP) — `SMTP_USER`/`SMTP_PASS` supply the IMAP login. Only the IMAP-specific host/port/folder are separate env vars.

**One-time setup:**

1. Create a new, dedicated Gmail account for the household (do not reuse either parent's personal account) — e.g. `yourfamily.grove@gmail.com`.
2. Have school/activity newsletters forwarded or directly sent to this address (update sign-up forms, or set up mail forwarding rules from parents' existing inboxes).
3. Enable IMAP: Gmail Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP.
4. Enable 2-Step Verification on the account (required for App Passwords): Google Account → Security → 2-Step Verification.
5. Generate an App Password: Google Account → Security → App passwords → generate one for "Mail". Copy the 16-character password.
6. Set `SMTP_USER` to this account's address and `SMTP_PASS` to the App Password (§8) — if SMTP is already configured with a different account, either point SMTP at this dedicated account too, or note that today's design ties IMAP credentials to whatever `SMTP_USER`/`SMTP_PASS` are set to.
7. Set the IMAP-specific environment variables below and redeploy.

**Environment variables:**

| Variable | Default | Example |
|----------|---------|---------|
| `FAMILY_INBOX_IMAP_HOST` | (unset) | `imap.gmail.com` |
| `FAMILY_INBOX_IMAP_PORT` | `993` | `993` |
| `FAMILY_INBOX_IMAP_SECURE` | `true` | `true` (TLS) |
| `FAMILY_INBOX_IMAP_FOLDER` | `INBOX` | `INBOX` or a Gmail label mapped as an IMAP folder |

The feature is **optional** — if `FAMILY_INBOX_IMAP_HOST` is unset, or `SMTP_USER`/`SMTP_PASS` (§8) are not set, the daily poll no-ops silently (`isEmailIngestConfigured()` returns false) and no other functionality is affected.

**Cost:** negligible — one IMAP poll/day against a free Gmail account, plus one LLM extraction call per new message per household (same `chatModel()` as the rest of the family-agent module, capped at 10 items/email, 1200 max output tokens).

**Security:**
- The email body is treated as **untrusted third-party content** — the extraction prompt explicitly instructs the model to extract facts only, never follow instructions embedded in the email. Extraction runs on the tool-less chat completion path (`getChatAdapter().complete()`), never the tool-use/agentic path, so a malicious email cannot trigger tool calls.
- Extraction output is zod-validated before touching the database; malformed/unparseable responses are logged and dropped (message is marked `error` in `email_ingest_log`, not retried until the next poll re-fetches it — see dedup below).
- No suggestion auto-creates a calendar event or `family_events` row — every one requires the existing approve flow (`POST /alerts/:alertId/approve`).
- Only the configured `FAMILY_INBOX_IMAP_FOLDER` (default `INBOX`) is ever queried.

**Data model:** `email_ingest_log` (migration `0081_email_ingest_log.sql`) records one row per `(household_id, message_id)` — the `UNIQUE` constraint is the dedup mechanism (`ON CONFLICT DO NOTHING`), so a message still present in the mailbox on the next poll is skipped per household rather than re-processed. `status` is one of `pending`/`processed`/`ignored`/`error`. Extracted items that would duplicate an existing active `family_events` row (fuzzy title match + exact date) are silently skipped rather than creating a redundant alert. Registered in `EXPORT_REGISTRY` (`restoreOrder: 29`) for backup/restore.

### 10.5 Occasion Awareness — Birthday/Holiday Lead-Time Nudges (#223)

A new agent domain, `detectOccasions`, runs on every agent run alongside coverage/coordination, proactive research, and deadline sweeping, and produces `alert_type = 'suggestion'` rows in `family_agent_alerts` (same table and approve/resolve flow as everything else in Family Planner → Alerts). **Fully deterministic — no LLM call, no Tavily search, no hardcoded holiday list.**

**Three detection sources:**
1. **Household member birthdays** — `person_profile.date_of_birth_encrypted`, decrypted at read time.
2. **Calendar-derived birthdays/anniversaries** — event titles on connected Google Calendars matched against a birthday/anniversary regex.
3. **Seasonal/cultural holidays** — read directly from any Google Calendar the household has subscribed to whose calendar ID ends `#holiday@group.v.calendar.google.com` (Google's own public "Holidays in United States", "Holidays in India", etc. calendars). `fetchCalendarEvents` fetches these with a wider 25-day lookahead window, independent of the household's `selectedCalendarIds`, so narrowing day-to-day sync to specific calendars doesn't lose occasion awareness. **Design note:** an LLM+Tavily-based seasonal-occasion guess was considered and rejected — Tavily results can be stale or wrong, and a fixed Western-holiday list wouldn't know which holidays a specific household actually observes. Reading calendars the household already subscribes to sidesteps both problems with zero extra API cost.

**Tiering:** gift-able occasions (member birthdays, holidays) get a `[GIFT-IDEAS]` nudge at 21 days out and a `[LAST-CALL]` nudge at 5 days out — both can be open at once. Calendar-derived birthdays/anniversaries get a single `[SEND-WISHES]` nudge at 3 days out. Reason text is stable across days so the existing alert dedup (`alertDedupKey`) naturally prevents re-firing once a tier has opened; `detectOccasions` also pre-filters against currently-open alerts before returning, so a 3-week gift-tier window can't retrigger the digest email every day it stays open.

**Settings toggle:** `family_occasion_settings` (migration `0082_family_occasion_settings.sql`, one row per household, `enabled BOOLEAN DEFAULT TRUE`) — Settings → Family → Occasion Nudges. `GET`/`PATCH /api/family/occasion-settings` (owner/admin only). Missing row defaults to enabled. Registered in `EXPORT_REGISTRY` (`restoreOrder: 30`) for backup/restore.

**No new env vars, no new cost** — this reuses the existing Google Calendar OAuth connection from §10.1–10.2; no additional API scopes are required (holiday calendars are read the same way as any other calendar the account has access to).

**Explicitly deferred:** the Phase 2 auto-enqueue gift-research bridge (turning a `[GIFT-IDEAS]` alert into an automatic Tavily research task) is out of scope for this ship, gated on issue #164.

### 10.6 PA Agent Task Loop — Open-Ended Research (Phase 2a/2c, #164/#166)

`runPATask(goal, householdId)` (`backend/src/modules/family/pa-task-runner.ts`) runs a bounded, BabyAGI-style loop for open-ended goals the fixed 5-domain pipeline above can't handle — e.g. "find cheaper flights DFW→Delhi in December", "find a gift for [member] under $40". **Not yet HTTP-reachable** — no route is wired up (that's issue #167); it's a standalone function today, callable from tests or a future scheduled bridge.

Each run: up to 6 iterations of decide-next-step → run one of `search_web` / `fetch_page` / `search_calendar` / `search_finance_context` → compress the result → repeat, then a final synthesis call. Every run — including refused ones — is persisted to `pa_task_run` (migration `0083_pa_task_run.sql`): status, iteration count, the uncompressed findings ledger, compressed history, and accumulated LLM/Tavily usage.

**Environment variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `PA_TASK_MAX_RUNS_PER_MONTH` | `60` | Per-household ceiling on non-failed `pa_task_run` rows in the current calendar month. At cap, `runPATask` writes a `refused_budget` row and returns `PA_BUDGET_EXCEEDED` without making any LLM or Tavily calls. A run-count ceiling was chosen over a dollar ceiling — no per-model price table to keep current, and it's predictable for the user ("60 research tasks a month"). |

**Cost:** each run makes roughly 8–13 LLM calls (up to 6 loop-decision + 6 compression calls on `chatModel()`, 1 synthesis call on `strongModel()`) plus one Tavily call per `search_web`/`fetch_page` tool use. `pa_task_run.estimated_cost_usd` is left `null` — deliberately not computed from a static per-model price table that would go stale.

**Data handling:** `pa_task_run` is registered in `EXPORT_EPHEMERAL_TABLES` (`export-registry.ts`) — operational run history, same bucket as `import_job`/`export_job`/`insight_job`, not restored from backups.

**Honesty guardrails:** Tavily search snippets can't return live JS-rendered prices (Google Flights, retailer carts). Synthesis is instructed to cite every price/availability claim to its findings-ledger source + observation date ("observed \<date\> — verify at \<link\>"), never assert a live quote, and say "could not verify" rather than fill in a gap — so a flight-research goal returns constraint-satisfying routes/options + typical price ranges + booking links, not fabricated fares.

**Testing:** `backend/tests/pa-task-runner.test.ts` covers loop mechanics only (mocked LLM + Tavily). Live-provider quality is checked manually via `npm run pa-task-eval -w backend -- "<goal>" [householdId]` (`backend/scripts/pa-task-eval.ts`) before shipping any change to the loop — not part of `npm test`.

---

## Related Documentation

| Document | Topic |
|----------|-------|
| [§2 Local Development Setup](#2-local-development-setup) | Prerequisites, one-command setup, manual steps |
| [§3 Deployment Options](#3-deployment-options) | Koyeb, OCI, VMs, Docker, Neon |
| [§4 Environment Variables](#4-environment-variables-reference) | Full `.env` reference |
| [§5 Database Architecture](#5-database-architecture) | Schema, migrations, backup/restore |
| [§6 Import Classification](#6-import-classification-system) | Rule matching, dedup, transfer detection |
| [§7 Caching Architecture](#7-caching-architecture) | Client-side cache, invalidation, localStorage |
| [§8 Email Infrastructure](#8-email-infrastructure) | SMTP setup, provider options |
| [`USER_GUIDE.md`](USER_GUIDE.md) | End-user features (imports, transactions, settings) |
| [`API_REFERENCE.md`](API_REFERENCE.md) | All API endpoint documentation |
| [`CHANGE_HISTORY.md`](CHANGE_HISTORY.md) | Release notes and feature changelog |

---

## Appendix: Checklists

### First-Time Production Deployment Checklist

- [ ] **Postgres created** with strong password; `DATABASE_*` configured
- [ ] **`JWT_SECRET`** set to strong random value (≥32 chars); **not** the `.env.example` default
- [ ] **`ALLOWED_ORIGIN`** set to your public URL (e.g. `https://finance.example.com`)
- [ ] **Boot password changed** immediately after first sign-in (Settings → Account)
- [ ] **TLS/HTTPS** configured (nginx + Let's Encrypt on OCI, or Koyeb's default HTTPS)
- [ ] **Backups** scheduled (pg_dump + cron for self-hosted; managed backups for Koyeb)
- [ ] **Health check** passes: `curl https://finance.example.com/health`
- [ ] **Smoke test:** sign in, view transactions, export a backup

### Regular Maintenance Checklist

- [ ] **Weekly:** Review logs for errors; check disk space (especially `data/` and Postgres)
- [ ] **Monthly:** Run a test restore from backup to a throwaway database
- [ ] **Before major app updates:** Export a `.hfb` backup manually
- [ ] **Postgres tuning:** Monitor slow queries; review logs if performance degrades
- [ ] **Certificate renewal (OCI):** Check Certbot auto-renewal is active

### Disaster Recovery Checklist

- [ ] **Data loss:** Restore from `.hfb` (Settings → Data) or `pg_dump` backup
- [ ] **Postgres corruption:** Drop schema, reapply migrations, restore from backup
- [ ] **Forgot admin password:** Use admin-reset flow (Settings → Members) if accessible; otherwise, direct DB update or reinit from backup
- [ ] **Complete instance loss:** Restore VM from cloud snapshot; or rebuild VM + restore from backup

---

**Last updated:** 2026-05-25  
**Version:** 1.0
