# BloxBazaar BD — Technical Overview (AI handoff)

> What this file is: a complete, factual description of the project as it
> exists today — stack, structure, routes, auth, data model, database, and
> operating rules. Written to be handed to another AI agent or developer
> without extra context.

---

## 1. What the project is

**BloxBazaar BD** is a Bangladesh-first Roblox marketplace + support website.
Visitors browse products (Robux packs, Blox Fruits items, MM2 knives, Rivals
bundles, Steal a Brainrot characters), then **order via a WhatsApp handoff**
(`wa.me` link with a pre-filled message). There is **no checkout, no payment
processing, no customer accounts, and no Roblox API integration** — by design
(scoped by the Backend PRD v2.0, `docs/backend-prd.md`).

The site is fully bilingual: **English (`en`) and Bangla (`bn`)** with a
runtime language switch.

Two operating modes, both first-class:

| Mode | When | Data |
|---|---|---|
| **Static bundle** | `file://`, or any plain static host with no API | `assets/js/config.js` + `assets/js/guides-data.js`; admin edits saved in browser `localStorage` |
| **Backend (API)** | Served by `server/` (Express + SQLite) | Real API at `/api/v1`; admin edits persisted server-side |

`assets/js/api.js` auto-detects: `file://` → static; HTTP → API, with silent
fallback to the static bundle if the API is unreachable. The design demo must
**always** keep working on a plain static host.

Not a git repository (no version-control history).

---

## 2. Tech stack

### Frontend
- **HTML5 + CSS + vanilla JavaScript** — no framework, no bundler, no build
  step for JS. Scripts attach to a custom `bb:ready` event fired once data is
  loaded.
- **Tailwind CSS v4** (CLI, `@tailwindcss/cli` + `tailwindcss` dev deps):
  prebuilt `assets/css/tailwind.css` from `tailwind.src.css`; utility classes
  only. Build with `npm run build:css` when editing the source.
- **Hand-written CSS in cascade layers**: `assets/css/base.css` (design
  tokens, reset, buttons, cards, badges, notices, states), `assets/css/screens.css`
  (header/footer chrome, hero, product cards, marketplace, guides, contact),
  `assets/css/admin.css` (sign-in + admin dashboard). House style: one deep
  forest-green accent (`#1F5B3F`), no gradients / neon / glassmorphism,
  `prefers-reduced-motion` respected.
- **Fonts**: Google Fonts — Inter + Noto Sans Bengali.
- **i18n**: dictionary in `assets/js/i18n.js`, `data-i18n` attributes,
  `bb:langchange` event, `localStorage["bb_lang"]`.
- **WhatsApp handoff**: order links are built in `site.js`
  (`productWaLink` / `robuxWaLink` → `wa.me` with a pre-filled message). The
  owner can override the message per product type from the admin **Shop
  settings** tab (placeholders `{brand} {name} {sku} {qty} {amount} {price}
  {robloxId} {robloxIdLine} {url}`); empty templates fall back to the
  localized `wa.order` / `wa.orderRobux` strings.
- **Privacy**: the visitor's Roblox username never leaves the browser — it is
  only included in the WhatsApp message the visitor sends.

### Backend (local / self-hosted build)
- **Node.js ≥ 22.5** (developed on v24.18.0), **CommonJS**, `"use strict"`.
- **Express 5** (`express@^5.3.0`), **multer 2** (`^2.4.0`, memory storage,
  2 MB limit), **sharp** (`^0.35.5`, image validation + re-encode).
- **SQLite via the built-in `node:sqlite` module** (`DatabaseSync`) — zero
  external DB dependencies, WAL mode. File: `server/data/bloxbazaar.db`.
- No ORM — raw prepared statements, hand-written DDL.
- Server-side sessions, scrypt password hashing, CSRF, in-memory rate
  limiting / lockout (process-local, documented as such).
- **RFC 9457 `application/problem+json`** error responses everywhere.
- Tests with the built-in **`node:test`** runner.

### Documented production targets (NOT implemented in the local build)
Per the Backend PRD §4/§10: managed **PostgreSQL** (same schema shape as the
SQLite DDL), S3-compatible **object storage** for uploads, a managed **auth
provider with MFA**, and a CDN in front. The schema is deliberately 1:1 with
the PRD's Appendix B so the swap is mechanical.

---

## 3. Directory structure

