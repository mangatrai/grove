# Hosting options, $0 opex, and home lab (context doc)

**Purpose:** Preserve product and ops context from discussions about **where** this app can run, **free-tier** cloud tradeoffs, **home** hardware, and **backup** strategy—without binding the repo to a single vendor.

**Audience:** Maintainer / self-hoster. Not end-user documentation.

---

## Constraints we care about

| Constraint | Notes |
|------------|--------|
| **Opex** | **$0/month** recurring (no paid VPS/DB if avoidable). |
| **Capex** | Willing to buy **home lab** gear **once**; target **≤ ~$100 USD**, less is better. |
| **Preference** | **Home-first** when practical; **cloud or hybrid** acceptable if hardware isn’t ready. |
| **Future** | Room to run **several** similar apps (not just this stack)—RAM and disk matter more than raw CPU. |

---

## This app’s runtime (reminder)

- **Backend:** Node 20, Express, **Postgres** (see [`CLAUDE.md`](../CLAUDE.md), [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md)).
- **Frontend:** Static SPA; can be served by the same Node process in **`MODE=PROD`**.
- **Persistence:** Financial data lives in **Postgres**—backups are **non-negotiable** wherever it runs.

---

## Raspberry Pi (e.g. Pi 3B) and “fragility”

- **Risk:** Using only a **consumer SD card** as the sole store for Postgres data is fragile (wear, corruption, sudden death).
- **Mitigations (no extra opex):**
  - Put **database files** on **USB storage** (SSD preferred over spinning rust for latency; HDD acceptable for light use).
  - Keep **boot** on SD if needed, but **data** on external volume.
  - **Automated backups** off the Pi (second disk, cloud object storage, or both).
- **Pi 3B specifically:** Typically **~1 GB RAM**. **Docker + Postgres + Node** can work for **light** single-app use; **multiple** full stacks will be **tight**—expect swapping or OOM if overcommitted. Upgrading hardware (used SFF PC or newer Pi) buys headroom for “3–4 similar apps.”
- **Docker on Pi:** Feasible (Docker CE / Pi OS). Bind-mount Postgres data to the **external mount**.

**Note:** **ESP32-class devices** are **not** appropriate for this stack (microcontroller-scale RAM; no practical Node/Postgres). **Used office SFF / thin clients** (HP EliteDesk, Dell OptiPlex Micro, Lenovo Tiny, some Dell Wyse units—verify CPU/RAM) are the usual **homelab** upgrade path when budget allows.

---

## Cloud “free” options (high level)

Figures and rules **change**—always confirm on the provider’s site before relying on them.

### Koyeb

- This repo already documents **build/run** for Koyeb in [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).
- **Managed Postgres (free tier):** Typically **small** instance, **~5 active compute hours/month** on the free DB SKU, **~1 GB** storage, **sleep** after idle—fine for **experimentation** or **occasional** use; **not** a substitute for a **continuously** used production DB without watching quotas or paying.
- **Free web service:** Separate small instance; combine with DB limits when estimating “always on.”

