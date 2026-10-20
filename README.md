# BloxBazaar BD

Storefront, WhatsApp order handoff, and admin panel for **BloxBazaar BD** —
built as plain HTML/CSS/JS with a compiled Tailwind CSS layer, from the
**Design PRD v1.0** plus the **Backend PRD v2.0**.

> **Two modes, one codebase.** Served by the backend (`server/`), the pages
> read the live API at `/api/v1`. Opened from `file://` — or whenever the API
> is unreachable — they fall back to the static bundle in
> `assets/js/config.js`, so the design-stage demo keeps working with no server
> (and that fallback is also the rollback: serve the folder statically).

> **Backend scope (PRD §18).** No payment processing, no customer accounts, no
> Roblox APIs, no automatic WhatsApp sending, no checkout. No customer data is
> stored server-side — the optional Roblox username stays in the visitor's
> browser and in the WhatsApp message they send. Prices, products, and dates
> remain **placeholders for review**.

> **Backend spec.** [`docs/backend-prd.md`](docs/backend-prd.md) — a
> print-friendly copy is at `docs/backend-prd.html`. The local build in
> `server/` is a self-hosted default (Express + SQLite); production runs the
> same API on managed PostgreSQL and a managed auth provider with MFA
> (PRD §4, §10) — see “Backend mode (local run)” below.

---

## Quick start

Open `index.html` directly in a browser — everything is client-side and works
from `file://`. For the best experience (and to match how it will be hosted),
serve the folder with any static server, e.g.:

```
npx serve .
```

### Tailwind CSS

Tailwind v4 is compiled to a static file — **no runtime dependency** and no
build step needed to view the site (`assets/css/tailwind.css` is committed).

```
npm install        # once
npm run build:css  # compile + minify
npm run watch:css  # rebuild on change while editing
```

- Source & tokens: `assets/css/tailwind.src.css` (`@theme` maps the PRD palette —
  `bg-canvas`, `text-ink-2`, `bg-accent`, `text-wa-ink`, …).
- Component styles live in `base.css` / `screens.css` / `admin.css`, wrapped in
  `@layer components`, so Tailwind utilities always win when you need an override.
- Add utility classes in HTML/JS and rerun `npm run build:css`.

---

## Backend mode (local run)

Requires **Node 22.5+** (the storage layer uses the built-in `node:sqlite`).

```
npm install       # express, multer, sharp
npm run seed      # first run only: creates server/data/bloxbazaar.db from config.js / guides-data.js
npm run server    # http://127.0.0.1:4173 — storefront + /api/v1 + admin
npm test          # API test suite (node:test): state rules, auth, uploads, settings
```

- **Seeded owner account** — `owner@bloxbazaar.local` / `BloxBazaar@2026`
  (from `server/seed.js`; override with `BB_SEED_ADMIN_PASSWORD` before the
  first seed). **Change it before any real use.**
- **Environment** — copy `server/.env.example` to `server/.env` to override
  port, storage paths, session lifetimes, lockout, and rate limits. Never
  commit `server/.env`.
- **Data source switch** — pages served over http(s) load from the API
  automatically; `file://` pages use the static bundle. Pin it explicitly by
  setting `window.BB_DATA_SOURCE = "static"` (or `"api"`) before
  `assets/js/api.js` loads.
- **Local data** — everything lives under `server/data/` (SQLite database +
  uploaded images), git-ignored. Delete the folder and re-run `npm run seed`
  to start clean.

---

## File map

```
index.html                  Home — hero, featured items, game guides, order flow
catalogue.html              “Marketplace” — search + category + price filters, stock badges, states
product.html                Product detail — qty or Robux amount picker,
                            WhatsApp order handoff
guide-*.html                Game guides: Robux, Blox Fruits, MM2, Rivals,
                            Steal a Brainrot (safety guides, not offers)
how-it-works.html           Full order flow + FAQ
contact.html                Contact, privacy, terms, unofficial-site notice
admin-login.html            Owner sign-in gate (password hash in config.js)
admin.html                  Admin dashboard: table, quick stock toggle,
                            add/edit drawer, demo data reset

assets/css/tailwind.src.css Tailwind source (tokens + @theme)
assets/css/tailwind.css     Compiled output (committed)
assets/css/base.css         Tokens, typography, buttons, forms, cards, utilities
assets/css/screens.css      Site chrome + customer-facing screens
assets/css/admin.css        Admin panel styles

assets/js/config.js         ⚠ Site config + placeholder catalogue data
assets/js/guides-data.js    Guide content (EN/BN)
assets/js/i18n.js           UI strings (EN/BN)
assets/js/site.js           Chrome, language control, WhatsApp links, toasts
assets/js/components.js     Shared product/guide cards
assets/js/home.js, catalogue.js, product.js, guides.js, contact.js
assets/js/admin.js, admin-login.js
assets/js/api.js            Data layer: live API with static-bundle fallback
assets/js/admin-gate.js     Pre-render session gate for admin.html

server/config.js            Environment-driven config (server/.env support)
server/db.js                SQLite schema (mirrors Backend PRD Appendix B)
server/app.js, index.js     Express app + entry point (API, gate, static files)
server/routes/public.js     Public API: bootstrap, catalogue, products, guides
server/routes/admin.js      Admin API: session, product writes, uploads, settings, audit
server/lib/*.js             Auth (scrypt + sessions), validation, serialization, images, rate limits
server/seed.js              One-time import from the static catalogue
server/test/api.test.js     API test suite (npm test)
```

