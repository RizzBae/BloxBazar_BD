# BloxBazaar BD — Backend PRD

| | |
|---|---|
| **STAGE** | Stage 2 of 2 — data, admin permissions, APIs, and operations |
| **AUDIENCE** | Backend developer, architect, or AI coding tool |
| **VERSION** | **2.0** | 19 October 2026 |
| **SCOPE** | Product catalogue, eligibility gate, admin inventory controls, WhatsApp Click to Chat handoff, Bangladesh compliance baseline |
| **STATUS** | Standalone handoff document |

> **Standalone handoff document.** This PRD is designed to be pasted into an AI development tool on its own. Follow only the scope named in this document. The Stage 1 Design PRD defines the visual system; the static storefront built from it (current repository) is the interface contract this backend must serve — do not redesign screens.

Prepared for a Bangladesh-first gaming catalogue and support website. Use the supplied logo assets when they are provided; until then, keep the wordmark as a text placeholder.

## What changed in v2.0 (vs v1.1, 18 Oct 2026)

1. **Bangladesh legal baseline added** — Digital Commerce Operation Guidelines 2021 and the Personal Data Protection Act 2026 are now mapped to concrete build items (§13).
2. **Concrete API contract and data model** — endpoints, JSON shapes, validation rules, error format, and a DDL sketch that match the shipped front-end field-for-field (Appendices A–B).
3. **State rules reconciled with the shipped design** — out-of-stock items stay viewable with a badge but never show an order action; featured surfaces only orderable items (§6).
4. **Eligibility made operational** — evidence note, reviewer, review date, and re-review triggers; publish and order-link guards enforced server-side (§3, §6).
5. **Security mapped to current standards** — OWASP ASVS 5.0.0 and OWASP Top 10:2025, with concrete session, CSRF, upload, header, and rate-limit requirements (§10).
6. **Reliability quantified** — RPO/RTO targets, backup and restore-drill requirements, staging, migration and rollback policy (§11).
7. **Performance and caching specified** — `dataVersion`/ETag strategy reusing the front-end's existing cache-busting concept (§12).
8. **Migration plan from the static build** — feature-flagged API data source, seeding parity, rollback to static (§14).
9. **Testing expanded** — full state-combination matrix, security tests, and reliability drills as acceptance criteria (§15).
10. **Owner decisions and post-v1 backlog** — numbered decisions blocking launch (§17) and triggered additions only (§19).

---

## 1. Product brief

Build the backend for BloxBazaar BD as a small, maintainable system for public catalogue and guide content, admin product management, stock status, and WhatsApp Click to Chat links. The backend supports the separate Design PRD but does not define its visual styling.

The website does **not** process payments, create customer accounts, execute Roblox transactions, or send WhatsApp messages on the customer's behalf. Clicking the WhatsApp link opens the conversation with a prepared message; the customer presses Send. [S2]

**Non-negotiable invariants** (apply everywhere in this document):

- Never accept, transmit, or store Roblox passwords, one-time codes, backup codes, or account access.
- Never store customer payment credentials; there is no checkout.
- guides carry no price, stock, or order link.
- New products default to **Draft** and **Needs review**; nothing becomes public without explicit approval.
- Records are archived, not hard-deleted, so mistakes stay reversible and auditable.
- No customer PII is required to use the site; the only optional identifier is a Roblox username, carried inside the customer's own WhatsApp message.

## 2. Goals, non-goals, and success criteria

### 2.1 Goals (v1)

- Allow authorized admins to create, edit, publish, unpublish, archive, and restore permitted catalogue items.
- Keep public catalogue responses read-only and limited to eligible, published records.
- Keep public availability aligned with the latest admin stock update (within one minute).
- Generate product-specific WhatsApp Click to Chat links from trusted product data.
- Provide one settings surface for the WhatsApp number, Robux rules, and support details.
- Provide an append-only audit trail of admin changes.

### 2.2 Non-goals (explicitly out of v1)

- No payment processing, checkout, cart, or payment provider integration.
- No customer accounts, login, or order database.
- No inventory reservation (clicking a WhatsApp link reserves nothing).
- No Roblox API calls of any kind.
- No automatic WhatsApp sending and no WhatsApp Business/Cloud API.
- No storing of Roblox passwords, one-time codes, or payment credentials.
- No microservices, message queues, search engines, caches, or background workers.
- No visual redesign: the front-end screens and states stay as shipped.

### 2.3 Measurable success criteria

| # | Criterion | Target |
|---|---|---|
| G-1 | Admin edit → visible on public site | ≤ 60 s (cache TTL; see §12) |
| G-2 | Public catalogue API latency, origin, from Dhaka | p95 ≤ 300 ms |
| G-3 | Order links on non-orderable products | 0 (enforced server-side, tested in §15) |
| G-4 | Roblox credentials / payment data stored or transmitted | 0 occurrences by design |
| G-5 | New products publicly visible without review | 0 (tests enforce default Draft + Needs review) |
| G-6 | Admin data reachable without an authenticated session | 0 routes (tests enforce 401/403) |
| G-7 | Backup restore drill completed before launch | 1 documented, timed exercise |
| G-8 | Recovery objectives | RPO ≤ 24 h (≤ 5 min with PITR); RTO ≤ 4 h |

## 3. Policy and eligibility boundary

Roblox's published Terms say third-party services that sell or transfer Robux or virtual content outside Roblox are not recognized and that this activity violates the Terms. Therefore, Robux and in-game virtual items must not be exposed as externally orderable products unless Roblox explicitly authorizes the sale. A WhatsApp handoff does not change the rule. [S1]

- The five requested game names can be stored and rendered as **informational guide topics**, separately from sale products.
- Only a product that is both **eligible for external sale** and **explicitly approved by the admin** may become public.
- Admin approval must not be able to override a platform or legal restriction; the eligibility field records review status, not proof of permission.
- Review current Roblox and game-publisher terms before launch and whenever the catalogue policy changes. Where a game's own terms conflict with a contemplated sale, the stricter rule applies.
- **Owner decision D-1** (§17): the owner records the basis (evidence note) for each product marked eligible, and a re-review date. The software enforces the recorded decision; it does not verify the law.

