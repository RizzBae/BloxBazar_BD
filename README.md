# BloxBazaar BD

Storefront, WhatsApp order handoff, and admin panel for **BloxBazaar BD** —
built as plain HTML/CSS/JS with a compiled Tailwind CSS layer, from the
**Design PRD v1.0** plus the **Backend PRD v2.0**.

> **Two modes, one codebase.** Served by the backend (`server/`), the pages
> read the live API at `/api/v1`. Opened from `file://` — or whenever the API
> is unreachable — the public pages fall back to the static bundle in
> `assets/js/config.js`, so the storefront keeps working with no server
> (that fallback is also the rollback: serve the folder statically).
> The admin area is server-only and says so when the backend is absent.

> **Backend scope (PRD §18).** No payment processing, no customer accounts, no
> Roblox APIs, no automatic WhatsApp sending, no checkout. No customer data is
> stored server-side — the optional Roblox username stays in the visitor's
> browser and in the WhatsApp message they send.

> **Backend spec.** [`docs/backend-prd.md`](docs/backend-prd.md) — a
> print-friendly copy is at `docs/backend-prd.html`. The local build in
> `server/` is a self-hosted default (Express + SQLite); production runs the
> same API on managed PostgreSQL and a managed auth provider with MFA
> (PRD §4, §10) — see “Backend mode (local run)” below.

---

## Quick start

Open `index.html` directly in a browser — the storefront works from `file://`
with the bundled fallback data. For the best experience (and to match how it
will be hosted), run the backend below, or serve the folder with any static
server:

```
npx serve .
```

The admin panel (`admin.html`) needs the backend; opened anywhere else it
redirects to the sign-in screen, which explains that the server version is
required.

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

- **Seeded owner account** — first run creates `owner@bloxbazaar.local`. If
  `BB_SEED_ADMIN_PASSWORD` is not set, `npm run seed` generates a strong random
  password and prints it **once** — save it, then change it in the **Account**
  tab on `admin.html`. Set the variable before the first seed to choose your own
  password.
- **Environment** — copy `server/.env.example` to `server/.env` to override
  port, storage paths, session lifetimes, lockout, rate limits, and the seeded
  owner. Never commit `server/.env`.
- **Data source switch** — pages served over http(s) load from the API
  automatically; `file://` pages use the static bundle. Pin it explicitly by
  setting `window.BB_DATA_SOURCE = "static"` (or `"api"`) before
  `assets/js/api.js` loads.
- **Local data** — everything lives under `server/data/` (SQLite database +
  uploaded images), git-ignored. Delete the folder and re-run `npm run seed`
  to start clean.

### Admin accounts & password recovery

Admins sign in with email + password: scrypt hash, HttpOnly session cookie,
CSRF on every write, and the sign-in lockout described above. The seeded
password must be replaced before real use.

- **Add admins** — owners open **Team** on `admin.html` and create an account
  with an email, role (editor or owner), and password. The new account's
  recovery code is shown once so the admin can reset their own password later.
  Use the row actions to promote/demote, disable, or delete later. Editors
  manage products and shop settings; owners also manage accounts. Disabling
  signs the admin out immediately and blocks sign-in until reactivated;
  deleting ends every session and cannot be undone. The last active owner
  cannot be demoted, disabled, or deleted, and nobody can change the account
  they are signed in with.
- **Your own login** — the **Account** tab on `admin.html` updates the
  signed-in admin's email and/or password (owners and editors alike). The
  current password is required; a password change signs out every other
  session but keeps this one active.

**Forgot the password?** Each admin has a **recovery code**, created in the
**Account** tab → **Recovery code** (only its SHA-256 is stored; the code is
shown once). Open `admin-login.html` → **Forgot password?**, enter the email,
recovery code, and a new password. On success the server revokes every session
and returns a fresh recovery code — shown once on the page. The old code stops
working immediately, so the reset is single-use.

No email or SMTP is involved. If the recovery code is also lost, use the
server-host fallback:

```
npm run admin:reset                                   # primary owner
npm run admin:reset -- --email other@example.com      # a specific admin
npm run admin:reset -- --password "your new password" # choose the password
```

The CLI sets a new password, signs the account out everywhere, and prints a fresh
recovery code once. Without `--password`, it also prints a temporary password.
The admin area is server-only: opened without the backend, `admin.html` and the
recovery page explain that the server version is required — there is no
client-side password check.

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
admin-login.html            Admin sign-in gate (email + password)
admin-forgot.html           Password recovery with a recovery code
admin.html                  Admin dashboard: products, shop settings,
                            account/recovery code, owner-only team management

assets/css/tailwind.src.css Tailwind source (tokens + @theme)
assets/css/tailwind.css     Compiled output (committed)
assets/css/base.css         Tokens, typography, buttons, forms, cards, utilities
assets/css/screens.css      Site chrome + customer-facing screens
assets/css/admin.css        Admin panel styles

assets/js/config.js         Bundled storefront fallback (catalogue + settings
                            used when the API is unreachable)
assets/js/guides-data.js    Guide content (EN/BN)
assets/js/i18n.js           UI strings (EN/BN)
assets/js/site.js           Chrome, language control, WhatsApp links, toasts
assets/js/components.js     Shared product/guide cards
assets/js/home.js, catalogue.js, product.js, guides.js, contact.js
assets/js/admin.js, admin-login.js, admin-forgot.js
assets/js/api.js            Data layer: live API with static-bundle fallback
assets/js/admin-gate.js     Hides admin.html until the session check passes