```
BloxBazaar BD/
├── index.html                  Home: hero, featured, shop-by-game, guides teaser
├── catalogue.html              "Marketplace" page (URL kept for link stability):
│                               search, category + price filters, states
├── product.html                Product detail (?id=…): qty/Robux picker,
│                               WhatsApp order handoff
├── how-it-works.html           Order flow + FAQ
├── contact.html                Contact, privacy, terms, unofficial-site notice
├── guide-*.html ×5             Game guides (Robux, Blox Fruits, MM2, Rivals,
│                               Steal a Brainrot)
├── admin.html                  Admin dashboard (server-gated; table, drawer,
│                               stock toggles, settings, guides)
├── admin-login.html            Owner sign-in gate
│
├── assets/
│   ├── css/
│   │   ├── tailwind.css        Prebuilt Tailwind v4 output (committed)
│   │   ├── tailwind.src.css    Tailwind source (build with npm run build:css)
│   │   ├── base.css            Tokens + primitives
│   │   ├── screens.css         Storefront screens
│   │   └── admin.css           Admin screens
│   ├── img/
│   │   ├── website logo/       Brand SVG set (see §11)
│   │   ├── products/           Product/category artwork (jpg)
│   │   └── logo.png            OLD logo — kept on disk, no longer referenced
│   └── js/
│       ├── config.js           window.BB_DATA: static data bundle (29 products,
│       │                       5 categories, robuxRules, brand, whatsappNumber
│       │                       + whatsappTemplates, admin.passwordHash [static
│       │                       gate], localStorage admin overrides)
│       ├── guides-data.js      window.BB_GUIDES: guide content
│       ├── i18n.js             EN/BN dictionary + helpers
│       ├── site.js             Chrome (header/footer render), lang control,
│       │                       static admin-session helpers, boot flow
│       ├── api.js              window.BB_API: data layer (public + admin
│       │                       fetch wrappers, CSRF header, static fallback)
│       ├── components.js       Shared render helpers (cards etc.)
│       ├── home.js             / catalogue.js / product.js / guides.js /
│       │                       contact.js  — page controllers (render on bb:ready)
│       ├── admin-gate.js       Early redirect gate for admin.html
│       ├── admin-login.js      Sign-in (API mode + static demo)
│       └── admin.js            Dashboard controller (API mode + static
│                               localStorage mode key "bb_admin_v1")
│
├── server/                     Local backend (optional — the site works without)
│   ├── index.js                Entry: open DB → seed if empty → listen
│   ├── app.js                  Express app: security headers, routes, gates
│   ├── config.js               Env-driven config (+ server/.env loader)
│   ├── .env.example            Documented env vars
│   ├── db.js                   SQLite open + full schema DDL
│   ├── seed.js                 One-time import from config.js/guides-data.js
│   ├── routes/
│   │   ├── public.js           Read-only public API
│   │   └── admin.js            Authenticated admin API
│   ├── lib/
│   │   ├── auth.js             scrypt, sessions, CSRF, role middleware
│   │   ├── validate.js         Field-level validation for all writes
│   │   ├── serialize.js        Row → JSON (public vs admin shapes)
│   │   ├── images.js           Upload processing (sharp)
│   │   ├── ratelimit.js        Sliding-window limiter + escalating lockout
│   │   └── problem.js          problem+json helpers
│   ├── data/                   bloxbazaar.db (+ WAL/SHM), uploads/
│   └── test/api.test.js        17 API tests (node --test)
│
├── docs/
│   ├── backend-prd.md          Backend PRD v2.0 (the governing spec)
│   ├── backend-prd.html        Rendered version of the same
│   └── project-overview.md     This document
│
├── package.json                Scripts: server/start/seed/test/build:css/watch:css
└── README.md                   Owner-facing docs: run modes, file map, notes
```

---

## 4. HTTP routes

### 4.1 Storefront + infra (served by Express in backend mode)

| Method | Path | What |
|---|---|---|
| GET | `/` | Home page (static files from the project root) |
| GET | `/catalogue.html` | The "Marketplace" page (name changed in UI; URL unchanged) |
| GET | `/product.html?id=…` | Product detail |
| GET | `/guide-*.html`, `/how-it-works.html`, `/contact.html` | Static pages |
| GET | `/admin-login.html` | Sign-in page |
| GET | `/admin.html` | **Server-gated**: without a session → `302` to `/admin-login.html?next=…` |
| GET | `/healthz` | `{ "status": "ok", "version": "1.0.0" }` |
| GET | `/uploads/*` | Uploaded images — immutable, `Cache-Control` 1 year |
| — | `/server/*`, `/node_modules/*`, `/.git/*`, `/.env`, `/package.json`, `/package-lock.json`, `/.gitignore` | **Blocked** (404) |
| — | `/assets/*` | Served with `Cache-Control: no-cache` (revalidate so edits show) |

