/* =========================================================
   BloxBazaar BD â€” server/test/api.test.js
   API test suite (node:test): the PRD Â§6 state rules, auth and
   CSRF hardening, lockout, rate limits, uploads, settings, the
   ETag/304 flow, and the server-side admin page gate.

   Runs against a throwaway database + uploads directory in the
   OS temp folder â€” never the real server/data files.
     npm test        (or: node --test server/test/)
   ========================================================= */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

/* Isolate storage + disable rate limits before server/config.js loads. */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-api-test-"));
process.env.BB_DB_PATH = path.join(tmpRoot, "test.db");
process.env.BB_UPLOADS_DIR = path.join(tmpRoot, "uploads");
process.env.BB_PUBLIC_RATE_PER_MIN = "0";
process.env.BB_ADMIN_READ_RATE_PER_MIN = "0";
process.env.BB_ADMIN_WRITE_RATE_PER_MIN = "0";
process.env.BB_UPLOAD_RATE_PER_HOUR = "0";
process.env.BB_AUTH_RATE_PER_MIN = "0";
process.env.BB_SEED_ADMIN_PASSWORD = "OwnerTestPass@2026";

const config = require("../config");
const { openDatabase } = require("../db");
const { createApp } = require("../app");
const { seedIfEmpty } = require("../seed");
const { hashPassword } = require("../lib/auth");
const sharp = require("sharp");

const db = openDatabase(config.dbPath);
assert.ok(seedIfEmpty(db, config), "a fresh database should seed");

const OWNER = { email: config.seedAdminEmail, password: config.seedAdminPassword };
const EDITOR = { email: "editor@bloxbazaar.local", password: "EditorPass@2026" };

db.prepare(
  "INSERT INTO admin_user (id, email, password_hash, role, active, mfa_enrolled, created_at) VALUES (?,?,?,?,1,0,?)"
).run("adm-editor-test", EDITOR.email, hashPassword(EDITOR.password), "editor", new Date().toISOString());

let baseUrl = "";
let mainServer;
let owner;   /* signed-in owner client */
let dvBefore = 0;
let created = null; /* the product built up through the state-rule tests */

/* ---------- Helpers ---------- */

function newClient(base) {
  const origin = base || baseUrl;
  const jar = new Map();

  async function request(method, url, body, opts) {
    const o = opts || {};
    const headers = {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (jar.size) headers.cookie = Array.from(jar).map(([k, v]) => k + "=" + v).join("; ");
    if (method !== "GET" && method !== "HEAD" && !o.noCsrf) {
      const csrf = jar.get("bb_csrf");
      if (csrf) headers["x-csrf-token"] = o.badCsrf ? csrf + "0" : csrf;
    }
    if (o.headers) Object.assign(headers, o.headers);

    const res = await fetch(origin + url, { method, headers, body: payload, redirect: "manual" });
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(";")[0];
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }
    return { status: res.status, headers: res.headers, body: data };
  }

  return { request, jar };
}

function signIn(client, email, password) {
  return client.request("POST", "/api/v1/admin/session", { email, password });
}