| Eligibility state | Meaning | Public behaviour |
|---|---|---|
| `review` | New/unreviewed (default). | Never public. Cannot publish. Cannot order. |
| `approved` | Reviewed and approved for external sale, with a recorded basis. | Public if also `published` (and shows stock state). |
| `rejected` | Reviewed and not eligible. | Never public. Cannot order. |
| `informational` | Kept for reference only (e.g., an item that will become guide content). | Never public as a sale product in v1. |

> **Safeguard** — Default new products to **Draft** and **Needs review**. Never publish an unreviewed product by default. The backend re-checks both on every write and every public read; the front-end filters are a display convenience, not the control.

## 4. Architecture

**KISS rule:** build the first version as a **modular monolith**. Use one deployable web application, one managed relational database, managed object storage for product images, and a managed authentication provider with MFA. Deploy and operate the application as one unit.

Keep clear internal modules for **catalogue, admin, guides, shop settings, and audit history**. Keep public read operations separate from admin write operations inside the application. Use PostgreSQL or the managed relational database already supported by the chosen host.

Do **not** add microservices, Redis, a separate search engine, message queues, background workers, custom authentication, payment integrations, Roblox APIs, WhatsApp Business APIs, or workflow engines in version one. The WhatsApp order handoff needs only a generated Click to Chat link.

**Reference stack (one valid example, not a mandate):** Node.js 22 + TypeScript, PostgreSQL 16, S3-compatible object storage, managed auth provider with TOTP MFA, deployed to a platform region in **Singapore** (or Mumbai) — Singapore is typically the lowest-latency international hub for Bangladesh; measure from Dhaka before committing. A bundled BaaS that provides database + auth + storage in one managed service is equally acceptable if it meets §10.

**Environment and configuration:**

- Production and staging environments, separate credentials, no shared data.
- All secrets (database URL, storage keys, auth keys) in environment/secret storage — never in source or logs.
- Shop settings that the owner edits (WhatsApp number, Robux rules, support details) live in the database, not in code.

> Add infrastructure only when a documented requirement or measured bottleneck justifies it. Prefer existing platform features and standard libraries over custom frameworks or abstractions for hypothetical future needs.

## 5. Roles, data model, and content contract

### 5.1 Roles

- **Owner** — full access: products, prices, stock, eligibility, settings, guides, audit, admin accounts.
- **Editor** — day-to-day operations: create/edit products, prices, stock, images; publish/unpublish; cannot change eligibility, settings, or admin accounts.

No public admin registration. Accounts are created by the Owner, require MFA, and are **disabled** (not deleted) when no longer needed. See Appendix C for the permission matrix.

### 5.2 Entities

Field names below are the canonical backend names; the public API mirrors them (Appendix A) so the shipped front-end can switch data sources without redesign.

**Product**

| Field | Type / values | Rules |
|---|---|---|
| `id` | text (slug, PK) | `^[a-z0-9-]{2,64}$`, immutable once published; matches current URLs (`product.html?id=…`) |
| `sku` | text | unique, e.g. `BB-RB-200` |
| `name`, `short`, `description` | jsonb `{en,bn}` | `en` required; `bn` required before publish; control characters stripped |
| `includes` | jsonb array of `{en,bn}` | 0–8 items |
| `category_id` | fk → category | one of the five categories |
| `price` | integer BDT | 1–10,000,000; `price_from=true` for "from" pricing |
| `list_price` | integer BDT, nullable | must be ≥ `price` when set |
| `robux_amount` | integer, nullable | 10–100,000, step 10 (robux products only) |
| `tag` | jsonb `{en,bn}`, nullable | short chip text |
| `stock` | `in` / `out` | default `out` (never sell by accident) |
| `publication` | `draft` / `published` / `archived` | default `draft` |
| `eligibility` | `review` / `approved` / `rejected` / `informational` | default `review` |
| `eligibility_note` | text, nullable | basis/evidence; **required** to set `approved` |
| `eligibility_reviewed_at`, `eligibility_review_due_at` | timestamps/date | set on approval; due date drives re-review reminders |
| `featured` | boolean | only orderable items may be featured (§6) |
| `tone` | `green` / `sand` / null | card styling fallback (design token) |
| `monogram` | text | 2–4 chars, image fallback |
| `image_key` | text (storage key) | validated upload (§7) |
| `updated_at`, `created_at` | timestamptz (UTC) | display converts to Asia/Dhaka |
| `updated_by` | fk → admin_user | audit attribution |
| `version` | integer | optimistic concurrency; incremented on every write |

**Category** — `id`, `en`, `bn`, `image_key`, `display_order`, `visible`. The five shipped categories: `robux`, `blox-fruits`, `mm2`, `rivals`, `steal-a-brainrot`.

**Guide** — `id` (= category id), `name` `{en,bn}`, `tagline` `{en,bn}`, `content` jsonb (mirrors the shipped guide shape: `intro`, `waysTitle`, `ways[]`, `safety[]`, `links[]` — all bilingual; URLs must be `https` and allow-listed domains), `publication` (`draft`/`published`), `updated_at`. Guides are separate records: **no price, no stock, no order link, ever**.

**Admin user** — provider user id, email, role (`owner`/`editor`), `active`, `mfa_enrolled`, `last_sign_in_at`.

**Audit event** — `id`, `actor_admin_id`, `action`, `entity_type`, `entity_id`, `before` jsonb, `after` jsonb, `created_at`. Append-only; retained ≥ 24 months.

**Shop settings** (single row) — `whatsapp_number` (E.164 digits; see §9), `whatsapp_template_product`, `whatsapp_template_robux` (custom order-message templates; free text with `{placeholder}` tokens, ≤1000 chars each, empty = the built-in localized message), `support_email`, `support_hours` `{en,bn}`, `default_locale`, `brand_name`, `robux_rules` jsonb (see below), `data_version` integer, `updated_at`/`updated_by`.

**Robux rules** (owner-editable, served publicly because the picker needs them):

