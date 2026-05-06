# Mobile UX — responsive layout + PWA backlog

**Status:** **Partially shipped** (see **`docs/CHANGE_HISTORY.md`** — UX-R01 through UX-R06 + UX-P01/P02/P03, 2026-04-25). Viewport audit, Recharts sizing, form responsive props, payslip touch affordances, **`manifest.json`**, **`index.html` PWA meta**, and **`frontend/public/icons/`** are in place.

**Remaining (not yet shipped):**
- **UX-R02** — AppShell hamburger + **drawer nav** on viewports below `md` (sidebar still desktop-weighted for some flows).
- **UX-R03** — Transactions **card-per-row** layout on phones (table still primary on small screens).
- **UX-P04** (optional) — service worker / offline shell (`vite-plugin-pwa`); defer until R02/R03 are validated.

**Origin:** Pre-production review, 2026-04-21.

---

## Problem statement (historical — largely addressed for audit/PWA baseline)

The app was built desktop-first. Remaining gaps for **primary phone use**:

- **Navigation:** drawer pattern (UX-R02) not fully equivalent to native mobile-first apps.
- **Tables:** ledger still table-heavy on narrow widths until UX-R03 lands.
- **Forms:** spot-check multi-column pages after future changes.

The goal remains: every page fully usable on a phone browser, plus installable PWA where supported.

---

## Target experience

- All 13 page components render correctly at 390px viewport width with no horizontal overflow.
- Navigation is accessible via a hamburger/drawer on screens narrower than `md` (Mantine breakpoint, ~768px).
- The transaction/ledger list collapses to a card-per-row layout on phones.
- The app can be installed from the phone browser as a standalone PWA (home screen icon, no browser chrome, no App Store).

---

## Responsive layout items

### UX-R01 — Viewport audit across all pages

Audit all 13 page components at 390px width using browser DevTools device emulation. Document which pages overflow or break. Priority pages (likely to have the most issues):

- Transactions / Ledger table
- Dashboard (charts + KPI cards)
- Import wizard (multi-step with file picker and preview table)
- Payslip detail (line items table + inline edit)
- Budget (month table with category rows)

**Definition of done:** A written list of pages with issues, with specific components called out. This list drives UX-R02 through UX-R06.

### UX-R02 — AppShell / navigation drawer on mobile

Replace or extend the current sidebar navigation so that on screens narrower than `md`:

- The sidebar collapses out of view
- A hamburger icon (`Burger` component) appears in the top bar
- Clicking the burger opens a `Drawer` with the full nav links
- The `AppShell` `navbar` and `header` props handle the responsive state via `useDisclosure`

Mantine 7 `AppShell` supports this natively with `navbar={{ breakpoint: 'md', collapsed: { mobile: !opened } }}` — use the Mantine docs pattern directly.

### UX-R03 — Ledger / transaction table → card list on mobile

The main transaction list is the highest-frequency view from a phone. On `xs`/`sm` viewports, replace the `Table` row layout with a card-per-transaction layout showing date, description, category, and amount. Implement with a `useMediaQuery('(max-width: 768px)')` conditional render or Mantine's `Table` `visibleFrom` prop to hide lower-priority columns.

Card layout suggestion per row:
```
[Category icon]  Description          Amount
                 Account · Date       Category tag
```

### UX-R04 — Recharts `ResponsiveContainer` audit

All Recharts components should already use `<ResponsiveContainer width="100%" height={N}>`. Verify this is true for every chart in `frontend/src/payslip/` and `frontend/src/pages/`. If any chart is sized with a fixed pixel width, change it to `ResponsiveContainer`. Test on a 390px viewport that charts don't overflow or render at 0px height.

### UX-R05 — Form layouts: Grid → Stack on mobile

Pages that use multi-column `Grid` layouts for form inputs (Budget month editor, Category rule editor, Household Settings) should switch to `<Stack>` or single-column `Grid` below `sm`. Use Mantine responsive props: `<Grid.Col span={{ base: 12, sm: 6 }}>` rather than a fixed `span={6}`.

### UX-R06 — Payslip detail: touch-friendly inline edit

The inline edit on the payslip detail page (line items, summary amounts) uses hover to reveal edit controls. On touch devices, hover doesn't fire reliably. Audit and ensure that:
- Edit controls are always visible on touch devices (use `@media (hover: none)` in CSS or a `isTouchDevice` utility)
- Or switch to tap-to-enter-edit-mode with a visible edit icon

---

## PWA items

### UX-P01 — Web App Manifest

Create `frontend/public/manifest.json`:

```json
{
  "name": "Household Finance",
  "short_name": "Finance",
  "description": "Self-hosted household finance tracker",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#228be6",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Adjust `theme_color` to match the app's primary color from the Mantine theme config.

### UX-P02 — index.html meta tags

Add to `frontend/index.html` `<head>`:

```html
<!-- PWA manifest -->
<link rel="manifest" href="/manifest.json" />

<!-- iOS PWA support -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Finance" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />

<!-- Android / theme -->
<meta name="theme-color" content="#228be6" />
```

### UX-P03 — App icons

Create two PNG icons and place them in `frontend/public/icons/`:
- `icon-192.png` — 192 × 192 px
- `icon-512.png` — 512 × 512 px

A simple design works fine for a private app: solid background color + initials "HF" in white, or a basic chart/wallet icon. Tools: Figma (free), Canva, or any image editor.

### UX-P04 (optional) — Offline fallback page

Add a minimal service worker that serves a static "You are offline" page when the network is unreachable. This is not required for PWA installation — `display: standalone` and the manifest are sufficient for "Add to Home Screen" on iOS and Android.

If added later, use Vite PWA plugin (`vite-plugin-pwa`) rather than a hand-rolled service worker. Defer until after UX-P01 through UX-P03 are shipped and validated.

---

## Out of scope for this backlog

- Native iOS or Android app
- App Store or TestFlight distribution
- Offline data access / background sync (IndexedDB caching of transactions)
- Push notifications

---

## Notes on iOS PWA

On iOS (Safari), PWA installation is via **Share → Add to Home Screen.** There is no automatic install prompt like Android Chrome. The `apple-mobile-web-app-*` meta tags (UX-P02) ensure the icon looks correct and the app launches without browser chrome. No Apple Developer account required for a private home-use PWA.

---

## Grooming checklist (before building)

- [ ] Complete UX-R01 audit — know exactly which pages are broken before writing code.
- [ ] Decide on the navigation pattern for UX-R02 (drawer vs bottom tab bar — drawer is simpler; bottom tabs are more native-feeling but more work).
- [ ] Confirm Mantine version supports the AppShell responsive API as described (Mantine 7.x — yes, `navbar.collapsed.mobile` is available).
- [ ] Produce icon assets (UX-P03) before shipping UX-P01/P02 — a manifest with missing icon paths degrades the PWA install experience.
- [ ] Test on a real iOS device (Safari) and Android device (Chrome) after UX-P01–P03 ship, not just DevTools emulation.