### 4.2 Public API — `/api/v1` (no auth; read-only)

Only ever returns products where **publication = `published` AND eligibility =
`approved`**. All responses carry a weak ETag `W/"dv<N>"` seeded from
`shop_settings.data_version` and answer `304` on `If-None-Match`
(`Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`).
Rate limit: **120 req/min per IP** (env-tunable).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/bootstrap` | `{ brand, dataVersion, defaultLocale, whatsappNumber, whatsappTemplates{product,robux}, supportEmail, supportHours, robuxRules, categories[] }` |
| GET | `/api/v1/catalogue` | Query: `category`, `q` (≥2 chars), `min_price`, `max_price`, `featured=1`, `available=1`, `page`, `limit` (≤60, default 24). Returns `{ page, limit, total, dataVersion, items[] }`. Search matches `name.en`, `name.bn`, `sku`. |
| GET | `/api/v1/products/:id` | Single product; 404 unless published + approved |
| GET | `/api/v1/guides` | `{ dataVersion, items[] }` (published only) |
| GET | `/api/v1/guides/:id` | Single guide |

**Public product JSON shape** (mirrors the static `config.js` fields 1:1):
`id, sku, name{en,bn}, short, description, includes[], category, price,
priceFrom, listPrice, robuxAmount, tag, stock("in"|"out"), publication,
eligibility, featured, tone, monogram, image, updated`.
(`publication:"published"`/`eligibility:"approved"` are harmless constants for
front-end compatibility.)

### 4.3 Admin API — `/api/v1/admin`

Session cookie required for everything except `POST /session`. All **writes**
require the CSRF header `x-csrf-token` (value = `bb_csrf` cookie) and pass an
origin/host check. Rate limits: reads **240/min**, writes **60/min**, uploads
**20/hour** (per admin or IP).

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/admin/session` | `{ email, password, remember? }` → sets `bb_sess` (HttpOnly) + `bb_csrf` cookies. `401` wrong creds; `429` + `Retry-After` when locked out. |
| GET | `/api/v1/admin/session` | `{ admin: { id, email, role, mfaEnrolled } }` |
| DELETE | `/api/v1/admin/session` | `204`; clears cookies (CSRF required) |
| GET | `/api/v1/admin/products` | `?state=all\|in\|out\|review\|draft\|archived&q&page&limit`. Returns **admin shape** (internals included). |
| POST | `/api/v1/admin/products` | Create. Safe defaults always: `draft` + `review` + `out`. `id`/`sku` auto-generated when absent (`BB-<CAT>-<price>` SKUs). `201` + admin shape. |
| PATCH | `/api/v1/admin/products/:id` | Partial update of any field (validated). Version-guarded. |
| POST | `/api/v1/admin/products/:id/publication` | `{ publication: "draft"\|"published"\|"archived" }` |
| POST | `/api/v1/admin/products/:id/stock` | `{ stock: "in"\|"out" }` |
| POST | `/api/v1/admin/products/:id/eligibility` | `{ eligibility, note?, review_due_at? }` — **owner role only** |
| DELETE | `/api/v1/admin/products/:id` | **Owner only**; `422` if published ("Unpublish or archive this product first."). Hard-deletes only non-published rows. |
| POST | `/api/v1/admin/uploads` | Multipart field `file` ≤ 2 MB; JPEG/PNG/WebP; ≥64×64; re-encoded (strips EXIF/payloads); random key `uploads/<uuid>.<ext>`; returns `{ key, url, width, height, bytes }` |
| GET / PUT | `/api/v1/admin/settings` | Shop settings (brand, WhatsApp number, order-message templates, support email/hours, default locale, Robux rules). PUT is a **partial merge**, **owner only**, version-guarded. Surfaced in the admin **Shop settings** tab. |
| GET | `/api/v1/admin/audit` | `?entity_type&entity_id&page&limit` — audit trail with actor email |
| GET | `/api/v1/admin/guides` | All guides (incl. drafts) |
| PATCH | `/api/v1/admin/guides/:id` | `{ name?, tagline?, content?, publication? }`, version-guarded |

