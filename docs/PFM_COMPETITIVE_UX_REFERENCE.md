# Reference: consumer PFM products (UX & positioning patterns)

**Purpose:** Capture what we can learn from widely used **paid / cloud** personal finance products **without** treating them as feature checklists. This app is **self-hosted, import-first, and privacy-first** — many of their capabilities (bank linking, subscription cancellation, cloud sync) are **out of scope** or **intentionally different**.

**Sources reviewed (marketing / public pages):**  
- [Quicken Simplifi](https://www.quicken.com/products/simplifi/) — product marketing, feature pillars, trust messaging, comparisons.  
- [Rocket Money](https://www.rocketmoney.com/) — hero narrative, member story, feature modules, premium framing.  
- [Mint](https://mint.intuit.com/) — transition narrative (Mint → Credit Karma); lesson on product lifecycle and user expectations.

**Related internal docs:** `docs/PROJECT_CONTEXT.md`, `docs/FINANCE_APP_PRD.md`, `docs/MVP_BACKLOG.md`, `docs/DECISIONS_LOG.md` **D-018**.

---

## 1. Quicken Simplifi (high-level)

### How they position the product
- **Forward-looking clarity:** Headlines stress *seeing ahead* — cash flow, investments, and net worth in a **connected system**, not just backward-looking registers.
- **Bundled value:** Budget/spending plan, **projected** cash flow, reports, investments, retirement, savings goals — one “bundle” story.
- **Trust & scale:** Long brand history, large institution connectivity claims, money-back guarantee, security/privacy bullets — typical for **subscription SaaS**.

### UX / IA patterns worth noting
- **Hero + proof:** Strong headline, subcopy, primary CTA, device imagery — establishes *emotion + capability* before price.
- **Scannable pillars:** Short sections (organization, alerts, insights, flexibility) — each with a **one-line benefit**.
- **Feature depth pages:** Budget vs projected cash flow vs reports — *each* maps to a user job (“know what’s left to spend”, “see future balances”).
- **Comparison tables:** Simplifi vs other apps — **not** something we need for a private deployment, but the *idea* of “what we optimize for vs spreadsheets” could inform **internal** positioning or README someday.

### Fit for *this* app
| Pattern | Adopt / adapt | Notes |
|--------|----------------|--------|
| Unified narrative (dashboard ↔ ledger ↔ import) | **Adopt** | Aligns with Epic 11 “transactions as hub” + cash summary on Home. |
| “Projected cash flow” / forecast | **Partial** | We ship **safe-to-spend** + period KPIs; full **forecast** is backlog / PRD gap — language should not over-promise. |
| Bank linking / 14k institutions | **Reject** | Conflicts with D-003 / self-hosted; our path is **files + manual entry**. |
| Investment / retirement depth | **Defer** | PRD: snapshots first; not Simplifi parity. |
| Trust strip (security, no ads) | **Adapt** | Our differentiator is **data stays on your network** — already aligned with guest landing; reinforce where users expect reassurance. |

---

## 2. Rocket Money (high-level)

### How they position the product
- **Emotional hook:** “The money app that works for *you*” — stress reduction, not spreadsheets.
- **Social proof:** Large member counts and savings claims — **credibility for a mass-market SaaS**; **not** appropriate to mimic literally for a private OSS-style app.
- **Problem pillars:** Subscriptions, everyday spending, savings automation — each section repeats the **same structure** (problem → how we help → CTA).

### UX patterns worth noting
- **Repetition for scanability:** Same hero block repeated in mobile/desktop variants — *consistency* over novelty.
- **Premium split:** “Without vs with Premium” matrix — clear **value ladder**; we have no paid tier, but **future** “basic vs power features” could use similar *clarity* (e.g. rules vs defaults), not paywalls.
- **Reviews / testimonials:** Social proof block — optional for us only if we ever ship a **public** landing; not required for LAN-only MVP.

### Fit for *this* app
| Pattern | Adopt / adapt | Notes |
|--------|----------------|--------|
| Supportive, plain-language copy | **Adopt** | Short sentences; reduce jargon on Home and empty states. |
| Subscriptions as *primary* hero | **Reject** | Our ingestion is **statements + imports**; subscription tracking is **not** core MVP. |
| “See where money goes” (spending breakdown) | **Adopt** | Maps to **cash summary**, **by-category**, **Transactions** — already directionally aligned. |
| Bill negotiation / concierge | **Reject** | Out of scope; external services. |

---

## 3. Mint → Credit Karma (lifecycle lesson)

### What the public page signals
- Mint as a **standalone brand** was **sunset**; features moved under **Credit Karma** — users were told where *reviewing transactions, monitoring spending, tracking net worth* went.

### Lesson for our product (not a feature copy)
- **Portability and continuity matter:** Users invested in **categories, history, and habits**. Our **SQLite** + export story (future: CSV export, backup) supports **ownership** of data — aligns with self-hosted values (**D-003**, **D-010**).
- **Expectation setting:** When we change IA (e.g. **Transactions** vs **Review queue**, **CR-014** / **DOC-005**), document **why** and **where** workflows moved — similar in *spirit* to Mint’s migration messaging, at doc level.

### Fit for *this* app
| Idea | Adopt | Notes |
|------|--------|--------|
| Clear migration / changelog when IA shifts | **Adopt** | **`CHANGE_HISTORY.md`**, **`CHECKPOINT.md`**, **Story 11.5**. |
| Cloud lock-in | **Reject** | We avoid single-vendor dependency for core data. |

---

## 4. Cross-cutting themes (all three)

1. **Jobs-to-be-done:** Budgeting, cash visibility, goals, and **confidence** — we address a **subset** via **correctness-first** ledger + imports, not concierge services.
2. **Density vs simplicity:** Commercial sites alternate **marketing breath** with **deep feature pages**; our app is **dense by design** (PRD §13) — inspiration is **clarity of sectioning**, not whitespace for its own sake.
3. **Trust:** Cloud PFMs stress **encryption and scale**; we stress **local control, no egress, air-gap** — different trust story, same user need for **reassurance**.
4. **Mobile-first marketing:** Simplifi and Rocket emphasize **apps**; our MVP is **web-first** for household LAN — acceptable divergence; **responsive** shell already matters.

---

## 5. Actionable considerations (backlog / copy — not all immediate work)

| Item | Type | Rationale |
|------|------|-----------|
| Guest / signed-out messaging | Copy | Align hero with **local-first trust** (complement **CR-017** landing) — mirror *clarity* of Simplifi/Rocket without cloud claims. |
| Home dashboard sectioning | UX | Optional **pillar-style** labels (Cash snapshot · This period · Drill-downs) — improves scan without new APIs. |
| “What’s next” / forecast | Product | Only if we add **projection** — until then, use **safe-to-spend** + period net, not “predicted balance 6 months out”. |
| Comparison to spreadsheets | Docs | Internal README or `PROJECT_CONTEXT` one-liner: **why imports + dedupe** vs manual sheets. |
| Subscription / bill features | Out of scope | Unless PRD expands — do not roadmap from Rocket’s hero alone. |

---

## 6. What we explicitly do *not* emulate

- Subscription billing, member counts, or **revenue-driven** feature gating.
- **Bank aggregation** as the primary onboarding path.
- Third-party **bill negotiation** or **credit** products.
- **Cloud-required** sync or identity tied to a vendor account for core workflows.

These boundaries are consistent with **`docs/PROJECT_CONTEXT.md`** and **`docs/DECISIONS_LOG.md`** **D-003**, **D-018**.

---

## 7. Revision history

| Date | Change |
|------|--------|
| 2026-03-28 | Initial document from review of public marketing pages (links above); maps patterns to Household Finance App constraints. |