**Docs:** [Koyeb Databases](https://www.koyeb.com/docs/databases), [Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing).

### Oracle Cloud (OCI) Always Free ← current recommended self-hosted path

- **Ampere A1** Arm VMs: aggregate **4 OCPU / 24 GB RAM** in the free allowance (allocate all to one VM) plus **2 × 200 GB block volumes** — enough for Postgres + Node + nginx on a single machine with room to spare.
- **Preferred deployment:** One A1 Flex VM running Ubuntu 22.04, Postgres 17 installed directly (no Docker), Node 20 via nvm, nginx as HTTPS reverse proxy, Let’s Encrypt (DuckDNS for free subdomain).
- **Tradeoffs:** Account/signup friction; **capacity** in some regions can be scarce at creation time; **you** own backups, OS patching, and firewall rules.

**Step-by-step guide:** [`docs/OCI_DEPLOYMENT.md`](OCI_DEPLOYMENT.md) — VM creation, Security Lists, ufw, Postgres tuning, GitHub SSH key, systemd service, DuckDNS, nginx + Certbot HTTPS.

**Docs:** [OCI Always Free resources](https://docs.public.content.oci.oraclecloud.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

### AWS (and similar hyperscalers)

- **Legacy** accounts may have had **12‑month**-style free usage patterns; **newer** accounts often get **credits** and **time-limited** exploration rather than “forever free” managed RDS.
- **RDS managed Postgres** is usually **not** long-term free; **EC2 + Postgres in Docker** avoids RDS fees but still has **EBS + egress** to watch.
- Treat AWS as **“credits then pay-as-you-go”** unless your account’s **exact** free tier terms say otherwise.

**Docs:** [AWS Free Tier](https://aws.amazon.com/free/), [RDS pricing / free tier](https://aws.amazon.com/rds/free/).

### Other managed Postgres (hobby)

- Vendors like **Neon**, **Supabase**, **Aiven**, etc., offer **free tiers** with varying limits (storage, branches, sleep, connections). Useful for **splitting** app host vs DB host; read current terms.

---

## Capex ≤ ~$100: practical priorities

| Priority | Why |
|----------|-----|
| **Used x86 SFF / mini PC** (when available at this price) | More **RAM** and **easier** multi-container setups than Pi 3B. |
| **SSD + USB enclosure** (or SATA SSD in a small PC) | Better **I/O** and longevity than SD-only for Postgres **data**. |
| **UPS or at least stable power** (if feasible) | Reduces unclean shutdown corruption risk on single-node setups. |

**New** Raspberry Pi boards + accessories often **exceed** $100 all-in; **used** corporate **small form factor** desktops are often the better **$/capability** for a multi-app homelab.

---

## Backup strategy (recommended pattern for home / $0 opex)

Discussed approach—**implement with scripts** on the server; not shipped in-repo unless added later.

1. **Schedule** (cron or systemd timer): `pg_dump` (often **custom format** `-Fc` for flexible restore).
2. **Compress** (`gzip` / `zstd`).
3. **Encrypt** before any **cloud** copy (e.g. **GPG** symmetric or **age**)—financial dumps are sensitive.
4. **Local copy:** e.g. **external HDD** mounted on the Pi (`/mnt/.../backups/`).
5. **Off-site copy:** e.g. **Google Drive** via **rclone** (respect quota and API limits).
6. **Retention:** e.g. **7 daily** files; optional **one monthly** kept longer.
7. **Prune** old files after successful upload (script carefully; test with dry-runs).
8. **Restore drills:** periodically restore to a **throwaway** DB to prove backups work.

**Why two destinations:** Protects against **disk death** (local) and **site loss** (off-site). Cloud accounts can be locked or quota-exceeded—**encryption** keeps ciphertext usable if you control keys.

---

## Network exposure (home)

- Prefer **Tailscale**, **WireGuard**, or similar for **remote access** instead of exposing **Postgres** or admin ports to the open internet.
- If exposing **HTTPS** only, use a **reverse proxy**, keep **TLS** current, and **fail2ban**/rate limits as appropriate.

---

## Hybrid at $0 opex

- **Example:** App and DB on **OCI Always Free** VM, **or** DB at home and backups to **Drive**—still **$0** if you stay within provider free limits and **don’t** pay for egress-heavy abuse.
- **Example:** Home Pi runs prod; **OCI** or **Drive** holds only **encrypted** dumps (backup target, not live replica)—minimal monthly cost if free tiers cover it.

---

## Related docs in this repo

| Doc | Topic |
|-----|--------|
| [`OCI_DEPLOYMENT.md`](OCI_DEPLOYMENT.md) | **OCI Always Free** step-by-step: VM, Postgres, Node, nginx, HTTPS |
| [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) | Deploy notes, **Koyeb** build/run overrides, health checks |
| [`RUNBOOK.md`](RUNBOOK.md) | Local/prod setup walkthrough |
| [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) | `MODE`, `DATABASE_*`, etc. |

---

## Changelog

| Date | Note |
|------|------|
| 2026-04-21 | **DOC-020**: Expanded OCI section — marked as preferred self-hosted path, linked new `OCI_DEPLOYMENT.md` step-by-step guide, added to Related docs table. |
| 2026-04-11 | Initial write (**DOC-068**): $0 opex, Pi vs cloud free tiers, backup pattern, capex ≤ ~$100 hardware notes. |