**Admin product shape** = public shape + `publication` (real value),
`eligibility` (real value), `eligibilityNote`, `eligibilityReviewedAt`,
`eligibilityReviewDueAt`, `imageKey`, `version`, `createdAt`, `updatedAt`,
`updatedBy`.

### 4.4 Optimistic concurrency (all admin writes except create)

Send the record's `version` as `body.version` or `If-Match` header:

- missing → **428** `Precondition required`
- stale → **409** `This record was updated elsewhere. Current version is N.`
- current → proceeds, row `version` increments

### 4.5 Server-enforced state rules (Backend PRD §6)

- **Publishing requires**: `eligibility = approved` **and** Bangla name **and**
  an image. (English name, category, price are required at create time.)
- **Featured** requires published + approved + in stock; when a write makes a
  product non-orderable it is **auto-unfeatured**.
- **Public visibility** = published **and** approved (stock may be out — such
  products show as unavailable and expose no order action; the front end hides
  the WhatsApp button and shows a notice).
- **Eligibility**: `review | approved | rejected | informational`. Approving
  without a note stores a placeholder note automatically (PRD decision D-1 —
  the owner must later record the real evidence basis and review date).
- **Delete**: owner-only, and published products can never be hard-deleted —
  archive first.
- Every successful write: bumps `shop_settings.data_version` (invalidates all
  public ETags), appends an `audit_event` snapshot of before/after, and bumps
  the row's `version`. Multi-statement writes run in a transaction.

### 4.6 Error format

`application/problem+json` (RFC 9457):

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields need fixing.",
  "errors": [ { "field": "price", "message": "A price is required." } ]
}
```

Statuses used: 400, 401, 403, 404, 409, 413, 422, 428, 429, 500. Stack traces
and DB details are never leaked.

---

## 5. Data model (SQLite; 1:1 with Backend PRD Appendix B)

JSON columns are TEXT holding JSON; timestamps are ISO-8601 UTC strings.
`version` = optimistic-concurrency counter; `data_version` (settings only) =
public cache-busting counter.

**category** — `id TEXT PK · en · bn · image_key · display_order · visible`

**admin_user** — `id TEXT PK · email UNIQUE · password_hash ("scrypt:<salt>:<hash>") ·
role ('owner'|'editor') · active · mfa_enrolled · last_sign_in_at · created_at`

**product** — `id TEXT PK · sku TEXT UNIQUE · name JSON{en,bn} · short JSON ·
description JSON · includes JSON[] · category_id FK→category · price INTEGER
(1…10,000,000, BDT) · price_from 0|1 · list_price · robux_amount ·
tag JSON · stock ('in'|'out', default 'out') · publication
('draft'|'published'|'archived', default 'draft') · eligibility
('review'|'approved'|'rejected'|'informational', default 'review') ·
eligibility_note · eligibility_reviewed_at · eligibility_review_due_at ·
featured 0|1 · tone ('green'|'sand') · monogram · image_key · created_at ·
updated_at · updated_by · version`
Indexes: `(publication, eligibility, stock, category_id)` and a partial
featured index.

**guide** — `id TEXT PK · name JSON · tagline JSON · content JSON
{idx, monogram, tone, intro, waysTitle, ways[], safety[], links[]} ·
publication ('draft'|'published') · updated_at · version`

**admin_session** — `id TEXT PK (= sha256 of the cookie token) · admin_id
FK→admin_user · csrf · created_at · last_seen_at · expires_at`

**audit_event** — `id INTEGER PK AUTOINCREMENT · actor_admin_id · action ·
entity_type · entity_id · before JSON · after JSON · created_at`
(+ lookup index on entity_type, entity_id, created_at)

**shop_settings** — single row `id = 1`: `whatsapp_number ·
whatsapp_template_product · whatsapp_template_robux (custom order-message
templates, ≤1000 chars, empty = built-in localized message) · support_email ·
support_hours JSON{en,bn} · default_locale ('en'|'bn', seeded 'bn') ·
brand_name · robux_rules JSON {min, max, defaultAmount, presets[],
tiers[{from,rate}]} · data_version · version · updated_at · updated_by`
(older databases get the two template columns via an in-place
`ALTER TABLE` migration in `server/db.js`).

`robuxRules` example (from the seed bundle): min 10, max 100000,
defaultAmount 100, presets 40…100000, tiers 5 with rate 1.30 → 0.98 BDT/Robux.

---

## 6. Authentication & security

### Backend mode (real)
- **Passwords**: scrypt (Node `crypto.scryptSync`, 64 bytes, per-user salt),
  stored as `scrypt:<salt>:<hash>`; verified with `timingSafeEqual`.
- **Sessions**: random 32-byte token in cookie `bb_sess` (`HttpOnly`,
  `SameSite=Lax`, `Secure` auto when HTTPS). Server stores only
  `sha256(token)`. **Idle timeout 12 h**; absolute lifetime 12 h, or up to
  **30 days** with `remember`. Sessions are purged on sign-in and expiry.
- **CSRF**: `bb_csrf` cookie (readable by same-origin JS) mirrored into the
  `x-csrf-token` header on every write; plus an origin-must-match-host check.
  (`api.js` attaches the header automatically.)
- **Roles**: `owner` (everything) vs `editor` (cannot change eligibility
  state or delete products). Seeded accounts are owners.
- **Sign-in lockout** (escalating, in-memory): per account **5 fails / 15 min**,
  per IP **10 fails / 15 min**; lock duration doubles each time (15 min base,
  capped ×8). Locked attempts return `429` + `Retry-After` — even for the
  correct password until the lock expires.
- **Admin page gate**: `/admin.html` redirects server-side without a session;
  the client gate (`admin-gate.js`) hides the page pre-render too.
- **Security headers** (all responses): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy` (camera/mic/geolocation/payment off), a strict
  `Content-Security-Policy` (`script-src 'self'`; inline styles allowed;
  images `self`+`data:`; connect `self`), and HSTS when HTTPS.