## Design tokens (PRD §5)

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#F6F8F5` | Warm off-white page background |
| `--surface` | `#FFFFFF` | Cards, with fine neutral borders |
| `--text` / `--text-2` | `#212823` / `#5C675E` | Charcoal / muted gray-green |
| `--accent` | `#1F5B3F` | One deep forest-green accent |
| `--wa` | `#25D366` | WhatsApp actions only |
| Radii / shadows | 8–16px / very light | Modest rounding, restrained depth |

No gradients, neon, glow, glassmorphism, or decorative motion. Reduced-motion
settings are respected.

On top of the green accent, each game has a **soft category tint** used on
card pills, marketplace filters, guide cards, and the “Shop by game” tiles:
Robux green · Blox Fruits indigo · MM2 red · Rivals amber ·
Steal a Brainrot purple. Discount chips use a warm red tint.

## State previews (for design review)

| URL | Shows |
|---|---|
| `catalogue.html?state=loading` | Skeleton cards (persists ~3s) |
| `catalogue.html?state=empty` | Empty search state |
| `catalogue.html?state=error` | Error state with retry |
| `product.html?state=loading` / `?state=error` | Product loading / error |
| `product.html?id=bf-fruit-notifier` | Out-of-stock product (no order action) |
| `product.html?id=robux-custom` | Robux any-amount picker (10 → 100,000) |
| `product.html?id=missing` | “Not available” state |
| `admin-login.html?state=error` | Incorrect-credentials banner |
| `admin.html?drawer=add` | Add-product drawer open |
| `admin.html?drawer=edit&id=robux-1000` | Edit drawer prefilled |
| `admin.html?state=empty` | First-run empty dashboard |
| `admin.html?tab=settings` | Shop settings tab (WhatsApp number + message templates) |

Admin table demo states (identical in both modes — the backend seeds them from
`config.js`): `mm2-sweet-set` (draft), `sb-cash-pack` (needs review + draft),
`bf-leopard` (archived), `bf-fruit-notifier` (out of stock).

A slim “State preview” bar appears at the top of the page whenever a demo
state parameter is active.

## Admin panel behaviour

Served by the backend, every admin action goes through the admin API: the
server holds the session (HttpOnly cookie), rejects writes without a CSRF
token, and enforces the state rules — publishing needs an explicit approval,
only orderable items can be featured, out-of-stock items lose their order
action, records are archived rather than hard-deleted, and stale writes get a
`409` with the current version (`428` when the version is missing). From
`file://` (or a plain static host) the design-stage behaviour below applies.

- **Shop settings** — the dashboard's **Shop settings** tab edits the WhatsApp
  number and the order-message templates from the browser — no code changes.
  Placeholder tokens (`{name}`, `{price}`, `{robloxIdLine}`, …) are listed
  under each field; empty templates fall back to the built-in English/Bangla
  messages. On the backend the values are stored in the database and every
  visitor sees them on the next page view; in the static demo they are saved
  in this browser only.
- **Owner sign-in** — `admin.html` is gated: anyone without a session is sent
  to `admin-login.html`, and the dashboard stays hidden until the password
  check passes. Demo password: `BloxBazaar@2026` — change it before launch by
  generating a new SHA-256 (node one-liner in the `config.js` comment) and
  pasting it into `admin.passwordHash`.
- **Sessions** — 12 hours by default (`admin.sessionHours`). “Keep me signed in
  on this device” stores the session in `localStorage`; otherwise it lasts for
  the browser tab only. Five wrong passwords → 60-second lockout.
- **Honest limit (static mode)** — the `file://` gate is client-side only: it
  keeps the tools out of casual view, but it is **not real security**. Served
  by the backend, authentication is enforced server-side (scrypt hashes,
  HttpOnly sessions, CSRF, lockout); add MFA and a managed auth provider
  before launch (PRD §10).
- **Quick stock toggle** — click the In stock / Out of stock pill in the table to
  flip an item’s availability; the storefront reflects it immediately.
- **Saved in this browser** — the admin table saves changes to `localStorage`
  (`bb_admin_v1`; shop settings live under `bb_admin_settings_v1`), and the
  storefront + admin read them back, so stock edits survive refreshes on this
  device. **Reset demo data** in the admin top bar clears them; bump
  `dataVersion` in `config.js` after editing the catalogue so fresh data wins
  over old saved changes.