async function startApp(appConfig) {
  const app = createApp({ db, config: appConfig || config });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    base: "http://127.0.0.1:" + server.address().port,
    stop: () => new Promise((resolve) => {
      if (server.closeAllConnections) server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

async function getProduct(id) {
  const res = await owner.request("GET", "/api/v1/admin/products?limit=100");
  assert.equal(res.status, 200);
  return (res.body.items || []).find((p) => p.id === id) || null;
}

before(async () => {
  mainServer = createApp({ db, config }).listen(0, "127.0.0.1");
  await new Promise((resolve) => mainServer.once("listening", resolve));
  baseUrl = "http://127.0.0.1:" + mainServer.address().port;
});

after(async () => {
  if (mainServer.closeAllConnections) mainServer.closeAllConnections();
  await new Promise((resolve) => mainServer.close(resolve));
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/* ---------- Public API (PRD Â§8.1) ---------- */

test("public API: bootstrap, catalogue filters, detail, guides", async () => {
  const c = newClient();

  const health = await c.request("GET", "/healthz");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");

  const boot = await c.request("GET", "/api/v1/bootstrap");
  assert.equal(boot.status, 200);
  assert.equal(typeof boot.body.brand, "string");
  assert.equal(boot.body.categories.length, 5);
  assert.ok(Number.isInteger(boot.body.dataVersion) && boot.body.dataVersion >= 1);

  const cat = await c.request("GET", "/api/v1/catalogue?limit=60");
  assert.equal(cat.status, 200);
  assert.equal(cat.body.total, 26, "29 seeded âˆ’ 2 drafts âˆ’ 1 archived are public");
  assert.equal(cat.body.items.length, 26);
  for (const p of cat.body.items) {
    assert.equal(p.publication, "published");
    assert.equal(p.eligibility, "approved");
    assert.ok(p.name && p.name.en && p.name.bn);
    assert.ok(Number.isInteger(p.price));
    /* Public payloads never leak admin internals. */
    assert.ok(!("version" in p) && !("imageKey" in p) && !("eligibilityNote" in p));
  }

  const avail = await c.request("GET", "/api/v1/catalogue?available=1&limit=60");
  assert.equal(avail.status, 200);
  assert.ok(avail.body.total < 26);
  assert.ok(avail.body.items.every((p) => p.stock === "in"));

  const mm2 = await c.request("GET", "/api/v1/catalogue?category=mm2&limit=60");
  assert.equal(mm2.status, 200);
  assert.ok(mm2.body.items.length > 0);
  assert.ok(mm2.body.items.every((p) => p.category === "mm2"));

  const search = await c.request("GET", "/api/v1/catalogue?q=fiend");
  assert.equal(search.status, 200);
  assert.ok(search.body.items.some((p) => p.id === "bf-fiend"));

  const tooShort = await c.request("GET", "/api/v1/catalogue?q=f");
  assert.equal(tooShort.status, 400);

  const badCat = await c.request("GET", "/api/v1/catalogue?category=nope");
  assert.equal(badCat.status, 400);
  assert.ok(String(badCat.headers.get("content-type")).includes("problem+json"));

  const badPrice = await c.request("GET", "/api/v1/catalogue?min_price=abc");
  assert.equal(badPrice.status, 400);

  const draft = await c.request("GET", "/api/v1/products/mm2-sweet-set");
  assert.equal(draft.status, 404, "drafts are invisible to the public");
  const archived = await c.request("GET", "/api/v1/products/bf-leopard");
  assert.equal(archived.status, 404, "archived products are invisible to the public");

  const fiend = await c.request("GET", "/api/v1/products/bf-fiend");
  assert.equal(fiend.status, 200);
  assert.equal(fiend.body.publication, "published");
  assert.equal(fiend.body.eligibility, "approved");

  const guides = await c.request("GET", "/api/v1/guides");
  assert.equal(guides.status, 200);
  assert.equal(guides.body.items.length, 5);
  assert.equal((await c.request("GET", "/api/v1/guides/robux")).status, 200);
});

test("public reads carry a dataVersion ETag and answer 304 (PRD Â§12)", async () => {
  const c = newClient();
  const first = await c.request("GET", "/api/v1/bootstrap");
  const etag = first.headers.get("etag");
  assert.match(etag, /^W\/"dv\d+"$/);
  assert.ok(String(first.headers.get("cache-control")).includes("max-age=60"));
  dvBefore = Number(/dv(\d+)/.exec(etag)[1]);

  const cached = await c.request("GET", "/api/v1/bootstrap", undefined, { headers: { "if-none-match": etag } });
  assert.equal(cached.status, 304);
});

/* ---------- Auth + CSRF (PRD Â§7, Â§10) ---------- */

test("admin routes require a session; CSRF is enforced on writes", async () => {
  const anon = newClient();

  const noAuth = await anon.request("GET", "/api/v1/admin/products");
  assert.equal(noAuth.status, 401);
  assert.ok(String(noAuth.headers.get("content-type")).includes("problem+json"));

  const wrong = await anon.request("POST", "/api/v1/admin/session", {
    email: "nobody@bloxbazaar.local",
    password: "wrong-password",
  });
  assert.equal(wrong.status, 401);

  owner = newClient();
  const login = await signIn(owner, OWNER.email, OWNER.password);
  assert.equal(login.status, 200);
  assert.equal(login.body.admin.role, "owner");
  assert.ok(owner.jar.get("bb_sess"), "session cookie set");
  assert.ok(owner.jar.get("bb_csrf"), "csrf cookie set");

  const session = await owner.request("GET", "/api/v1/admin/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.admin.email, OWNER.email);

  const payload = { name: { en: "CSRF Probe", bn: "à¦ªà§à¦°à§‹à¦¬" }, category: "robux", price: 100 };
  const noCsrf = await owner.request("POST", "/api/v1/admin/products", payload, { noCsrf: true });
  assert.equal(noCsrf.status, 403);
  const badCsrf = await owner.request("POST", "/api/v1/admin/products", payload, { badCsrf: true });
  assert.equal(badCsrf.status, 403);
});

test("admin list returns the full catalogue with internals", async () => {
  const res = await owner.request("GET", "/api/v1/admin/products?limit=100");
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 29);
  const draft = res.body.items.find((p) => p.id === "mm2-sweet-set");
  assert.equal(draft.publication, "draft");
  const archived = res.body.items.find((p) => p.id === "bf-leopard");
  assert.equal(archived.publication, "archived");
  assert.ok(Number.isInteger(draft.version));
});

/* ---------- State rules (PRD Â§6) ---------- */

test("create defaults are safe: draft + needs review + out of stock", async () => {
  const res = await owner.request("POST", "/api/v1/admin/products", {
    name: { en: "Test Item Alpha", bn: "à¦Ÿà§‡à¦¸à§à¦Ÿ à¦†à¦‡à¦Ÿà§‡à¦® à¦†à¦²à¦«à¦¾" },
    short: { en: "A test item", bn: "à¦à¦•à¦Ÿà¦¿ à¦Ÿà§‡à¦¸à§à¦Ÿ à¦†à¦‡à¦Ÿà§‡à¦®" },
    description: { en: "Created by the test suite.", bn: "à¦Ÿà§‡à¦¸à§à¦Ÿ à¦¸à§à¦¯à§à¦Ÿ à¦¤à§ˆà¦°à¦¿ à¦•à¦°à§‡à¦›à§‡à¥¤" },
    category: "robux",
    price: 500,
  });
  assert.equal(res.status, 201);
  created = res.body;
  assert.equal(created.publication, "draft");
  assert.equal(created.eligibility, "review");
  assert.equal(created.stock, "out");
  assert.equal(created.featured, false);
  assert.equal(created.version, 1);
  assert.ok(created.id.startsWith("test-item-alpha"));
  assert.match(created.sku, /^BB-RB-\d{4}$/);

  const pub = await owner.request("GET", "/api/v1/products/" + created.id);
  assert.equal(pub.status, 404, "drafts stay out of the public API");
});

test("publishing is gated on approval, an image, and Bangla text", async () => {
  let res = await owner.request("POST", `/api/v1/admin/products/${created.id}/publication`, {
    publication: "published",
    version: created.version,
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.some((e) => e.field === "publication"));

  res = await owner.request("POST", `/api/v1/admin/products/${created.id}/eligibility`, {
    eligibility: "approved",
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;
  assert.ok(created.eligibilityNote, "approval records a (placeholder) evidence note");
  assert.ok(created.eligibilityReviewedAt, "approval records the review timestamp");

  res = await owner.request("POST", `/api/v1/admin/products/${created.id}/publication`, {
    publication: "published",
    version: created.version,
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.some((e) => e.field === "imageKey"));

  res = await owner.request("PATCH", `/api/v1/admin/products/${created.id}`, {
    imageKey: "uploads/test-image.png",
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;

  res = await owner.request("POST", `/api/v1/admin/products/${created.id}/publication`, {
    publication: "published",
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;
  assert.equal(created.publication, "published");

  const pub = await owner.request("GET", "/api/v1/products/" + created.id);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.image, "uploads/test-image.png");
});

test("featured requires an orderable item; auto-clears when it stops being orderable", async () => {
  let res = await owner.request("PATCH", `/api/v1/admin/products/${created.id}`, {
    featured: true,
    version: created.version,
  });
  assert.equal(res.status, 422, "out-of-stock items cannot be featured");
  assert.ok(res.body.errors.some((e) => e.field === "featured"));

  res = await owner.request("POST", `/api/v1/admin/products/${created.id}/stock`, {
    stock: "in",
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;

  res = await owner.request("PATCH", `/api/v1/admin/products/${created.id}`, {
    featured: true,
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;
  assert.equal(created.featured, true);

  res = await owner.request("POST", `/api/v1/admin/products/${created.id}/stock`, {
    stock: "out",
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;
  assert.equal(created.featured, false, "going out of stock drops the item from featured");

  res = await owner.request("POST", `/api/v1/admin/products/${created.id}/stock`, {
    stock: "in",
    version: created.version,
  });
  assert.equal(res.status, 200);
  created = res.body;
});

test("optimistic concurrency: 428 without a version, 409 stale, 200 current", async () => {
  const noVersion = await owner.request("PATCH", `/api/v1/admin/products/${created.id}`, {
    tag: { en: "x" },
  });
  assert.equal(noVersion.status, 428);

  const stale = await owner.request("PATCH", `/api/v1/admin/products/${created.id}`, {
    tag: { en: "x" },
    version: 1,
  });
  assert.equal(stale.status, 409);
  const m = /Current version is (\d+)/.exec(stale.body.detail || "");
  assert.ok(m, "the conflict response names the current version");
  assert.equal(Number(m[1]), created.version);

  const ok = await owner.request("PATCH", `/api/v1/admin/products/${created.id}`, {
    tag: { en: "x" },
    version: created.version,
  });
  assert.equal(ok.status, 200);
  created = ok.body;
  assert.equal(created.version, Number(m[1]) + 1);
});

test("published products are archived, never hard-deleted", async () => {
  const del = await owner.request("DELETE", `/api/v1/admin/products/${created.id}?version=${created.version}`);
  assert.equal(del.status, 422);
  assert.ok(String(del.body.detail).toLowerCase().includes("archive"));

  const archive = await owner.request("POST", `/api/v1/admin/products/${created.id}/publication`, {
    publication: "archived",
    version: created.version,
  });
  assert.equal(archive.status, 200);
  created = archive.body;
  assert.equal(created.publication, "archived");
  assert.equal((await owner.request("GET", "/api/v1/products/" + created.id)).status, 404);

  /* Drafts delete cleanly, and the act is recorded. */
  const draft = await owner.request("POST", "/api/v1/admin/products", {
    name: { en: "Delete Me", bn: "à¦®à§à¦›à§‡ à¦«à§‡à¦²à§‹" },
    category: "robux",
    price: 100,
  });
  assert.equal(draft.status, 201);
  const delDraft = await owner.request("DELETE", `/api/v1/admin/products/${draft.body.id}?version=1`);
  assert.equal(delDraft.status, 204);

  const audit = await owner.request("GET", `/api/v1/admin/audit?entity_id=${draft.body.id}`);
  assert.equal(audit.status, 200);
  assert.ok(audit.body.items.some((e) => e.action === "product.delete"));
  assert.equal(audit.body.items[0].actor, OWNER.email);

  /* An archived record is disposable. */
  const delArchived = await owner.request("DELETE", `/api/v1/admin/products/${created.id}?version=${created.version}`);
  assert.equal(delArchived.status, 204);
  created = null;
});

test("editor role cannot approve eligibility or delete products", async () => {
  const editor = newClient();
  const login = await signIn(editor, EDITOR.email, EDITOR.password);
  assert.equal(login.status, 200);
  assert.equal(login.body.admin.role, "editor");

  const draft = await getProduct("sb-cash-pack");
  assert.ok(draft, "the seeded needs-review draft exists");

  const approve = await editor.request("POST", "/api/v1/admin/products/sb-cash-pack/eligibility", {
    eligibility: "approved",
    version: draft.version,
  });
  assert.equal(approve.status, 403);

  const patchApprove = await editor.request("PATCH", "/api/v1/admin/products/sb-cash-pack", {
    eligibility: "approved",
    version: draft.version,
  });
  assert.equal(patchApprove.status, 403);

  const del = await editor.request("DELETE", `/api/v1/admin/products/sb-cash-pack?version=${draft.version}`);
  assert.equal(del.status, 403);

  /* The audit trail names admins, so editors cannot read it. */
  assert.equal((await editor.request("GET", "/api/v1/admin/audit")).status, 403);
});

/* ---------- Settings, guides, uploads ---------- */

test("settings: partial updates merge, validation + version guards apply", async () => {
  const before = await owner.request("GET", "/api/v1/admin/settings");
  assert.equal(before.status, 200);
  assert.equal(typeof before.body.brandName, "string");
  assert.equal(typeof before.body.whatsappTemplateProduct, "string");

  const noVersion = await owner.request("PUT", "/api/v1/admin/settings", { supportEmail: "hello@bloxbazaar.test" });
  assert.equal(noVersion.status, 428);

  const put = await owner.request("PUT", "/api/v1/admin/settings", {
    supportEmail: "hello@bloxbazaar.test",
    version: before.body.version,
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.supportEmail, "hello@bloxbazaar.test");
  assert.equal(put.body.brandName, before.body.brandName, "untouched fields survive a partial write");
  assert.equal(put.body.version, before.body.version + 1);

  const badLocale = await owner.request("PUT", "/api/v1/admin/settings", {
    defaultLocale: "xx",
    version: put.body.version,
  });
  assert.equal(badLocale.status, 422);
  assert.ok(badLocale.body.errors.some((e) => e.field === "defaultLocale"));

  const badWa = await owner.request("PUT", "/api/v1/admin/settings", {
    whatsappNumber: "12",
    version: put.body.version,
  });
  assert.equal(badWa.status, 422);

  /* WhatsApp number + custom order-message templates (admin â†’ Shop
     settings): stored, echoed back, and served on the public bootstrap. */
  const putWa = await owner.request("PUT", "/api/v1/admin/settings", {
    whatsappNumber: "8801700000000",
    whatsappTemplateProduct: "Hi {brand}, I want {name} x{qty} â€” BDT {price}.{robloxIdLine} {url}",
    whatsappTemplateRobux: "Hi {brand}, {amount} Robux â€” BDT {price}.{robloxIdLine} {url}",
    version: put.body.version,
  });
  assert.equal(putWa.status, 200);
  assert.equal(putWa.body.whatsappNumber, "8801700000000");
  assert.equal(putWa.body.whatsappTemplateProduct, "Hi {brand}, I want {name} x{qty} â€” BDT {price}.{robloxIdLine} {url}");
  assert.equal(putWa.body.whatsappTemplateRobux, "Hi {brand}, {amount} Robux â€” BDT {price}.{robloxIdLine} {url}");

  const longTpl = await owner.request("PUT", "/api/v1/admin/settings", {
    whatsappTemplateProduct: "x".repeat(1001),
    version: putWa.body.version,
  });
  assert.equal(longTpl.status, 422);
  assert.ok(longTpl.body.errors.some((e) => e.field === "whatsappTemplateProduct"));

  /* The write bumped dataVersion: old ETags no longer match. */
  const c = newClient();
  const fresh = await c.request("GET", "/api/v1/bootstrap");
  const dvNow = Number(/dv(\d+)/.exec(fresh.headers.get("etag"))[1]);
  assert.ok(dvNow > dvBefore);
  assert.equal(fresh.body.whatsappNumber, "8801700000000");
  assert.deepEqual(fresh.body.whatsappTemplates, {
    product: "Hi {brand}, I want {name} x{qty} â€” BDT {price}.{robloxIdLine} {url}",
    robux: "Hi {brand}, {amount} Robux â€” BDT {price}.{robloxIdLine} {url}",
  });
  const stale = await c.request("GET", "/api/v1/bootstrap", undefined, {
    headers: { "if-none-match": 'W/"dv' + dvBefore + '"' },
  });
  assert.equal(stale.status, 200);

  /* Restore what the suite changed. */
  const now = await owner.request("GET", "/api/v1/admin/settings");
  const restore = await owner.request("PUT", "/api/v1/admin/settings", {
    supportEmail: "",
    whatsappNumber: "",
    whatsappTemplateProduct: "",
    whatsappTemplateRobux: "",
    version: now.body.version,
  });
  assert.equal(restore.status, 200);
  assert.equal(restore.body.supportEmail, "");
  assert.equal(restore.body.whatsappNumber, "");
  assert.equal(restore.body.whatsappTemplateProduct, "");
  assert.equal(restore.body.whatsappTemplateRobux, "");
});

test("uploads: images are re-encoded and served; junk and oversize rejected", async () => {
  const png = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 31, g: 91, b: 63 } },
  }).png().toBuffer();

  const form = new FormData();
  form.append("file", new File([png], "product.png", { type: "image/png" }));
  const up = await owner.request("POST", "/api/v1/admin/uploads", form);
  assert.equal(up.status, 200);
  assert.match(up.body.key, /^uploads\/[0-9a-f-]+\.png$/);
  assert.equal(up.body.url, "/uploads/" + up.body.key.slice("uploads/".length));
  assert.equal(up.body.width, 128);
  assert.equal(up.body.height, 128);

  const served = await fetch(baseUrl + up.body.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.ok(String(served.headers.get("cache-control")).includes("immutable"));

  const small = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  const tinyForm = new FormData();
  tinyForm.append("file", new File([small], "tiny.png", { type: "image/png" }));
  assert.equal((await owner.request("POST", "/api/v1/admin/uploads", tinyForm)).status, 422);

  const fakeForm = new FormData();
  fakeForm.append("file", new File([Buffer.from("this is not an image")], "fake.png", { type: "image/png" }));
  assert.equal((await owner.request("POST", "/api/v1/admin/uploads", fakeForm)).status, 422);

  const bigForm = new FormData();
  bigForm.append("file", new File([Buffer.alloc(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
  assert.equal((await owner.request("POST", "/api/v1/admin/uploads", bigForm)).status, 413);
});

test("guides: list + version-guarded patch", async () => {
  const list = await owner.request("GET", "/api/v1/admin/guides");
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 5);

  const robux = list.body.items.find((g) => g.id === "robux");
  assert.ok(robux);

  const noVersion = await owner.request("PATCH", "/api/v1/admin/guides/robux", { tagline: { en: "x" } });
  assert.equal(noVersion.status, 428);

  const ok = await owner.request("PATCH", "/api/v1/admin/guides/robux", {
    tagline: { en: "Robux guide", bn: "à¦°à§‹à¦¬à¦•à§à¦¸ à¦—à¦¾à¦‡à¦¡" },
    version: robux.version,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, robux.version + 1);

  /* Attribute-breaking URLs never reach the database. */
  const evil = await owner.request("PATCH", "/api/v1/admin/guides/robux", {
    content: {
      links: [{ label: { en: "x" }, url: "https://www.roblox.com/\" onmouseover=\"alert(1)" }],
    },
    version: ok.body.version,
  });
  assert.equal(evil.status, 422);
});

/* ---------- Hardening: lockout, rate limits, page gate ---------- */

test("sign-in lockout escalates and blocks even the right password", async () => {
  const app = await startApp(Object.assign({}, config, {
    signinAccountMaxFails: 3,
    signinIpMaxFails: 1000,
  }));
  try {
    const c = newClient(app.base);
    for (let i = 0; i < 2; i++) {
      const res = await c.request("POST", "/api/v1/admin/session", { email: OWNER.email, password: "wrong" });
      assert.equal(res.status, 401, "attempt " + (i + 1));
    }
    const locking = await c.request("POST", "/api/v1/admin/session", { email: OWNER.email, password: "wrong" });
    assert.equal(locking.status, 429, "the third failure starts the lock");
    assert.ok(Number(locking.headers.get("retry-after")) > 0);

    const locked = await c.request("POST", "/api/v1/admin/session", { email: OWNER.email, password: "wrong" });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);

    const correct = await c.request("POST", "/api/v1/admin/session", { email: OWNER.email, password: OWNER.password });
    assert.equal(correct.status, 429, "the lock applies before the credential check");
  } finally {
    await app.stop();
  }
});

test("public rate limiter returns 429 with Retry-After when the window fills", async () => {
  const app = await startApp(Object.assign({}, config, { publicRatePerMin: 2 }));
  try {
    const c = newClient(app.base);
    assert.equal((await c.request("GET", "/api/v1/bootstrap")).status, 200);
    assert.equal((await c.request("GET", "/api/v1/bootstrap")).status, 200);
    const third = await c.request("GET", "/api/v1/bootstrap");
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
  } finally {
    await app.stop();
  }
});

test("static serving, admin page gate, and security headers", async () => {
  const c = newClient();

  const home = await c.request("GET", "/");
  assert.equal(home.status, 200);
  assert.ok(String(home.headers.get("content-type")).includes("text/html"));
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.ok(String(home.headers.get("content-security-policy")).includes("script-src 'self'"));

  const gate = await c.request("GET", "/admin.html");
  assert.equal(gate.status, 302);
  assert.ok(String(gate.headers.get("location")).startsWith("/admin-login.html?next="));

  assert.equal((await owner.request("GET", "/admin.html")).status, 200);

  assert.equal((await c.request("GET", "/server/db.js")).status, 404);
  assert.equal((await c.request("GET", "/package.json")).status, 404);
  assert.equal((await c.request("GET", "/api/v1/nope")).status, 404);

  /* Percent-encoded paths must not bypass the static allow-list or the gate. */
  const encoded = [
    "/server%2Fconfig.js",
    "/%73erver/db.js",
    "/server%2fdata%2fbloxbazaar.db",
    "/node_modules%2Fexpress%2Fpackage.json",
    "/README.md",
    "/docs/project-overview.md",
    "/assets/..%2fpackage.json",
    "/assets/%2e%2e%2fserver%2fconfig.js",
    "/uploads/%2e%2e%2fserver%2fconfig.js",
  ];
  for (const p of encoded) {
    assert.equal((await c.request("GET", p)).status, 404, p + " must not be served");
  }
  assert.equal((await c.request("GET", "/assets/js/site.js")).status, 200);

  for (const p of ["/admin%2Ehtml", "/%61dmin.html", "/ADMIN.HTML", "/assets/..%2fadmin.html"]) {
    const r = await c.request("GET", p);
    assert.equal(r.status, 302, p + " must still be gated");
    assert.ok(String(r.headers.get("location")).startsWith("/admin-login.html?next="));
  }

  /* Private responses must not be cached or bfcache-restorable. */
  const privateSession = await c.request("GET", "/api/v1/admin/session");
  assert.equal(privateSession.headers.get("cache-control"), "no-store");
  const authedGate = await owner.request("GET", "/admin%2Ehtml");
  assert.equal(authedGate.status, 200);
  assert.equal(authedGate.headers.get("cache-control"), "no-store");
});

test("sign-out destroys the session", async () => {
  const c = newClient();
  assert.equal((await signIn(c, OWNER.email, OWNER.password)).status, 200);
  const out = await c.request("DELETE", "/api/v1/admin/session");
  assert.equal(out.status, 204);
  assert.equal((await c.request("GET", "/api/v1/admin/session")).status, 401);
});

/* ---------- Full CRUD & Persistence Tests ---------- */

test("full CRUD lifecycle: create with monogram, update cross-field rules, filter, toggle stock, and delete", async () => {
  const c = newClient();
  await signIn(c, OWNER.email, OWNER.password);

  // 1. CREATE product without image -> verify monogram generated from initials
  const createRes = await c.request("POST", "/api/v1/admin/products", {
    name: { en: "Mystic Shadow Cloak", bn: "à¦°à¦¹à¦¸à§à¦¯à¦®à¦¯à¦¼ à¦›à¦¾à¦¯à¦¼à¦¾ à¦šà¦¾à¦¦à¦°" },
    short: { en: "A rare cloak", bn: "à¦à¦•à¦Ÿà¦¿ à¦¬à¦¿à¦°à¦² à¦šà¦¾à¦¦à¦°" },
    description: { en: "Full description of mystic shadow cloak.", bn: "à¦°à¦¹à¦¸à§à¦¯à¦®à¦¯à¦¼ à¦›à¦¾à¦¯à¦¼à¦¾ à¦šà¦¾à¦¦à¦°à§‡à¦° à¦¬à¦¿à¦¸à§à¦¤à¦¾à¦°à¦¿à¦¤ à¦¬à¦¿à¦¬à¦°à¦£à¥¤" },
    category: "robux",
    price: 300,
    listPrice: 400,
    robuxAmount: 250,
  });
  assert.equal(createRes.status, 201);
  const item = createRes.body;
  assert.equal(item.monogram, "MS", "Monogram generated from initials");
  assert.equal(item.stock, "out");
  assert.equal(item.publication, "draft");
  assert.equal(item.listPrice, 400);
  assert.equal(item.robuxAmount, 250);

  // 2. READ: test limit up to 500 and search query
  const listRes = await c.request("GET", "/api/v1/admin/products?limit=500&q=mystic");
  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.items.some((p) => p.id === item.id));

  // 3. UPDATE: price raised past listPrice without specifying listPrice -> clears stale listPrice automatically
  const priceUpdate = await c.request("PATCH", `/api/v1/admin/products/${item.id}`, {
    price: 500, // old listPrice was 400, now selling price is 500
    version: item.version,
  });
  assert.equal(priceUpdate.status, 200);
  assert.equal(priceUpdate.body.price, 500);
  assert.equal(priceUpdate.body.listPrice, null, "stale listPrice cleared automatically");

  // 4. UPDATE: category changed from robux to blox-fruits -> clears robuxAmount automatically
  const catUpdate = await c.request("PATCH", `/api/v1/admin/products/${item.id}`, {
    category: "blox-fruits",
    version: priceUpdate.body.version,
  });
  assert.equal(catUpdate.status, 200);
  assert.equal(catUpdate.body.category, "blox-fruits");
  assert.equal(catUpdate.body.robuxAmount, null, "robuxAmount cleared when moving away from robux");

  // 5. UPDATE: toggle stock to 'in'
  const stockIn = await c.request("POST", `/api/v1/admin/products/${item.id}/stock`, {
    stock: "in",
    version: catUpdate.body.version,
  });
  assert.equal(stockIn.status, 200);
  assert.equal(stockIn.body.stock, "in");

  // 6. UPDATE: toggle stock back to 'out'
  const stockOut = await c.request("POST", `/api/v1/admin/products/${item.id}/stock`, {
    stock: "out",
    version: stockIn.body.version,
  });
  assert.equal(stockOut.status, 200);
  assert.equal(stockOut.body.stock, "out");

  // 7. DELETE: draft product is deleted cleanly
  const del = await c.request("DELETE", `/api/v1/admin/products/${item.id}?version=${stockOut.body.version}`);
  assert.equal(del.status, 204);

  // Verify it no longer appears in admin list
  const afterDel = await c.request("GET", `/api/v1/admin/products?q=mystic`);
  assert.equal(afterDel.status, 200);
  assert.ok(!afterDel.body.items.some((p) => p.id === item.id));
});

test("persistence across server restart: SQLite data survives server shutdown and reboot", async () => {
  const restartDbPath = path.join(tmpRoot, "restart-test.db");
  const restartConfig = Object.assign({}, config, { dbPath: restartDbPath });

  // 1. Initial run: open DB, seed, start server
  let testDb = openDatabase(restartDbPath);
  seedIfEmpty(testDb, restartConfig);
  let appInstance = await startApp(restartConfig);
  let client = newClient(appInstance.base);

  // Sign in
  let loginRes = await signIn(client, OWNER.email, OWNER.password);
  assert.equal(loginRes.status, 200);

  // CREATE product
  let createRes = await client.request("POST", "/api/v1/admin/products", {
    name: { en: "Persistent Dragon Sword", bn: "à¦¡à§à¦°à¦¾à¦—à¦¨ à¦¤à¦°à¦¬à¦¾à¦°à¦¿" },
    short: { en: "Will survive server restart", bn: "à¦¸à¦¾à¦°à§à¦­à¦¾à¦° à¦°à¦¿à¦¸à§à¦Ÿà¦¾à¦°à§à¦Ÿà§‡à¦“ à¦Ÿà¦¿à¦•à¦¬à§‡" },
    description: { en: "A sword that proves persistence.", bn: "à¦¸à§à¦¥à¦¾à¦¯à¦¼à¦¿à¦¤à§à¦¬ à¦ªà§à¦°à¦®à¦¾à¦£à¦•à¦¾à¦°à§€ à¦¤à¦°à¦¬à¦¾à¦°à¦¿à¥¤" },
    category: "blox-fruits",
    price: 1500,
  });
  assert.equal(createRes.status, 201);
  const createdId = createRes.body.id;
  assert.equal(createRes.body.monogram, "PD", "auto-generated monogram from name initials");

  // UPDATE product
  let patchRes = await client.request("PATCH", `/api/v1/admin/products/${createdId}`, {
    price: 1750,
    stock: "in",
    version: createRes.body.version,
  });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.price, 1750);
  assert.equal(patchRes.body.stock, "in");

  // UPDATE settings
  let settingsRes = await client.request("GET", "/api/v1/admin/settings");
  assert.equal(settingsRes.status, 200);
  let putSettings = await client.request("PUT", "/api/v1/admin/settings", {
    brandName: "BloxBazaar BD Persistent Store",
    version: settingsRes.body.version,
  });
  assert.equal(putSettings.status, 200);

  // 2. Shut down the server and close SQLite DB connection
  await appInstance.stop();
  testDb.close();

  // 3. Restart server: open DB again and spin up a new server instance
  testDb = openDatabase(restartDbPath);
  appInstance = await startApp(restartConfig);
  client = newClient(appInstance.base);

  // Sign in to new server instance
  loginRes = await signIn(client, OWNER.email, OWNER.password);
  assert.equal(loginRes.status, 200);

  // 4. Verify data persisted!
  let listRes = await client.request("GET", "/api/v1/admin/products?limit=100");
  assert.equal(listRes.status, 200);
  let persistentProduct = listRes.body.items.find((p) => p.id === createdId);
  assert.ok(persistentProduct, "Created product must exist after server restart");
  assert.equal(persistentProduct.price, 1750, "Updated price must persist after restart");
  assert.equal(persistentProduct.stock, "in", "Updated stock must persist after restart");
  assert.equal(persistentProduct.monogram, "PD", "Monogram must persist after restart");

  let freshSettings = await client.request("GET", "/api/v1/admin/settings");
  assert.equal(freshSettings.status, 200);
  assert.equal(freshSettings.body.brandName, "BloxBazaar BD Persistent Store", "Brand name must persist after restart");

  // Clean up
  await appInstance.stop();
  testDb.close();
});


/* ---------- Admin accounts & password recovery ---------- */

async function addAdminViaOwner(email, password, role) {
  const res = await owner.request("POST", "/api/v1/admin/admins", {
    email: email,
    password: password,
    role: role || "editor",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test("admin management: owners list, add, and disable admins; editors are denied", async () => {
  const list = await owner.request("GET", "/api/v1/admin/admins");
  assert.equal(list.status, 200);
  const ownerItem = list.body.items.find((a) => a.email === OWNER.email);
  assert.ok(ownerItem);
  assert.equal(ownerItem.role, "owner");
  assert.equal(ownerItem.hasRecovery, false);
  assert.equal(typeof ownerItem.active, "boolean");
  assert.ok(!("password_hash" in ownerItem), "password hashes never leave the server");
  assert.ok(!("recovery_hash" in ownerItem), "recovery hashes never leave the server");

  const email = "team-editor@bloxbazaar.local";
  const added = await addAdminViaOwner(email, "TeamPass@2026");
  assert.equal(added.admin.role, "editor");
  assert.equal(added.admin.active, true);
  assert.match(added.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const duplicate = await owner.request("POST", "/api/v1/admin/admins", {
    email: email.toUpperCase(),
    password: "AnotherPass@2026",
    role: "editor",
  });
  assert.equal(duplicate.status, 409);

  const weak = await owner.request("POST", "/api/v1/admin/admins", {
    email: "weak-admin@bloxbazaar.local",
    password: "short",
    role: "editor",
  });
  assert.equal(weak.status, 422);
  assert.ok((weak.body.errors || []).some((e) => e.field === "password"));

  const badRole = await owner.request("POST", "/api/v1/admin/admins", {
    email: "role-admin@bloxbazaar.local",
    password: "RolePass@2026",
    role: "superuser",
  });
  assert.equal(badRole.status, 422);

  const editor = newClient();
  assert.equal((await signIn(editor, EDITOR.email, EDITOR.password)).status, 200);
  assert.equal((await editor.request("GET", "/api/v1/admin/admins")).status, 403);
  assert.equal((await editor.request("POST", "/api/v1/admin/admins", {
    email: "editor-created@bloxbazaar.local",
    password: "EditorPass@2026",
    role: "editor",
  })).status, 403);

  const id = added.admin.id;
  const off = await owner.request("PATCH", "/api/v1/admin/admins/" + id, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.admin.active, false);
  assert.equal((await signIn(newClient(), email, "TeamPass@2026")).status, 401);

  const on = await owner.request("PATCH", "/api/v1/admin/admins/" + id, { active: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.admin.active, true);
  assert.equal((await signIn(newClient(), email, "TeamPass@2026")).status, 200);

  const session = await owner.request("GET", "/api/v1/admin/session");
  const selfOff = await owner.request("PATCH", "/api/v1/admin/admins/" + session.body.admin.id, {
    active: false,
  });
  assert.equal(selfOff.status, 422);

  const demote = await owner.request("PATCH", "/api/v1/admin/admins/" + session.body.admin.id, {
    role: "editor",
  });
  assert.equal(demote.status, 422);
  assert.equal(demote.body.title, "Owner required");

  /* Delete guards: self is blocked, editors are denied, delete is permanent. */
  const selfDelete = await owner.request("DELETE", "/api/v1/admin/admins/" + session.body.admin.id);
  assert.equal(selfDelete.status, 422);
  assert.equal(selfDelete.body.title, "Cannot delete yourself");

  assert.equal((await editor.request("DELETE", "/api/v1/admin/admins/" + id)).status, 403);

  const removed = await owner.request("DELETE", "/api/v1/admin/admins/" + id);
  assert.equal(removed.status, 204);
  assert.equal((await signIn(newClient(), email, "TeamPass@2026")).status, 401);
  const afterDelete = await owner.request("GET", "/api/v1/admin/admins");
  assert.ok(!afterDelete.body.items.some((a) => a.id === id), "deleted admin leaves the list");
  assert.equal((await owner.request("DELETE", "/api/v1/admin/admins/" + id)).status, 404);
});

test("account: change email and password; other sessions are revoked", async () => {
  const email = "account-test@bloxbazaar.local";
  const newEmail = "account-test-new@bloxbazaar.local";
  const finalEmail = "account-test-final@bloxbazaar.local";
  const oldPassword = "AccountPass@2026";
  const newPassword = "AccountNewPass@2026";
  await addAdminViaOwner(email, oldPassword);

  const c1 = newClient();
  const c2 = newClient();
  assert.equal((await signIn(c1, email, oldPassword)).status, 200);
  assert.equal((await signIn(c2, email, oldPassword)).status, 200);

  const noChange = await c1.request("POST", "/api/v1/admin/account", {
    email: email,
    currentPassword: oldPassword,
    newPassword: "",
  });
  assert.equal(noChange.status, 422);

  const wrong = await c1.request("POST", "/api/v1/admin/account", {
    email: newEmail,
    currentPassword: "WrongPass@2026",
    newPassword: newPassword,
  });
  assert.equal(wrong.status, 403);
  assert.ok((wrong.body.errors || []).some((e) => e.field === "currentPassword"));

  const changed = await c1.request("POST", "/api/v1/admin/account", {
    email: newEmail,
    currentPassword: oldPassword,
    newPassword: newPassword,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.passwordChanged, true);
  assert.equal(changed.body.admin.email, newEmail);

  const selfSession = await c1.request("GET", "/api/v1/admin/session");
  assert.equal(selfSession.status, 200);
  assert.equal(selfSession.body.admin.email, newEmail);
  assert.equal((await c2.request("GET", "/api/v1/admin/session")).status, 401);

  assert.equal((await signIn(newClient(), email, oldPassword)).status, 401);
  assert.equal((await signIn(newClient(), newEmail, oldPassword)).status, 401);
  assert.equal((await signIn(newClient(), newEmail, newPassword)).status, 200);

  const emailOnly = await c1.request("POST", "/api/v1/admin/account", {
    email: finalEmail,
    currentPassword: newPassword,
    newPassword: "",
  });
  assert.equal(emailOnly.status, 200);
  assert.equal(emailOnly.body.passwordChanged, false);
  assert.equal(emailOnly.body.admin.email, finalEmail);

  const taken = await c1.request("POST", "/api/v1/admin/account", {
    email: OWNER.email,
    currentPassword: newPassword,
    newPassword: "",
  });
  assert.equal(taken.status, 409);
});

test("recovery code: one-time reset rotates the code, revokes sessions, and locks out guesses", async () => {
  const email = "recover-test@bloxbazaar.local";
  const oldPassword = "RecoverPass@2026";
  const newPassword = "RecoverNewPass@2026";
  await addAdminViaOwner(email, oldPassword);

  const c1 = newClient();
  assert.equal((await signIn(c1, email, oldPassword)).status, 200);

  const wrongCurrent = await c1.request("POST", "/api/v1/admin/account/recovery", {
    currentPassword: "WrongPass@2026",
  });
  assert.equal(wrongCurrent.status, 403);

  const generated = await c1.request("POST", "/api/v1/admin/account/recovery", {
    currentPassword: oldPassword,
  });
  assert.equal(generated.status, 200);
  const code1 = generated.body.recoveryCode;
  assert.match(code1, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const session = await c1.request("GET", "/api/v1/admin/session");
  assert.equal(session.body.admin.hasRecovery, true);

  const c2 = newClient();
  assert.equal((await signIn(c2, email, oldPassword)).status, 200);

  const weak = await newClient().request("POST", "/api/v1/admin/password/recover", {
    email: email,
    recoveryCode: code1,
    password: "short",
  });
  assert.equal(weak.status, 422);

  const wrong = await newClient().request("POST", "/api/v1/admin/password/recover", {
    email: email,
    recoveryCode: "AAAA-BBBB-CCCC",
    password: newPassword,
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.detail, "Incorrect email or recovery code.");

  const ok = await newClient().request("POST", "/api/v1/admin/password/recover", {
    email: email,
    recoveryCode: code1,
    password: newPassword,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const code2 = ok.body.recoveryCode;
  assert.notEqual(code2, code1);
  assert.match(code2, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  assert.equal((await c1.request("GET", "/api/v1/admin/session")).status, 401);
  assert.equal((await c2.request("GET", "/api/v1/admin/session")).status, 401);
  assert.equal((await signIn(newClient(), email, oldPassword)).status, 401);
  assert.equal((await signIn(newClient(), email, newPassword)).status, 200);

  const reuse = await newClient().request("POST", "/api/v1/admin/password/recover", {
    email: email,
    recoveryCode: code1,
    password: "AnotherPass@2026",
  });
  assert.equal(reuse.status, 401, "the old recovery code must be dead");

  const second = await newClient().request("POST", "/api/v1/admin/password/recover", {
    email: email,
    recoveryCode: code2,
    password: "AnotherPass@2026",
  });
  assert.equal(second.status, 200);
  const code3 = second.body.recoveryCode;

  /* Five bad guesses lock the account even when a valid code follows. */
  let last;
  for (let i = 0; i < 5; i += 1) {
    last = await newClient().request("POST", "/api/v1/admin/password/recover", {
      email: email,
      recoveryCode: "ZZZZ-ZZZZ-ZZZZ",
      password: "AnotherPass@2026",
    });
  }
  assert.equal(last.status, 429);
  const lockedOut = await newClient().request("POST", "/api/v1/admin/password/recover", {
    email: email,
    recoveryCode: code3,
    password: "FinalPass@2026",
  });
  assert.equal(lockedOut.status, 429);
});