```json
{ "min": 10, "max": 100000, "defaultAmount": 100,
  "presets": [40, 80, 100, 150, 200, 300, 400, 800, 1000, 2000, 5000, 10000, 25000, 50000, 100000],
  "tiers": [ { "from": 5000, "rate": 0.98 }, { "from": 0, "rate": 1.3 } ] }
```

### 5.3 Content contract

Bilingual content is stored and returned as `{ "en": "…", "bn": "…" }` objects; the front-end already selects by locale. Timestamps are stored UTC (ISO 8601) and displayed in Asia/Dhaka. All money is integer BDT (never floats).

## 6. Product states, stock, and publication rules

- A game guide is not a Product record and cannot be assigned a purchasable price or stock count.
- Publishing requires: `eligibility = approved` **and** all required fields valid (including `name.bn`, `price`, `image`). Stock is independent: a published item may be out of stock.
- Out-of-stock behaviour (matches the shipped design and the Bangladesh stock-display duty, §13): the product **stays viewable** with an **Out of stock** badge, and **no order action or WhatsApp link is rendered anywhere**. It is excluded from the featured row.
- Only `featured = true` **and** orderable (published + approved + in stock) items may appear in the featured surface. The API supports `featured=1&available=1` and the front-end requests both.
- The WhatsApp order link requires all three: `published`, `approved`, `in stock` — enforced server-side and re-tested in §15.
- Out-of-stock changes take effect atomically. No customer reservation is created by clicking WhatsApp.
- Prefer archiving over hard deletion so mistakes can be reversed and changes remain auditable.
- Setting `featured = true` on a non-orderable item is rejected with a validation error.

| State (publication) | Meaning and public behaviour |
|---|---|
| `draft` | Admin-only; not available to public catalogue or product pages. |
| `published` + `approved` + in stock | Appears publicly; order link may be generated. |
| `published` + `approved` + out of stock | Visible with Out of stock badge; **no** order link. |
| `published` + `review` / `rejected` / `informational` | Treated as not public (defensive rule; publish guard should prevent this state). |
| `archived` | Hidden from the public catalogue; retained for audit and possible restoration. |
| Eligibility `review` / `rejected` | Cannot publish; cannot be ordered. |

> **Safeguard** — Two admins editing the same product: the second write with a stale `version` is rejected with `409 Conflict` and must not overwrite. The editor UI shows "updated elsewhere — reload".

## 7. Admin capabilities

- Sign in and sign out; no public admin registration; MFA required for every account.
- Create and edit product records with server-side validation (rules table in §8).
- Set BDT price and in-stock/out-of-stock status (quick toggle and full edit).
- Set draft, published, or archived states, subject to eligibility rules; restore archived products.
- Record eligibility decisions with a note and review date (Owner only).
- Manage categories and informational guide pages separately (depth per **D-3**, §17).
- Manage images: upload, validate, re-encode, preview; product images are the only user-uploaded files.
- Update the WhatsApp number (international format, validated), support email/hours, and Robux rules.
- View an audit history (who changed what, when; before/after).
- Sessions: cookie-based, idle timeout 12 h; "keep me signed in" extends the absolute lifetime to ≤ 30 days; session revoked on password/MFA change; five failed sign-ins per account triggers a 15-minute lockout with escalating back-off.

**Image upload rules:** jpeg/png/webp only; ≤ 2 MB; ≥ 64×64 px; ≤ 2400×2400 px; server re-encodes and **strips metadata (EXIF)**; stored under a random key (`products/<uuid>.<ext>`); original filename never trusted; SVG/GIF/PDF/HTML rejected. Images are served from the storage/CDN origin with long-lived immutable caching.

## 8. API behaviour and contract

Base path `/api/v1`. JSON UTF-8. Timestamps ISO 8601 UTC. Errors use `application/problem+json` (RFC 9457 [S8]) with `{ "type", "title", "status", "detail", "errors": [{ "field", "message" }] }`. Never return stack traces or database details.

### 8.1 Endpoint surfaces

| Surface | Endpoints (see Appendix A for shapes) |
|---|---|
| Public bootstrap | `GET /api/v1/bootstrap` — brand, `dataVersion`, robux rules, categories, public settings |
| Public catalogue | `GET /api/v1/catalogue?category&q&min_price&max_price&featured&available&page&limit` |
| Public product | `GET /api/v1/products/{id}` |
| Public guides | `GET /api/v1/guides`, `GET /api/v1/guides/{id}` |
| Admin session | `POST /api/v1/admin/session`, `DELETE /api/v1/admin/session`, `GET /api/v1/admin/session` |
| Admin products | `GET /api/v1/admin/products?state&q&page`; `POST /api/v1/admin/products`; `PATCH /api/v1/admin/products/{id}`; `POST …/{id}/publication`; `POST …/{id}/stock`; `POST …/{id}/eligibility` (Owner) |
| Admin uploads | `POST /api/v1/admin/uploads` (multipart) → `{ key, url }` |
| Admin guides | `GET/POST/PATCH /api/v1/admin/guides…` (per D-3) |
| Admin settings | `GET /api/v1/admin/settings`, `PUT /api/v1/admin/settings` |
| Admin audit | `GET /api/v1/admin/audit?entity&id&page` |

Rules:

- **Public responses never include** draft/archived/review/rejected/informational products, eligibility notes, admin identities, audit data, or internal timestamps beyond the public `updated` date. For front-end compatibility, public payloads include `publication: "published"` and `eligibility: "approved"` as harmless constants — the shipped front-end filters on them.
- **Writes use optimistic concurrency:** `PATCH` and `PUT` require the record's `version` (e.g., `If-Match: "<version>"`); stale writes return `409` with the current version in `detail`.
- **Pagination:** `page` (default 1) and `limit` (default 24, max 60); responses include `total`. Search `q` matches `name.en`, `name.bn`, and `sku`, minimum 2 characters, case-insensitive, parameterized (escape `%`/`_`). Price filters are inclusive integers.
- **Caching:** public GETs return `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300` and `ETag: W/"dv<dataVersion>"`; `If-None-Match` → `304`. Admin GETs are `no-store`.
- **CORS:** same-origin only in v1 (site and admin share the origin). If a separate admin origin is ever added, strict allow-list plus credentials — never `*`.
- **Rate limits** (return `429` + `Retry-After`):