- **One device only** — this is a design-stage stand-in. Real, multi-device
  control (the owner edits from their phone, every customer sees it) needs the
  backend described in PRD §11.

## Placeholders to replace before launch

- **WhatsApp number** — set it in the admin panel (**Shop settings** tab) once
  the site runs on the backend, or in `assets/js/config.js` → `whatsappNumber`
  for the static demo (digits only, e.g. `8801XXXXXXXXX`). While empty, `wa.me`
  opens without a recipient so the pre-filled message flow can still be
  reviewed.
- **Order-message templates** — optional; also on the admin **Shop settings**
  tab. Empty = the built-in English/Bangla messages. The field hints list the
  placeholders (`{name}`, `{price}`, `{robloxIdLine}`, …).
- **Admin password** — `assets/js/config.js` → `admin.passwordHash` (SHA-256).
  Replace the demo password `BloxBazaar@2026` with the owner's own; the
  generator command is in the comment above the field.
- **Seeded backend account** — `owner@bloxbazaar.local` / `BloxBazaar@2026`
  from the first `npm run seed`. Change it before real use. Approving
  eligibility from the drawer records an automatic placeholder note — the
  owner must record the real evidence basis and review date (PRD decision
  D-1; the API accepts `note` + `review_due_at`). MFA and a managed auth
  provider remain pre-launch items (Backend PRD §10).
- **Logo** — the owner-supplied lockups live in `assets/img/website logo/`:
  `logo_primary` (header and footer), `mark_only` (admin top bar; also the
  header on screens ≤ 480 px), `logo_stacked` (admin sign-in card),
  `favicon_navy_gold` (browser tab icon). `logo_reversed` is kept for dark
  placements — the current design has none. The old `assets/img/logo.png`
  is no longer referenced.
- **Product images** — owner-supplied game artwork in
  `assets/img/products/`: category art (`robux.jpg`, `blox-fruits.jpg`,
  `mm2.jpg`, `rivals.jpg`, `steal-a-brainrot.jpg`) plus per-item Blox Fruits
  fruit icons (`bf-dragon.jpg`, `bf-kitsune.jpg`, `bf-tiger.jpg`,
  `bf-control.jpg`, `bf-yeti.jpg`, `bf-fiend.jpg`); cards fall back to a
  monogram tile for products without an image.
- **Support email / hours** — shown as `[ … to be added ]` chips.
- **Products, prices, sale prices, SKUs, dates** — realistic placeholders in
  `config.js` (informed by market rates; the owner sets the real figures).
- **Robux amount rules** — `config.js` → `robuxRules` (min `10`, max `100,000`,
  preset chips `40 … 100,000`, default `100`, and the BDT-per-Robux tiers used
  for the live estimate). The product page updates the estimate as the customer
  chooses; the admin confirms the final total in chat.
- **Bangla copy** — first-draft translations in `i18n.js` / `guides-data.js`;
  have a native speaker review before launch.
- **Official game links** — point at Roblox's discover/official pages; verify
  each URL before launch.
- **Legal text** — privacy/terms are plain-language summaries marked as
  placeholders on the page.

## Compliance notes

- The shop lists Robux packs plus an any-amount Robux picker (10–100,000),
  Blox Fruits items, MM2 knives, Rivals bundles, and Steal a Brainrot
  characters, ordered through a WhatsApp handoff — no cart, checkout, or
  payment on the site (§11).
- Out-of-stock items have no order action, so nothing can be mistaken for a
  purchase listing.
- The site never asks for passwords, one-time codes, or account access — the
  Robux payout copy mirrors that (“no password needed, just your username”).
- The product page offers an optional “Your Roblox username (ID)” field. When
  filled, it is included in the WhatsApp order message so the admin knows where
  to deliver. It is remembered in `localStorage` (`bb_rbx_id`) for repeat
  orders and sanitised to Roblox-legal characters (letters, digits, underscore).
- Server-side, no customer data is stored at all: the backend has no customer
  accounts, no order records, and no analytics — the Roblox username stays in
  the visitor's browser and in the WhatsApp message they send.
- An unofficial-site disclosure appears in the footer and on the contact page:
  independent shop, not affiliated with Roblox Corporation or any publisher.
- The WhatsApp pre-filled message tells the customer to review and tap Send —
  nothing is sent automatically. It already carries the item, the quantity (or
  Robux amount + estimated price), and the optional Roblox username, so buyers
  never have to type their order details.

## Accessibility & language

- Mobile-first layout with tablet/desktop polish; admin table collapses to
  cards on small screens.
- Semantic landmarks, skip link, visible keyboard focus, labelled icon
  buttons, meaningful alt text on placeholder tiles, status never conveyed by
  color alone.
- EN/বাংলা toggle in the header (persisted in `localStorage`); Bangla dates and
  counts render with Bangla numerals; layout tolerates longer translations.