- Rate limiting is in-memory / process-local (single-instance by design).

### Static mode (design demo only)
- Client-side gate: SHA-256 of the entered password compared against
  `config.js → admin.passwordHash`; session object in
  `sessionStorage`/`localStorage` under `bb_admin_session`; 5 wrong attempts →
  60-second lockout. **Presentation only — not real security** (documented in
  README). Admin edits live in `localStorage` under `bb_admin_v1` (products)
  and `bb_admin_settings_v1` (WhatsApp number + order-message templates);
  `config.js` re-applies both on load.

### Credentials (seeded — demo)
- Backend owner: `owner@bloxbazaar.local` / `BloxBazaar@2026` (env-overridable
  via `BB_SEED_ADMIN_EMAIL` / `BB_SEED_ADMIN_PASSWORD`; **change before real
  use**).
- Static demo password: `BloxBazaar@2026`.

---

## 7. Configuration (server/.env, all optional)

Copy `server/.env.example` → `server/.env`. Defaults in `server/config.js`:

| Var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `4173` / `127.0.0.1` | Listen address |
| `BB_TRUST_PROXY` | `0` | `1` only behind a trusted reverse proxy |
| `BB_DB_PATH` | `server/data/bloxbazaar.db` | SQLite file |
| `BB_UPLOADS_DIR` | `server/data/uploads` | Uploaded images |
| `BB_SESSION_IDLE_HOURS` | `12` | Idle timeout |
| `BB_SESSION_HOURS` | `12` | Absolute session lifetime |
| `BB_SESSION_REMEMBER_DAYS` | `30` | With "remember me" |
| `BB_COOKIE_SECURE` | `auto` | `auto`/`always`/`never` |
| `BB_SIGNIN_ACCOUNT_MAX` | `5` | Fails before account lockout |
| `BB_SIGNIN_IP_MAX` | `10` | Fails before IP lockout |
| `BB_SIGNIN_WINDOW_MIN` | `15` | Lockout window |
| `BB_PUBLIC_RATE_PER_MIN` | `120` | Public API |
| `BB_ADMIN_READ_RATE_PER_MIN` | `240` | Admin reads |
| `BB_ADMIN_WRITE_RATE_PER_MIN` | `60` | Admin writes |
| `BB_UPLOAD_RATE_PER_HOUR` | `20` | Uploads |
| `BB_SEED_ADMIN_EMAIL` / `BB_SEED_ADMIN_PASSWORD` | see §6 | First-run owner |

`0` disables a limiter (local dev).

---

## 8. Frontend behavior details