server/config.js            Environment-driven config (server/.env support)
server/db.js                SQLite schema (mirrors Backend PRD Appendix B)
server/app.js, index.js     Express app + entry point (API, gate, static files)
server/routes/public.js     Public API: bootstrap, catalogue, products, guides
server/routes/admin.js      Admin API: session/auth, admin accounts, product writes, uploads, settings, audit
server/lib/*.js             Auth (scrypt + sessions + recovery codes), validation, images, rate limits
server/seed.js              One-time import from the static catalogue
server/admin-reset.js       CLI admin password reset (npm run admin:reset)
server/test/api.test.js     API test suite (npm test)
```

## Design tokens (PRD §5)

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#F7F1E4` | Warm cream page background (from the logo's cream) |
| `--surface` | `#FFFFFF` | Cards, with fine warm-neutral borders |
| `--text` / `--text-2` | `#25211A` / `#5F5748` | Warm charcoal / muted warm gray |
| `--accent` | `#1E3A78` | Logo navy — headings, links, primary buttons, focus |
| `--gold` / `--gold-strong` | `#D9A93F` / `#8A6417` | Logo gold — eyebrows, step markers, active-nav underline, main CTA |
| `--ok` | `#1F5B3F` | In-stock / availability only |
| `--wa` | `#25D366` | WhatsApp actions only |
| Radii / shadows | 8–16px / very light | Modest rounding, restrained depth |

No gradients, neon, glow, glassmorphism, or decorative motion. Reduced-motion
settings are respected.

On top of the navy accent, each game has a **soft category tint** used on
card pills, marketplace filters, guide cards, and the “Shop by game” tiles:
Robux green · Blox Fruits indigo · MM2 red · Rivals amber ·
Steal a Brainrot purple. Discount chips use a warm red tint.

## Seeded catalogue states

The first `npm run seed` imports the catalogue including one item per admin
state, which makes the dashboard filters and guards easy to check:
`mm2-sweet-set` (draft), `sb-cash-pack` (needs review + draft), `bf-leopard`
(archived), `bf-fruit-notifier` (out of stock).

## Admin panel behaviour

Every admin action goes through the admin API: the server holds the session
(HttpOnly cookie), rejects writes without a CSRF token, and enforces the state
rules — publishing needs an explicit approval, only orderable items can be
featured, out-of-stock items lose their order action, records are archived
rather than hard-deleted, and stale writes get a `409` with the current version
(`428` when the version is missing).

- **Shop settings** — the dashboard's **Shop settings** tab edits the WhatsApp
  number and the order-message templates — no code changes. Placeholder tokens
  (`{name}`, `{price}`, `{robloxIdLine}`, …) are listed under each field; empty
  templates fall back to the built-in English/Bangla messages. The **Account**
  tab holds the signed-in admin's own email/password and recovery code.
- **Admin sign-in** — `admin.html` is gated server-side: without a session the
  server redirects to `admin-login.html`, and the dashboard stays hidden until
  the password check passes. **Forgot password?** uses the recovery code, and
  the owner-only **Team** tab adds, edits, and removes admins — see
  [Admin accounts & password recovery](#admin-accounts--password-recovery).
- **Sessions** — 12 idle hours by default (`BB_SESSION_IDLE_HOURS`); "keep me
  signed in on this device" extends the session (`BB_SESSION_REMEMBER_DAYS`).
  Wrong passwords trigger an escalating lockout (5 per account, 10 per IP, per
  15 minutes by default).
- **Quick stock toggle** — click the In stock / Out of stock pill in the table
  to flip an item's availability; the storefront reflects it on the next view.
- **Audit trail** — every write records who changed what; owners can read it
  through `GET /api/v1/admin/audit`.

## Owner settings to confirm before launch

- **WhatsApp number** — set it in the admin panel (**Shop settings** tab)
  (digits only, e.g. `8801XXXXXXXXX`). While empty, `wa.me` opens without a
  recipient so the pre-filled message flow can still be used.
- **Order-message templates** — optional; also on the admin **Shop settings**
  tab. Empty = the built-in English/Bangla messages. The field hints list the
  placeholders (`{name}`, `{price}`, `{robloxIdLine}`, …).
- **Seeded account** — `owner@bloxbazaar.local` from the first
  `npm run seed` (password from `BB_SEED_ADMIN_PASSWORD`, or generated and
  printed once). Change it in the **Account** tab on `admin.html`; the offline
  fallback is `npm run admin:reset`. Approving eligibility records an automatic
  note — the owner must record the real evidence basis and review date (PRD
  decision D-1; the API accepts `note` + `review_due_at`). MFA and a managed
  auth provider remain pre-launch items (Backend PRD §10).
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
- **Support email / hours** — set them in the admin **Shop settings** tab; the
  contact page cards stay hidden until a value is present. Hours accept EN and
  Bangla text.
- **Products, prices, sale prices, SKUs, dates** — starting values in
  `config.js` and the seed (informed by market rates); the owner confirms every
  figure in the admin panel.
- **Robux amount rules** — `config.js` → `robuxRules` (min `10`, max `100,000`,
  preset chips `40 … 100,000`, default `100`, and the BDT-per-Robux tiers used
  for the live estimate). The product page updates the estimate as the customer
  chooses; the admin confirms the final total in chat.
- **Bangla copy** — first-draft translations in `i18n.js` / `guides-data.js`;
  have a native speaker review before launch.
- **Official game links** — point at Roblox's discover/official pages; verify
  each URL before launch.
- **Legal text** — privacy/terms are plain-language summaries; have them
  reviewed before launch.

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
  buttons, meaningful alt text on monogram fallback tiles, status never
  conveyed by color alone.
- EN/বাংলা toggle in the header (persisted in `localStorage`); Bangla dates and
  counts render with Bangla numerals; layout tolerates longer translations.
