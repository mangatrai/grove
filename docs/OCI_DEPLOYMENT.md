# OCI Always Free Tier — Deployment Guide

**Target:** Self-hosted production deployment on Oracle Cloud Infrastructure Always Free Tier.
**Stack:** Ubuntu 22.04 · PostgreSQL 17 · Node 20 · nginx · Let's Encrypt (DuckDNS)
**VM:** Single Ampere A1 Flex — 4 OCPU / 24 GB RAM. App and DB run on the same machine.

> **No code changes required.** `trust proxy` is already set in `app.ts` (FIX-118) so nginx can forward HTTPS correctly.

---

## OCI Always Free Tier — What You Get

| Resource | Always Free Allowance |
|---|---|
| Compute — Ampere A1 Flex | 4 OCPU + 24 GB RAM total (use all on one VM) |
| Block Volumes | 2 × 200 GB |
| Networking (VCN) | 1 VCN, unlimited internal; 10 TB/month egress |
| Reserved Public IP | 1 (free while attached to a running instance) |
| Object Storage | 20 GB (not needed for this deployment) |

**How to identify free-tier resources in the OCI Console:** Any resource that is Always Free shows an "Always Free" badge or chip next to its name or price. In the Compute shape selector, `VM.Standard.A1.Flex` shows "Always Free eligible." In Block Volume creation, the 200 GB size shows "Always Free." If you do not see the badge, you are about to incur charges — stop and verify your selection.

**What is NOT free:**
- Load Balancers beyond 1 × 10 Mbps (skip — nginx handles it)
- Multiple reserved public IPs (you need exactly 1)
- Outbound transfer above 10 TB/month (far beyond household use)

---

## Step 1 — Create the VM

