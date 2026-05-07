# Email Infrastructure — Decision Record

**Status:** Implemented (CR-095b)  
**Decided:** 2026-04-17  
**Implements:** CR-095b (password reset), and shared foundation for CR-095a (invites), staff provisioning (§20), timesheet notifications, budget alerts (CR-102)

---

## Why email is needed

Email is required by multiple features across the roadmap — not just password reset. Treating it as shared infrastructure from the start avoids retrofitting later.

| Feature | When | Required for |
|---|---|---|
| **Self-service password reset (CR-095b)** | Medium term | Forgot password flow on login page |
| **Household invite / sign-up (CR-095a)** | Medium term | Owner invites member by email |
| **Staff provisioning (PRD §20)** | Phase 3 | Temp password email when creating a staff login |
| **Timesheet notifications** | Phase 3 | Remind staff to clock in / submit timesheets; notify admin of pending approvals |
| **Budget alerts (CR-102)** | Phase 3 | Notify user when category spend crosses threshold |
| **Weekly/monthly digest** | Phase 4 | Optional household summary email |

At current scale: **10–20 emails/month**. Design for up to ~500/month once all Phase 3 features ship.

---

## Provider options considered

| Provider | Free tier | Notes |
|---|---|---|
| **Gmail App Password** | 500/day | `smtp.gmail.com:587` + TLS. Zero new accounts — use existing Google account. App Password generated in Google Account → Security → 2-Step Verification → App passwords. Deliverability: good for personal/household use. Downside: tied to personal Google account; if sender changes, credentials rotate manually. |
| **Resend** | 3,000/month, 100/day | Purpose-built transactional email. Best deliverability at this tier. Clean API. Free, no credit card. Recommended for production. Supports standard SMTP relay (same nodemailer setup) + direct REST API. |
| **Brevo (Sendinblue)** | 300/day, 9,000/month | Generous free tier. More setup overhead than Resend. Viable fallback. |
| **SendGrid** | 100/day | Industry standard. More complex for no benefit at this scale. |
| **AWS SES** | $0.10/1,000 after free tier | Cheapest at scale. Requires AWS account + domain verification + sandbox exit approval. Overkill until volume grows. |

---

## Decision: SMTP abstraction + provider-agnostic env vars

**Chosen approach:** Use **nodemailer** with standard SMTP configuration. The app treats email as a configured transport — no vendor SDK in the codebase. Provider is swapped by changing env vars, no code change required.

**Recommended providers in priority order:**

1. **Resend** (recommended for production) — free, purpose-built, best deliverability, `smtp.resend.com:465` or REST. Create a free account at resend.com, add `SMTP_USER=resend`, `SMTP_PASS=<api-key>`.
2. **Gmail App Password** (easiest to start) — no new account, works immediately. Requires Google account with 2FA → App Password. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<your-gmail>`, `SMTP_PASS=<app-password>`, `SMTP_FROM=<your-gmail>`.

Both work with the same nodemailer SMTP transport — zero code difference between providers.

---

## Environment variables (to be added when CR-095b is implemented)

```bash
# Email / SMTP (required for password reset, invites, notifications)
SMTP_HOST=smtp.gmail.com          # or smtp.resend.com
SMTP_PORT=587                     # 587 (STARTTLS) or 465 (SSL)
SMTP_SECURE=0                     # 1 for port 465 (SSL), 0 for 587 (STARTTLS)
SMTP_USER=you@gmail.com           # Gmail: your address. Resend: literal "resend"
SMTP_PASS=your-app-password       # Gmail App Password or Resend API key
SMTP_FROM=Household Finance <you@gmail.com>   # Display name + address for From header
```

All six vars are optional until the first email-sending feature ships. If any are absent at startup, email features degrade gracefully (admin-reset flow remains available as fallback; email-dependent routes return a clear error rather than crashing).

---

## Implementation shape (for CR-095b)

### New module: `backend/src/modules/mailer/`

```
mailer/
  mailer.service.ts     — nodemailer transport, sendMail() wrapper, graceful no-op when SMTP not configured
  mailer.types.ts       — MailPayload type { to, subject, text, html }
  templates/
    password-reset.ts   — subject + text + HTML for reset email
```

`sendMail()` returns `{ ok: true }` or `{ ok: false, reason }`. Callers never throw on email failure — the DB-side operation (token write) succeeds first; the email is best-effort.

### New DB table: `password_reset_token`

```sql
CREATE TABLE password_reset_token (
  id          TEXT PRIMARY KEY,            -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,               -- SHA-256 of the raw token (raw token only sent via email, never stored)
  expires_at  TIMESTAMPTZ NOT NULL,        -- NOW() + 1 hour
  used_at     TIMESTAMPTZ,                 -- set when consumed; token invalid after use
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_prt_user ON password_reset_token (user_id);
```

One active token per user — creating a new one invalidates all prior tokens for that user (`DELETE WHERE user_id = ? AND used_at IS NULL`).

### New API routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/forgot-password` | None | Body: `{ email }`. Always returns `200` (no user enumeration). If email found + SMTP configured: generates token, sends email. |
| `POST` | `/auth/reset-password` | None | Body: `{ token, newPassword }`. Validates token (exists, unexpired, unused). Sets new password hash, marks token used, bumps `token_version`. |

### Frontend changes

- **Login page** — "Forgot password?" toggles to a small form: email input + "Send reset link" button. On success: "If that email is registered, a reset link is on its way." (same message regardless of whether email exists — no enumeration).
- **New page `/reset-password?token=...`** — reached from the email link. Shows new password + confirm fields. On success: redirects to login with a "Password updated, please sign in" message.
- **Fallback** — if SMTP is not configured (`SMTP_HOST` absent), the login page keeps the current "Ask your admin to reset from Settings → Members" tip instead of showing the email form. No broken UI.

### Security notes

- Raw token is URL-safe random bytes (32 bytes → base64url, 43 chars). Only the SHA-256 hash is stored.
- Token expires in 1 hour.
- Token is single-use — consumed on first `POST /auth/reset-password`.
- New token creation invalidates all prior tokens for the same user.
- `POST /auth/forgot-password` is rate-limited (3 requests per 15 min per IP, same pattern as login).
- Response is always `200` regardless of whether email exists.

---

## What stays as-is

The existing **admin-reset flow** (Settings → Members → Reset Password) remains and is not replaced — it is the correct path when an owner forgets their own password (no email required; operator accesses the DB or has another admin account). Email reset is additive, not a replacement.

---

## Related

- `docs/CHANGE_HISTORY.md` — CR-095b backlog entry
- `docs/ENVIRONMENT_VARIABLES.md` — will be updated when CR-095b is implemented
- `docs/archive/FINANCE_APP_PRD.md` — §17 Future Phases (notifications), §20 Staff (email provisioning)
- `docs/USER_GUIDE.md` — admin reset flow documented under Settings → Members