- **Boot flow** (`site.js`): render chrome → `BB_API.load()` (public bundle)
  → populate `window.BB_DATA` / `window.BB_GUIDES` in the **same shape the
  static config used** → dispatch `bb:ready` → page controllers render.
  Force a source with `window.BB_DATA_SOURCE = "static" | "api"`.
- **Caching**: front-end GETs use `cache: "no-cache"` so the browser
  revalidates against the `dataVersion` ETag — admin edits appear on the next
  page view, unchanged data costs a cheap 304.
- **Page name vs URL**: the marketplace page is titled "Marketplace"
  (EN) / "মার্কেটপ্লেস" (BN) in all UI copy, but the file/URL stays
  `catalogue.html` and the API namespace stays `/catalogue` (link stability).
  i18n key *names* (e.g. `nav.catalogue`) are internal and unchanged.
- **State preview hooks (design review)**: `catalogue.html?state=loading|
  empty|error`, `admin.html?state=empty`, `admin.html?drawer=edit&id=<id>`,
  `admin.html?drawer=new`. `admin-login.html?next=…` preserves deep links.
- **Brand**: UI chrome uses the owner-supplied SVG set in
  `assets/img/website logo/` — `logo_primary.svg` (header + footer),
  `mark_only.svg` (admin top bar; header ≤480 px via `<picture>`),
  `logo_stacked.svg` (sign-in card), `favicon_navy_gold.svg` (tab icon).
  `logo_reversed.svg` is reserved for dark backgrounds (none exist yet).

---

## 9. Scripts & running

```bash
npm install                 # express, multer, sharp (+ tailwind dev deps)

npm run server              # start backend at http://127.0.0.1:4173
npm run seed                # one-time import from config.js/guides-data.js
                            # (idempotent: existing rows are never overwritten)
npm test                    # 17 API tests, node --test server/test/**/*.test.js
npm run build:css           # rebuild tailwind.css from tailwind.src.css
npm run watch:css           # the same, in watch mode
```

First `npm run server` on an empty DB seeds automatically and prints a report.
The storefront itself (no backend) is just the static files — open any HTML
file directly or host the folder anywhere.

---

## 10. Tests (server/test/api.test.js — 17 passing)

Covers: public bootstrap/catalogue filters/detail/guides; dataVersion ETag +
304; admin auth requirement + CSRF enforcement; full admin listing; create
defaults (draft/review/out); publish gating (approval, image, Bangla text);
featured rules + auto-unfeature; optimistic concurrency 428/409/200;
archive-never-hard-delete for published products; editor role restrictions
(no eligibility, no delete); settings partial merge + validation + version
guards; upload re-encode + junk/oversize rejection; guides list + patch;
sign-in lockout escalation; public rate limiter 429 + Retry-After; static
serving + admin page gate + security headers.

---

## 11. Seeded data (from the static bundle)

- **29 products** total; **26 public** (published + approved).
- Non-public demo states preserved on purpose: `mm2-sweet-set` (draft),
  `sb-cash-pack` (draft + needs review + out of stock), `bf-leopard`
  (archived). `bf-fruit-notifier` is public but out of stock.
- **5 categories** (robux, blox-fruits, mm2, rivals, steal-a-brainrot),
  **5 guides**.
- The WhatsApp number ships **empty** on purpose (placeholder text is shown).
  Never invent it — the owner must provide it (README has the checklist).

---

## 12. Hard constraints for any follow-up work

1. **Scope**: no payment processing, no customer accounts, no Roblox APIs, no
   automatic WhatsApp sending, no checkout. Backend scope is defined by
   `docs/backend-prd.md` v2.0.
2. **No customer PII server-side** — the Roblox username lives only in the
   visitor's browser/WhatsApp message.
3. **Two modes must both keep working**: full backend AND the static
   `file://`/plain-host design demo (with `?state=` previews).
4. **State rules are enforced server-side** — never move them client-only.
5. **Never invent values** (WhatsApp number, prices, eligibility evidence):
   safe defaults + explicit placeholders only.
6. **Rollback story**: serve the site statically (feature flag is the data
   source itself — `config.js` bundle vs API).
7. UI language: any new user-facing string should exist in EN + BN in
   `i18n.js`.
8. The local build is single-instance (in-memory limiters, local disk); the
   documented production target is PostgreSQL + object storage + managed auth
   with MFA + CDN.