1. Sign in to [cloud.oracle.com](https://cloud.oracle.com) and navigate to **Compute → Instances → Create Instance**.

2. **Name:** `household-finance`

3. **Image:** Click "Edit" on the Image row → **Platform Images** tab → select **Canonical Ubuntu 22.04**. (Ubuntu is easier to work with than Oracle Linux for Node/Postgres setup.)

4. **Shape:** Click "Change shape" → **Ampere** tab → select `VM.Standard.A1.Flex` → set **OCPU count: 4** and **Memory: 24 GB** → confirm the "Always Free eligible" chip is visible → click "Select shape."

5. **Networking:** Under "Primary network," choose **Create new virtual cloud network.** Accept defaults — this creates a VCN, public subnet, internet gateway, and route table automatically. Note the VCN name for the next step.

6. **SSH keys:** Choose "Generate a key pair for me" → **Download** both private and public keys to a safe location on your local machine. Alternatively, paste your existing `~/.ssh/id_ed25519.pub` if you prefer your current key.

7. **Boot volume:** Expand "Boot volume" → check "Specify a custom boot volume size" → set **200 GB**. The Always Free badge will appear. Leave encryption at the default (Oracle-managed key).

8. **Public IP:** Expand "Advanced options" → **Networking** tab → under "Public IP address," select **"Reserve a public IP address."** A reserved IP stays assigned even when the instance is stopped — prevents DNS changes when you reboot.

9. Click **Create.** Wait 1–2 minutes for provisioning. Note the **Public IP Address** shown on the instance detail page.

---

## Step 2 — OCI Networking (Security List)

OCI has **two independent firewall layers** — both must allow a port for traffic to reach the VM:
1. **OCI Security List** — VCN-level, configured in the console
2. **OS firewall (ufw)** — Ubuntu kernel-level, configured via SSH

### OCI Console — VCN Security List

Navigate to **Networking → Virtual Cloud Networks → (your VCN) → Security Lists → Default Security List.**

Add the following **Ingress Rules** (leave existing rules in place):

| Source | Protocol | Port | Purpose |
|---|---|---|---|
| `<your-home-IP>/32` | TCP | 22 | SSH — restrict to your IP only |
| `0.0.0.0/0` | TCP | 80 | HTTP — required for Let's Encrypt HTTP-01 challenge |
| `0.0.0.0/0` | TCP | 443 | HTTPS — public app access |

> **Do not add a rule for port 4000.** The Node app binds to localhost only; nginx proxies to it internally. Port 4000 must not be reachable from the internet.

The default **Egress Rule** (allow all outbound) is correct — leave it.

### OS Firewall (ufw)

SSH into the VM and run:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <your-home-IP> to any port 22
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
# Verify
sudo ufw status verbose
```

---

## Step 3 — Initial VM Setup

```bash
# SSH in using the key you downloaded or generated
ssh -i ~/.ssh/<downloaded-key-name>.key ubuntu@<OCI-PUBLIC-IP>

# Update all packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential

# Create a dedicated non-root user to run the app
sudo useradd -m -s /bin/bash appuser
sudo usermod -aG sudo appuser

# Switch to appuser for all remaining steps in this guide
sudo su - appuser
```

---

## Step 4 — Attach and Mount Data Volume (Recommended)

Using a separate block volume for app data makes backups simpler and isolates the OS disk.

1. In the OCI Console, go to **Storage → Block Volumes → Create Block Volume.**
   - Size: **200 GB** (confirm the Always Free badge appears)
   - Availability Domain: **same AD as your VM**
   - Create.

2. On the Block Volume detail page, click **Attached Instances → Attach.**
   - Attachment type: **Paravirtualized** (simpler for Ubuntu)
   - Select your VM instance.
   - After the attachment shows "Attached," OCI displays the exact `iscsiadm` or mount commands for your volume — run them in the VM.

3. Format and mount (replace `/dev/sdb` with the device shown by `lsblk`):

```bash
lsblk   # identify the new device (e.g., /dev/sdb or /dev/vdb)

sudo mkfs.ext4 /dev/sdb
sudo mkdir -p /data
sudo mount /dev/sdb /data

# Persist across reboots — add to fstab
echo '/dev/sdb /data ext4 defaults,_netdev 0 0' | sudo tee -a /etc/fstab

sudo mkdir -p /data/backups /data/app-logs
sudo chown -R appuser:appuser /data
```

> **Skip this step** if you prefer to keep everything on the boot volume. In that case, all paths below that reference `/data` can use `~/` instead.

---

## Step 5 — Install PostgreSQL 17

```bash
# Add the official PostgreSQL Global Development Group (PGDG) apt repository
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -i -v 17

sudo systemctl enable postgresql
sudo systemctl start postgresql

# Confirm version
psql --version   # PostgreSQL 17.x
```

### Performance Tuning

Edit `/etc/postgresql/17/main/postgresql.conf` (use `sudo nano` or `sudo vim`):

```
# ── Memory ─────────────────────────────────────────────────────────────────
# A1 Flex has 24 GB RAM — be generous.
shared_buffers = 6GB           # 25% of RAM — the main Postgres shared cache
effective_cache_size = 18GB    # 75% of RAM — planner hint only, not allocated
maintenance_work_mem = 1GB     # VACUUM, CREATE INDEX, etc.
work_mem = 64MB                # Per sort/hash operation; scales with max_connections

# ── Connections ─────────────────────────────────────────────────────────────
max_connections = 50           # App uses ~5–10 connections at peak

# ── WAL / Durability ────────────────────────────────────────────────────────
wal_buffers = 64MB
checkpoint_completion_target = 0.9
min_wal_size = 512MB
max_wal_size = 2GB

# ── Logging ─────────────────────────────────────────────────────────────────
log_min_duration_statement = 1000   # Log queries slower than 1 second
log_line_prefix = '%t [%p] %u@%d '
```

### Security Hardening

Edit `/etc/postgresql/17/main/pg_hba.conf`. Remove or comment out any `host` lines that allow connections from outside `127.0.0.1`. The file should only have:

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
```

Verify `listen_addresses` in `postgresql.conf` — it should be `'localhost'` (the default). **Do not change it to `'*'`** — Postgres must not accept remote connections.

```bash
sudo systemctl restart postgresql

# Create the database user and database
sudo -u postgres psql <<'SQL'
CREATE USER household WITH PASSWORD 'choose-a-strong-password-here';
CREATE DATABASE household_finance OWNER household;
\q
SQL

# Quick connectivity test
psql -U household -d household_finance -c "SELECT 1;"
```

---

## Step 6 — Install Node.js 20 via nvm

Run as `appuser`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
source ~/.bashrc   # or open a new shell

nvm install 20
nvm use 20
nvm alias default 20

node --version   # v20.x.x
npm --version
```

---

## Step 7 — GitHub SSH Key (New Key for This VM)

Generate a **dedicated deploy key** for this server. Do not copy your local private key to the VM.

```bash
# As appuser on the VM
ssh-keygen -t ed25519 -C "household-finance-oci" -f ~/.ssh/github_deploy
# When prompted for a passphrase: press Enter for no passphrase
# (required for unattended systemd service restarts)

# Print the public key — you will paste this into GitHub
cat ~/.ssh/github_deploy.pub
```

**Add the public key to GitHub:**
1. Go to **GitHub → Settings → SSH and GPG keys → New SSH key**
2. Title: `household-finance-oci`
3. Paste the output from `cat ~/.ssh/github_deploy.pub`
4. Save

**Configure SSH on the VM to use this key for GitHub:**

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# Test the connection
ssh -T git@github.com
# Expected: "Hi <username>! You've successfully authenticated, but GitHub does
# not provide shell access."
```

---

## Step 8 — Clone, Install, Build

```bash
# Clone into home directory (or /data if you mounted the block volume)
cd ~
git clone git@github.com:<YOUR_GITHUB_USERNAME>/household-finance-app.git
cd household-finance-app

npm ci
```

---

## Step 9 — Create the .env File

```bash
cp .env.example .env
nano .env   # or vim .env
```

Set these values:

```bash
MODE=PROD
PORT=4000

# JWT secret — generate with:  openssl rand -base64 48
# Paste the full output (64 characters) as the value. No quotes needed.
JWT_SECRET=<output-of-openssl-rand-base64-48>

# Postgres — local connection, no TLS needed
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=household
DATABASE_PASSWORD=<the-password-you-chose-in-step-5>
DATABASE_NAME=household_finance
DATABASE_SSL=0

# OpenAI — for payslip PDF extraction. Leave blank to disable.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

LOG_LEVEL=info
LOG_FILE=/data/app-logs/app.log   # optional; omit to log to stdout/journald only

TRANSFER_MIN_AUTO_PAIR_SCORE=45
```

**Generate the JWT secret:**

```bash
openssl rand -base64 48
# Output example: Wk9sB3mTyXzQpL7vRn2cUeAi8jHd5fGo1KwY6MxNbV4tsCODqE+h0uIPJZ/FrlW==
# Copy the full output and paste it as the JWT_SECRET value.
```

---

## Step 10 — Build and Bootstrap the Database

```bash
# Build both backend and frontend workspaces
npm run build

# Apply all migrations + insert bootstrap seed data (first-time only — do not repeat)
npm run db:seed

# Verify the bootstrap user was created
psql -U household -d household_finance -c "SELECT email, role FROM app_user;"
# Expected: owner@example.com | owner
```

> **Security:** The bootstrap owner account uses the default password `ChangeMe123!`. Sign in and change it immediately at **Settings → Account → Change Password** before the app is reachable from the internet.

---

## Step 11 — Systemd Service

The app runs as a systemd service so it starts automatically on boot and restarts on crash.

First, find the exact Node binary path:

```bash
readlink -f $(which node)
# Example output: /home/appuser/.nvm/versions/node/v20.19.1/bin/node
```

Create the unit file as root:

```bash
sudo tee /etc/systemd/system/household-finance.service > /dev/null <<'EOF'
[Unit]
Description=Household Finance App
Documentation=https://github.com/mangatrai/household-finance-app
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=appuser
Group=appuser
WorkingDirectory=/home/appuser/household-finance-app
# Replace the ExecStart path with the output of: readlink -f $(which node)
ExecStart=/home/appuser/.nvm/versions/node/v20.19.1/bin/node backend/dist/server.js
EnvironmentFile=/home/appuser/household-finance-app/.env
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=household-finance

[Install]
WantedBy=multi-user.target
EOF
```

> **Important:** Update the `ExecStart` path with your exact Node binary path from `readlink -f $(which node)`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable household-finance
sudo systemctl start household-finance

# Check status
sudo systemctl status household-finance
# Expected: Active: active (running)

# Follow logs
sudo journalctl -u household-finance -f
```

Smoke-test the API directly:

```bash
curl -s http://127.0.0.1:4000/health
# Expected: {"status":"ok"}
```

---

## Step 12 — DuckDNS (Free Subdomain for HTTPS)

Let's Encrypt requires a valid public domain name. DuckDNS provides free `*.duckdns.org` subdomains.

1. Go to [duckdns.org](https://www.duckdns.org) and sign in with Google, GitHub, or Reddit.
2. In the "domains" section, enter a subdomain name (e.g., `myhousehold`) and click **Add Domain.**
3. In the "current ip" field, paste your OCI **Public IP Address** and click **Update IP.**
4. Your app will be reachable at `https://myhousehold.duckdns.org` after the DNS propagates (usually within a minute).

**Your DuckDNS token** is shown at the top of the page — save it for the auto-update script below.

**Optional: keep the IP current** (OCI reserved IPs are stable; only add this if your IP can change):

```bash
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh <<'EOF'
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=myhousehold&token=YOUR_TOKEN_HERE&ip=" \
  | curl -s -K - -o ~/duckdns/duck.log
EOF
chmod +x ~/duckdns/duck.sh

# Run every 5 minutes via cron
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh") | crontab -
```

Replace `myhousehold` and `YOUR_TOKEN_HERE` with your actual subdomain and DuckDNS token.

> **Using your own domain instead?** Skip DuckDNS. Add an `A` record in your DNS provider pointing your domain (e.g., `finance.yourdomain.com`) to the OCI Public IP. Then substitute your domain everywhere below in place of `myhousehold.duckdns.org`.

---

## Step 13 — nginx Reverse Proxy + Let's Encrypt HTTPS

nginx handles SSL termination and proxies requests to the Node app on port 4000. No code changes are required — the app's `trust proxy` setting (already set in `app.ts` since FIX-118) correctly handles the `X-Forwarded-For` and `X-Forwarded-Proto` headers.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create the nginx site config:

```bash
sudo tee /etc/nginx/sites-available/household-finance > /dev/null <<'EOF'
server {
    listen 80;
    server_name myhousehold.duckdns.org;   # replace with your domain

    # Allow larger uploads for payslip PDFs and import files
    client_max_body_size 25M;

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_buffering    off;
    }
}
EOF

# Enable the site (disable the default placeholder)
sudo ln -s /etc/nginx/sites-available/household-finance /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test config syntax
sudo nginx -t
# Expected: syntax is ok / test is successful

sudo systemctl reload nginx
```

Issue a TLS certificate with Certbot. Certbot will automatically edit the nginx config to add the HTTPS server block and HTTP→HTTPS redirect:

```bash
sudo certbot --nginx -d myhousehold.duckdns.org
# Follow the prompts: enter your email, agree to terms, choose "redirect HTTP to HTTPS"
```

Verify auto-renewal is active:

```bash
sudo systemctl status certbot.timer
# Expected: Active: active (waiting)

# Test renewal dry-run
sudo certbot renew --dry-run
```

**Test:** Open `https://myhousehold.duckdns.org` in a browser. You should see the app login page served over HTTPS with a valid Let's Encrypt certificate (padlock icon).

---

## Deploying Updates

```bash
# As appuser, in the repo directory
git pull
npm ci              # only needed if package-lock.json changed
npm run build
sudo systemctl restart household-finance

# Confirm the new version is running
sudo systemctl status household-finance
curl -s http://127.0.0.1:4000/health
```

---

## Postgres Backups

```bash
# Create backup directory (if using /data volume)
mkdir -p /data/backups

# Manual backup — run any time
pg_dump -U household household_finance | gzip > /data/backups/hf-$(date +%Y%m%d-%H%M).sql.gz

# Automated daily backup at 02:00
(crontab -l 2>/dev/null; echo "0 2 * * * pg_dump -U household household_finance | gzip > /data/backups/hf-\$(date +\%Y\%m\%d).sql.gz") | crontab -

# Prune backups older than 30 days
(crontab -l 2>/dev/null; echo "30 2 * * * find /data/backups -name 'hf-*.sql.gz' -mtime +30 -delete") | crontab -
```

For off-site backup, copy dumps to Google Drive using `rclone` — see `docs/HOSTING_OPTIONS_AND_HOME_LAB.md` for the recommended pattern (encrypt with GPG before uploading financial data).

**Restore from a dump:**

```bash
# Drop + recreate the database, then restore
sudo -u postgres psql -c "DROP DATABASE IF EXISTS household_finance;"
sudo -u postgres psql -c "CREATE DATABASE household_finance OWNER household;"
gunzip -c /data/backups/hf-20260421.sql.gz | psql -U household household_finance
```

---

## Firewall Summary

| Layer | Rule | Port | Source |
|---|---|---|---|
| OCI Security List | Ingress allow | 22 | Your home IP only |
| OCI Security List | Ingress allow | 80 | 0.0.0.0/0 |
| OCI Security List | Ingress allow | 443 | 0.0.0.0/0 |
| ufw | Allow | 22 | Your home IP only |
| ufw | Allow | 80/tcp | any |
| ufw | Allow | 443/tcp | any |
| nginx | Proxy to | 4000 | localhost only (not public) |
| Postgres | Listens on | 5432 | localhost only (not public) |

---

## Troubleshooting

**App won't start / systemd shows failed:**
```bash
sudo journalctl -u household-finance -n 50 --no-pager
```
Common causes: wrong Node path in `ExecStart`, missing `.env` file, Postgres not running.

**Certbot fails / ACME challenge error:**
- Ensure port 80 is open in the OCI Security List AND ufw
- Ensure the DuckDNS A record points to the correct OCI IP
- Ensure the nginx `server_name` matches the domain exactly

**Cannot connect to Postgres:**
```bash
sudo systemctl status postgresql
psql -U household -d household_finance -c "SELECT 1;"
```

**Check nginx error log:**
```bash
sudo tail -f /var/log/nginx/error.log
```

**App health check:**
```bash
curl -v http://127.0.0.1:4000/health
curl -v https://myhousehold.duckdns.org/health
```

---

## Related Docs

| Doc | Topic |
|---|---|
| [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) | Koyeb / Docker deployment options |
| [`RUNBOOK.md`](RUNBOOK.md) | Local dev setup walkthrough |
| [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) | Full `.env` reference |
| [`HOSTING_OPTIONS_AND_HOME_LAB.md`](HOSTING_OPTIONS_AND_HOME_LAB.md) | Hosting trade-offs, backup strategy |