| Surface | Limit |
|---|---|
| Public GET | 120/min per IP (CDN absorbs repeat traffic) |
| Admin sign-in | 5/15 min per account **and** 10/15 min per IP, escalating lockout |
| Admin reads | 240/min per admin |
| Admin writes | 60/min per admin |
| Uploads | 20/hour per admin |

### 8.2 Server-side validation (summary)

Integer BDT 1–10,000,000; slug regex above and unique; `sku` unique; enums as in §5; `robux_amount` 10–100,000 step 10; `list_price ≥ price`; `featured` only when orderable; `eligibility_note` required for `approved`; text length caps (name ≤ 120, short ≤ 200, description ≤ 4,000, includes item ≤ 160); strip control characters; image rules per §7; guide URLs `https` only.

## 9. WhatsApp Click to Chat order handoff

Create a Click to Chat URL for an eligible in-stock product. Use the configured admin number in international format (E.164 digits without `+`, e.g. `8801XXXXXXXXX` [S7]) and URL-encode the pre-filled message. WhatsApp documents that the prepared message appears in the chat text field; the customer must choose to send it. [S2]

- URL form: `https://wa.me/<digits>?text=<encodeURIComponent(message)>` — newlines become `%0A`, spaces `%20` or `+` (the shipped code already does this).
- Include: product name (in the visitor's locale), SKU, requested quantity (or Robux amount + estimated price), displayed BDT price, and the public product URL.
- Optional: the visitor's Roblox username, typed on the product page and kept **only** in the visitor's browser (`localStorage`) and inside their own WhatsApp message. It is never sent to the backend.
- Never include (and never request): passwords, one-time codes, backup codes, session data, payment details, or any other sensitive identifier.
- No backend send-message call and no WhatsApp Business API this feature. [S2]
- No order is created in the database and no stock is reserved when a link is opened. The website must not claim an order is confirmed merely because the customer opened WhatsApp.
- If a product becomes unavailable after page load, the admin confirms availability in WhatsApp; show the product's last-updated time where practical (design already does).
- Do not generate an order link for guides, restricted items, draft items, rejected items, archived items, or out-of-stock products.
- The number lives in **shop settings** (single source). Changing it updates all future links; already-sent chat links keep the old number, so avoid frequent changes.
- While `whatsapp_number` is empty, the site keeps its current placeholder behaviour (link opens without a recipient) and the admin panel shows a "set your number" reminder. **[D-2]**

**Operational reality:** the admin confirms the item, current price, and next steps in the WhatsApp conversation; payment (bKash/Nagad/bank, per the owner's process) happens entirely inside that chat, outside this website's scope. The site must never take payment, and the admin must not accept payment for an item marked out of stock.

## 10. Security requirements

**Baseline:** OWASP ASVS 5.0.0 [S5], Level 1 fully and Level 2 for authentication, session, and access-control items; track OWASP Top 10:2025 [S6] (A01 is Broken Access Control).

- **AuthN:** managed provider, MFA required (TOTP at minimum; passkeys where the provider supports them); recovery codes stored offline by the owner; accounts disabled, not deleted.
- **Sessions:** `__Host-` prefixed cookie, `HttpOnly`, `Secure`, `SameSite=Lax`; idle 12 h; absolute ≤ 30 days with "keep me signed in"; rotate on privilege change; revoke all sessions on password/MFA change.
- **CSRF:** cookie sessions require double-submit CSRF tokens on all state-changing routes plus an `Origin`/`Referer` check.
- **AuthZ:** check the role on the **server** for every protected route; deny by default; no object enumeration (admin routes never expose another tenant's data — single shop here, but keep the pattern).
- **Input/DB:** parameterized queries or a safe ORM; validation per §8.2; output encoding is the front-end's existing responsibility and should be preserved.
- **Response headers:** HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal, CSP with `frame-ancestors 'none'`, `img-src` limited to self + storage/CDN origin, `script-src 'self'`, no unsafe-inline where avoidable.
- **Uploads:** rules in §7; store outside the application origin (dedicated storage/CDN host); never serve uploads as executable content.
- **Secrets:** managed secret storage; separate per environment; rotate on staff change; never log.
- **Logging:** structured logs with request IDs; never log passwords, tokens, codes, WhatsApp message contents, or visitor PII; log retention 30 days; audit trail separate (§5.2).
- **Abuse:** rate limits per §8; sign-in lockout; optional bot protection (e.g., CAPTCHA/Turnstile) on sign-in **only if** abuse is observed — document the trigger.
- **Supply chain (Top 10:2025):** lockfiles committed, automated dependency updates, minimal dependency surface, review before adding packages.
- **Data at rest:** provider encryption; database not publicly reachable; least-privilege database credentials for the app only.

> **Safeguard** — The current static site's client-side admin gate (SHA-256 password in `config.js`) is a design-stage stand-in and **must not exist in the production deployment**. Production admin access is authenticated on the server only.

## 11. Reliability, recovery, and error handling

- **Transactional writes:** multi-field updates (e.g., stock + featured + status) happen in one transaction so a failed save cannot leave mismatched states.
- **Concurrency:** optimistic `version` checks (§8) prevent silent overwrites; audit records both attempts.
- **Validation errors:** clear field-level errors via problem+json; visitors never see stack traces or database details.
- **Backups:** daily automated backups, plus point-in-time recovery where the provider offers it; retention ≥ 30 days; **one documented restore exercise completed on staging before launch**; runbook stored in the repository. RPO ≤ 24 h (≤ 5 min with PITR); RTO ≤ 4 h (G-8).
- **Environments:** staging for release review; production changes deploy through CI with the previous release as a rollback path.
- **Migrations:** versioned files in the repo; forward-only; prefer additive changes; destructive migrations require a fresh backup and a staged rehearsal.
- **Health:** `GET /healthz` returns `{ status, version }` with no internals; external uptime monitor every 5 minutes with alerts to the owner; error tracker (free tier acceptable) with PII scrubbing.
- **Incident basics (write down and keep current):** how to disable an admin account, how to force-logout, how to restore from backup, who to notify. No software can promise zero defects or zero security risk; use these controls to reduce risk and make failures recoverable.

## 12. Performance and caching

- Public catalogue origin latency p95 ≤ 300 ms from Dhaka (G-2); admin writes p95 ≤ 500 ms.
- CDN in front of static assets and images; catalogue payload ≤ 60 KB gzip for a 24-item page.
- Images: re-encoded at upload, target ≤ 400 KB each, immutable URLs, `Cache-Control: public, max-age=31536000, immutable`; the front-end already lazy-loads.
- **Cache-busting:** the single `data_version` integer increments on any change that affects public output (products, categories, guides, settings, robux rules). It is returned in `/bootstrap`, embedded in public ETags, and is the same concept the static site already uses — the front-end can discard stale client caches when it changes.
- Freshness trade-off: with a 60-second public cache, an admin publish is visible within ~60 s (G-1); this is acceptable for a WhatsApp-handoff shop. If it ever isn't, add targeted CDN purge on publish — only with a documented need.
- Indexes: `product(publication, eligibility, stock, category_id)`, partial index on `featured` where orderable, unique `sku`, unique `id`; `audit_event(entity_type, entity_id, created_at desc)`.
- Budget: keep v1 infrastructure within a small monthly envelope (free tiers where adequate; roughly ≤ US$15/month at launch). Review before scaling anything.

## 13. Bangladesh legal and compliance baseline

> **Not legal advice.** This section lists what the site/backend must be *capable of* so that the owner (with local counsel) can operate compliantly. Verify current texts; the guidelines and the Act are primary in Bangla, and they change.

### 13.1 Digital Commerce Operation Guidelines 2021 (Ministry of Commerce) [S3]

| Requirement | What it means for BloxBazaar BD | Where it lands |
|---|---|---|
| Business registration & identity display (UBID; trade licence / TIN / VAT as applicable) | Owner applies for UBID (online, free, at dbid.gov.bd — guideline states a 60-working-day issuance window) and displays business identity on the site | Settings fields + contact page + footer; **[D-7]** |
| Terms of sale, return/refund, delivery method & timing, other conditions — **displayed in Bangla** (English optional) | Owner-authored policy pages in Bangla (English too) | Policy pages; BN copy required; **[D-7]** |
| Stock state must be displayed and accurate; **no payment for out-of-stock items** | Badge + no order action when out of stock (§6); admin rule: confirm availability before accepting payment in chat | Product/catalogue rules §6 |
| Complaint channels (phone/email) and resolution within 72 hours | Support email/hours + WhatsApp complaint path; owner process | Settings fields; owner runbook |
| Keep transaction records up to 6 years | v1 has no server-side orders: the owner retains the WhatsApp records. If an order log is added later (§19), retain transaction data ≥ 6 years and document it | Owner practice; §19 trigger |
| Analytics/cookies must be disclosed in advance | v1 recommendation: no tracking cookies at all. If analytics is added, disclose in the privacy page (privacy-friendly, cookieless preferred) | §16; **[D-5]** |
| No prohibited/fake goods; respect copyright and IP | The eligibility gate (§3), trademark disclaimer, and the no-affiliation notice cover this posture | §3; footer/legal text |
| VAT/tax receipt details on invoices | Applies mainly to physical goods; keep the owner's practice documented if applicable | Owner practice |

### 13.2 Personal Data Protection Act, 2026 (Act No. 63 of 2026) [S4]

Bangladesh enacted the PDPA in 2026 (in force 10 April 2026; it replaced the 2025 ordinance; some provisions commence later on a date set by Gazette notification; the regulator is not yet operational; the authoritative text is in Bangla).

The v1 data-minimisation posture keeps obligations light — **keep it that way**:

- No customer accounts, no server-side customer PII, no payment data.
- The only optional identifier (Roblox username) stays in the visitor's browser and their own WhatsApp message.
- Admin audit records contain only admin identity.
- Hosting logs: no PII beyond transient IPs in ordinary server logs; 30-day retention (§10).

If processing expands later (order log, analytics with identifiers, marketing), first: define a lawful basis/consent, publish a privacy notice, set retention limits, provide access/deletion handling, review cross-border transfer requirements for the chosen data region, and maintain records of processing (the Act's controller duties include records retained at least five years). Revisit with counsel when the deferred provisions commence. **[D-9]**

### 13.3 IP and marketplace posture

- Roblox and game names are trademarks of their owners; the site uses them descriptively with an explicit "independent shop, not affiliated" disclaimer (already shipped).
- Product imagery must be owner-supplied or licensed; no screenshots implying endorsement.
- BloxBazaar BD is a **single-seller** site, not a marketplace; marketplace-specific duties may not apply — confirm with counsel. **[D-7]**

## 14. Front-end migration and coexistence

Current state: a fully static site whose data lives in `assets/js/config.js` (products, categories, settings) plus `guides-data.js`; an admin prototype persists to `localStorage`; `dataVersion` already invalidates stale local data.

Target: the same screens, fed by the API. No redesign.

1. **Deploy the backend seeded from the current catalogue** — one-time import of all products (including the demo states: draft, needs-review, archived, out-of-stock) preserving `id`, `sku`, `category`, and image paths so no URL breaks.
2. **Add a data layer** — `assets/js/api.js` with a source flag (`BB_DATA_SOURCE = "api" | "static"`). It fetches `/bootstrap` + `/catalogue` + `/products/{id}` (+ guides) and exposes the same `BB_DATA`-shaped object the pages already consume.
3. **Verify parity page-by-page** — home (tiles, featured), catalogue (filters, chips, counts, states), product page (picker, order link, out-of-stock), guides, contact; compare against production static build.
4. **Flip the default** to `api`; keep `static` as the fallback until the backend is stable for one release cycle.
5. **Retire the admin prototype** — `admin.html`/`admin-login.js` wire to the real API; the client-side SHA-256 gate and `localStorage` store (`bb_admin_v1`, `bb_admin_session`, `bb_admin_try`) are removed from production builds.
6. **Keep deep links** — `?category=`, `?cat=`, `?id=`, and the `?state=` previews keep working (previews may remain dev-only via the static fallback).

Rollback: set the flag back to `static`. Once the backend is the source of truth, admin edits happen only there — the seed script is one-way and re-runnable idempotently.

## 15. Testing and acceptance criteria

### 15.1 State matrix (must all pass)

| `publication` | `eligibility` | `stock` | Catalogue listing | Product page | WhatsApp order link | Featured row |
|---|---|---|---|---|---|---|
| draft | any | any | No | 404 | No | No |
| archived | any | any | No | 404 | No | No |
| published | review / rejected / informational | any | No | 404 | No | No |
| published | approved | out | Yes, with badge | Yes, with badge | **No** | No |
| published | approved | in | Yes | Yes | **Yes** | Only if `featured=true` |

### 15.2 Functional and security acceptance (excerpt)

- Version one runs as one deployable application using one managed relational database; optional image storage and managed authentication are the only supporting services required. No microservice, cache, queue, search service, payment provider, Roblox API, or WhatsApp messaging API is introduced without a documented requirement and approval in a later scope.
- A visitor cannot access admin data or change a product by calling an admin route directly (401/403; also test IDOR and method tampering).
- Every new product defaults to Draft and Needs review.
- Public responses never include restricted, rejected, draft, archived, or out-of-stock **order links**; product detail never exposes eligibility notes or admin identities.
- Game guides remain separate from product records and expose no price, stock count, or order link.
- Only an approved, published, in-stock product can produce a WhatsApp order link; the message is pre-filled with correct item details in the visitor's locale and opens the configured number; the customer must press Send. Opening the link creates no order, reserves no stock, triggers no payment.
- Admin changes are validated, timestamped, attributed, and recorded in audit history; a stale second edit gets `409` and loses no data.
- CSRF, rate limits, and sign-in lockout behave as specified; security headers present; uploads enforce type/size and strip metadata.
- A backup can be restored in a documented staging exercise before launch; `/healthz` and monitoring are live.
- Bangla and English content both render; Bangla policy pages exist (DCOG, §13).

### 15.3 Fixtures

Staging seeds mirror the design's demo states (a draft item, a needs-review item, an archived item, an out-of-stock item) so every state in §15.1 is inspectable without editing data.

## 16. Observability and optional analytics

- v1 minimum: structured logs (30-day retention), error tracker with PII scrubbing, uptime monitor, audit trail (§5.2). Alert path to the owner: email or Telegram **[D-2]**.
- Analytics is **not** in v1 by default. If desired, use a privacy-friendly, cookieless tool; disclose it in the privacy page per §13.1; never record WhatsApp message contents or customer identifiers. **[D-5]**

## 17. Open questions and owner decisions

| # | Decision | Needed for |
|---|---|---|
| D-1 | Sale-eligibility policy: which products (if any) get `approved`, with evidence note + review date; counsel review of the posture | §3, seeding |
| D-2 | WhatsApp number (E.164), support email/hours, who answers, alert channel for the owner | §9, §16 |
| D-3 | Guide depth in v1: (a) metadata only + static guide pages, or (b) full guide CMS matching current content | §5, §7 |
| D-4 | Hosting provider + region (Singapore/Mumbai recommendation) + budget sign-off | §4, §12 |
| D-5 | Analytics in v1? (recommended: no; if yes, disclose per DCOG) | §16, §13 |
| D-6 | Admin accounts (who), MFA rollout, where recovery codes live | §7, §10 |
| D-7 | Business identity fields (UBID / trade licence / TIN / VAT), Bangla policy text authorship, counsel review | §13 |
| D-8 | Domain and support email | §13, §16 |
| D-9 | Data-region choice and confirmation that no customer PII will be stored in v1 | §13.2 |
| D-10 | Order-log decision (post-v1; see §19 trigger) | §19 |

## 18. Instruction for an AI backend tool

Implement only the backend scope in this Backend PRD. Keep the public and admin interfaces compatible with the shipped front-end (Appendix A shapes); do not redesign screens. Do not add payment processing, customer accounts, Roblox API integration, automatic WhatsApp sending, or external order handling for restricted Roblox virtual content. Enforce every state rule in §6 on the server, including the order-link guard and the default Draft + Needs review. Use secure defaults per §10, document configuration (README + `.env.example`), and provide a clear API contract for the front-end (Appendix A). Where a decision in §17 is unresolved, implement the safe default and mark it in the code comments — do not invent values (WhatsApp number, prices, eligibility evidence).

## 19. Post-v1 backlog (triggered additions only)

| Addition | Trigger | Notes |
|---|---|---|
| Lightweight order log | Owner needs tracking/dispute records (~> 20 orders/week) | Store only what's needed; ≥ 6-year retention per DCOG; PDPA review (§13.2) |
| Owner notifications (email/Telegram) | Missed chats or trust issues | No customer data leaves the shop's own tooling |
| WhatsApp Business/Cloud API | Volume beyond manual handling; owner opts in | Requires Meta onboarding/business verification; not a v1 concern [S2] |
| Payments (bKash/Nagad/card via a licensed gateway) | Owner wants prepayment | Business/bank requirements; heavy legal + PCI/PDPA review |
| Full guide CMS | D-3 chooses parity content management | Same guide record shape as §5.2 |
| Privacy-friendly analytics | D-5 yes | Cookieless; disclose per DCOG |
| Image CDN transformations | Page-weight targets missed | Same upload pipeline |
| Price history / scheduled publishing | Operational need | Audit already captures history |

## 20. Sources and reference notes

- **S1.** Roblox Terms of Use — https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use — source for the external Robux and virtual-content restriction; the page blocks automated checks, so **re-verify the wording before launch** and whenever the catalogue policy changes.
- **S2.** WhatsApp Help Center — *How to use click to chat* — https://faq.whatsapp.com/5913398998672934 — source for pre-filled message behaviour and international number format; link verified 19 Oct 2026.
- **S3.** Digital Commerce Operation Guidelines 2021 (Ministry of Commerce, Bangladesh; effective 4 July 2021) — gazette; accessible copy: https://deshicommerce.com/wp-content/uploads/2023/07/Bangladesh-Digital-eCommerce-Operation-Guideline-2021.pdf — summary verified 19 Oct 2026 (UBID, Bangla terms, stock display, complaint window, 6-year records, analytics disclosure).
- **S4.** Personal Data Protection Act, 2026 (Act No. 63 of 2026; in force 10 April 2026, replacing the 2025 Ordinance; some provisions commence later per Gazette; Bangla text authoritative) — overviews: https://www.dataguidance.com/jurisdictions/bangladesh and http://www.bdlawpost.com/2026/10/personal-data-protection-act-2026-new.html — verified 19 Oct 2026.
- **S5.** OWASP Application Security Verification Standard (ASVS) 5.0.0 — https://owasp.org/www-project-application-security-verification-standard/ — latest stable confirmed 19 Oct 2026.
- **S6.** OWASP Top 10:2025 — https://top10.owasp.org/2025/ — confirmed 19 Oct 2026.
- **S7.** ITU-T E.164 — international phone-number format — https://www.itu.int/rec/T-REC-E.164.
- **S8.** RFC 9457 — Problem Details for HTTP APIs — https://www.rfc-editor.org/rfc/rfc9457.

---

## Appendix A — Public API examples

`GET /api/v1/bootstrap`

```json
{
  "brand": "BloxBazaar BD",
  "dataVersion": 14,
  "defaultLocale": "bn",
  "whatsappNumber": "",
  "whatsappTemplates": { "product": "", "robux": "" },
  "supportEmail": "",
  "supportHours": { "en": "", "bn": "" },
  "robuxRules": {
    "min": 10, "max": 100000, "defaultAmount": 100,
    "presets": [40, 80, 100, 150, 200, 300, 400, 800, 1000, 2000, 5000, 10000, 25000, 50000, 100000],
    "tiers": [ { "from": 5000, "rate": 0.98 }, { "from": 800, "rate": 1.0 }, { "from": 400, "rate": 1.15 }, { "from": 100, "rate": 1.2 }, { "from": 0, "rate": 1.3 } ]
  },
  "categories": [
    { "id": "robux", "en": "Robux", "bn": "রোবাক্স", "image": "https://img.example/assets/img/products/robux.jpg" }
  ]
}
```

`GET /api/v1/catalogue?category=blox-fruits&page=1&limit=24` (one item shown)

```json
{
  "page": 1, "limit": 24, "total": 9, "dataVersion": 14,
  "items": [
    {
      "id": "bf-fiend",
      "sku": "BB-BF-FIEND",
      "name": { "en": "Fiend — Yeti Mutation", "bn": "ফিন্ড — ইয়েতি মিউটেশন" },
      "category": "blox-fruits",
      "price": 2400,
      "priceFrom": false,
      "listPrice": 2900,
      "robuxAmount": null,
      "tag": { "en": "Event limited", "bn": "ইভেন্ট লিমিটেড" },
      "stock": "in",
      "publication": "published",
      "eligibility": "approved",
      "featured": false,
      "tone": null,
      "monogram": "BF",
      "image": "https://img.example/assets/img/products/bf-fiend.jpg",
      "updated": "2026-10-19",
      "short": { "en": "…", "bn": "…" },
      "description": { "en": "…", "bn": "…" },
      "includes": [ { "en": "…", "bn": "…" } ]
    }
  ]
}
```

`GET /api/v1/products/missing` → `404` example

```json
{ "type": "https://bloxbazaar.example/errors/not-found", "title": "Not found",
  "status": 404, "detail": "No public product with this id." }
```

Guide shape (matches the shipped guide content):

```json
{
  "id": "mm2",
  "name": { "en": "Murder Mystery 2 (MM2)", "bn": "…" },
  "tagline": { "en": "…", "bn": "…" },
  "content": {
    "intro": { "en": "…", "bn": "…" },
    "waysTitle": { "en": "…", "bn": "…" },
    "ways": [ { "title": { "en": "…", "bn": "…" }, "desc": { "en": "…", "bn": "…" }, "link": "https://www.roblox.com/…", "linkLabel": { "en": "…", "bn": "…" } } ],
    "safety": [ { "en": "…", "bn": "…" } ],
    "links": [ { "label": { "en": "…", "bn": "…" }, "url": "https://…", "note": { "en": "…", "bn": "…" } } ]
  },
  "updated": "2026-10-12"
}
```

WhatsApp link (illustrative; built client-side from API data):

```
https://wa.me/8801XXXXXXXXX?text=Hello%20BloxBazaar%20BD%2C%0A%0AI%27d%20like%20to%20order%3A%0A%E2%80%A2%20Item%3A%20Fiend%20%E2%80%94%20Yeti%20Mutation%0A%E2%80%A2%20SKU%3A%20BB-BF-FIEND%0A%E2%80%A2%20Qty%3A%201%0A%E2%80%A2%20Price%3A%20BDT%202%2C400%0A%E2%80%A2%20Link%3A%20https%3A%2F%2Fbloxbazaar.example%2Fproduct.html%3Fid%3Dbf-fiend
```

## Appendix B — Data model (DDL sketch)

```sql
create table category (
  id            text primary key,
  en            text not null,
  bn            text not null,
  image_key     text,
  display_order integer not null default 0,
  visible       boolean not null default true
);

create table product (
  id             text primary key check (id ~ '^[a-z0-9-]{2,64}$'),
  sku            text not null unique,
  name           jsonb not null,
  short          jsonb,
  description    jsonb,
  includes       jsonb not null default '[]',
  category_id    text not null references category(id),
  price          integer not null check (price between 1 and 10000000),
  price_from     boolean not null default false,
  list_price     integer check (list_price is null or list_price >= price),
  robux_amount   integer check (robux_amount is null or robux_amount between 10 and 100000),
  tag            jsonb,
  stock          text not null default 'out'  check (stock in ('in','out')),
  publication    text not null default 'draft' check (publication in ('draft','published','archived')),
  eligibility    text not null default 'review' check (eligibility in ('review','approved','rejected','informational')),
  eligibility_note        text,
  eligibility_reviewed_at timestamptz,
  eligibility_review_due_at date,
  featured       boolean not null default false,
  tone           text check (tone in ('green','sand')),
  monogram       text,
  image_key      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text references admin_user(id),
  version        integer not null default 1
);

create index product_public_idx  on product (publication, eligibility, stock, category_id);
create index product_featured_idx on product (featured)
  where publication = 'published' and eligibility = 'approved' and stock = 'in';

create table guide (
  id          text primary key references category(id),
  name        jsonb not null,
  tagline     jsonb not null,
  content     jsonb not null default '{}',
  publication text not null default 'draft' check (publication in ('draft','published')),
  updated_at  timestamptz not null default now()
);

create table admin_user (
  id              text primary key,            -- provider user id
  email           text not null unique,
  role            text not null check (role in ('owner','editor')),
  active          boolean not null default true,
  mfa_enrolled    boolean not null default false,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now()
);

create table audit_event (
  id             bigserial primary key,
  actor_admin_id text references admin_user(id),
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz not null default now()
);

create index audit_lookup_idx on audit_event (entity_type, entity_id, created_at desc);

create table shop_settings (
  id                        integer primary key default 1 check (id = 1),
  whatsapp_number           text not null default '',
  whatsapp_template_product text not null default '',
  whatsapp_template_robux   text not null default '',
  support_email             text not null default '',
  support_hours             jsonb not null default '{}',
  default_locale            text not null default 'bn',
  brand_name                text not null default 'BloxBazaar BD',
  robux_rules               jsonb not null,
  data_version              integer not null default 1,
  updated_at                timestamptz not null default now(),
  updated_by                text references admin_user(id)
);
```

## Appendix C — Admin permission matrix

| Capability | Owner | Editor |
|---|---|---|
| Sign in (MFA) | ✅ | ✅ |
| View products, guides, audit | ✅ | ✅ |
| Create/edit products, prices, stock, images | ✅ | ✅ |
| Publish / unpublish / archive / restore products | ✅ | ✅ |
| Set `featured` (orderable items only) | ✅ | ✅ |
| Set / change eligibility + evidence note | ✅ | — |
| Edit guides content | ✅ | ✅ (if D-3 = CMS) |
| Edit shop settings (WhatsApp number, Robux rules, support) | ✅ | — |
| Manage admin accounts | ✅ | — |
| View/configure security settings | ✅ | — |

## Appendix D — Changes from v1.1 → v2.0

| # | Change | Why |
|---|---|---|
| 1 | Added §13 (Bangladesh legal baseline: DCOG 2021 + PDPA 2026) | The v1.1 document had no local-law coverage; research confirmed both instruments apply and map to concrete features |
| 2 | Added concrete API contract (Appendices A) and validation rules (§8.2) | v1.1 named surfaces but left shapes undefined; the implementer would otherwise guess and break the shipped front-end |
| 3 | Added full data model + DDL sketch (§5.2, Appendix B) | Field-for-field match with `config.js` so migration is mechanical |
| 4 | Reconciled out-of-stock behaviour (§6) | v1.1 said "hide from default catalogue"; the shipped design shows out-of-stock with a badge and no order action — and DCOG requires displaying stock state |
| 5 | Eligibility workflow made operational (§3, §5.2) | v1.1 had the gate but no evidence/review lifecycle; approval needed a recorded basis and re-review date |
| 6 | Featured rule tightened (§6) | Prevent advertising non-orderable items |
| 7 | Security mapped to ASVS 5.0.0 / Top 10:2025 with concrete controls (§10) | v1.1 was principles-only; sessions, CSRF, uploads, headers, rate numbers now specified |
| 8 | Reliability quantified: RPO/RTO, restore drill, migrations, health (§11) | "Regular backups" is not testable; launch needs numbers and a drill |
| 9 | Performance + caching + `dataVersion` (§12) | Reuses the front-end's existing cache-busting; sets a freshness target (G-1) |
| 10 | Migration plan from the static build (§14) | The repo already ships a static front-end + admin prototype; a staged, reversible cutover protects the live site |
| 11 | Testing expanded to a state matrix + security/reliability tests (§15) | v1.1's acceptance list lacked negative tests and combinations |
| 12 | Owner decisions (§17) + triggered backlog (§19) | Keeps unresolved inputs explicit instead of guessed |
| 13 | Sources expanded and dated (§20) | v1.1 cited two sources; v2.0 adds BD law and OWASP with verification dates |
| 14 | Structural: success criteria (§2.3), invariants (§1), role matrix (Appendix C) | Makes the handoff executable by both humans and AI tools |

## Appendix E — Pre-launch checklist

**Backend**

- [ ] D-1…D-10 decisions recorded (§17)
- [ ] WhatsApp number set in settings and tested (iOS, Android, desktop): correct chat, message intact including Bangla text and line breaks
- [ ] Admin accounts created; MFA enrolled; recovery codes stored offline; client-side demo gate absent from production
- [ ] Eligibility records complete for every published product (note + reviewed date + due date)
- [ ] Staging seeded; parity check vs static build done page-by-page
- [ ] Backup restore drill completed and timed; runbook committed
- [ ] Uptime + error monitoring connected; test alert delivered to owner
- [ ] Security pass: headers/CSP verified, admin routes auth-tested, rate limits and lockout tested, uploads validated
- [ ] Performance spot-check from Dhaka against G-2
- [ ] Budget review done

**Owner / legal**

- [ ] UBID (and trade licence / TIN / VAT as applicable) applied for and displayed
- [ ] Bangla policy pages final: terms, refund/return, delivery/service method, privacy, complaints
- [ ] Roblox and game-publisher terms re-verified; eligibility evidence filed with dates
- [ ] Counsel review of §13 items completed and noted
- [ ] Support email/hours live; 72-hour complaint-response process agreed
- [ ] Trademark / no-affiliation disclaimer live in footer and legal pages
