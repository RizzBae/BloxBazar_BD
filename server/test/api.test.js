/* =========================================================
   BloxBazaar BD — server/test/api.test.js
   API test suite (node:test): the PRD §6 state rules, auth and
   CSRF hardening, lockout, rate limits, uploads, settings, the
   ETag/304 flow, and the server-side admin page gate.

   Runs against a throwaway database + uploads directory in the
   OS temp folder — never the real server/data files.
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

/* ---------- Public API (PRD §8.1) ---------- */

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
  assert.equal(cat.body.total, 26, "29 seeded − 2 drafts − 1 archived are public");
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

test("public reads carry a dataVersion ETag and answer 304 (PRD §12)", async () => {
  const c = newClient();
  const first = await c.request("GET", "/api/v1/bootstrap");
  const etag = first.headers.get("etag");
  assert.match(etag, /^W\/"dv\d+"$/);
  assert.ok(String(first.headers.get("cache-control")).includes("max-age=60"));
  dvBefore = Number(/dv(\d+)/.exec(etag)[1]);

  const cached = await c.request("GET", "/api/v1/bootstrap", undefined, { headers: { "if-none-match": etag } });
  assert.equal(cached.status, 304);
});

/* ---------- Auth + CSRF (PRD §7, §10) ---------- */

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

  const payload = { name: { en: "CSRF Probe", bn: "প্রোব" }, category: "robux", price: 100 };
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

/* ---------- State rules (PRD §6) ---------- */

test("create defaults are safe: draft + needs review + out of stock", async () => {
  const res = await owner.request("POST", "/api/v1/admin/products", {
    name: { en: "Test Item Alpha", bn: "টেস্ট আইটেম আলফা" },
    short: { en: "A test item", bn: "একটি টেস্ট আইটেম" },
    description: { en: "Created by the test suite.", bn: "টেস্ট স্যুট তৈরি করেছে।" },
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
    name: { en: "Delete Me", bn: "মুছে ফেলো" },
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

  /* WhatsApp number + custom order-message templates (admin → Shop
     settings): stored, echoed back, and served on the public bootstrap. */
  const putWa = await owner.request("PUT", "/api/v1/admin/settings", {
    whatsappNumber: "8801700000000",
    whatsappTemplateProduct: "Hi {brand}, I want {name} x{qty} — BDT {price}.{robloxIdLine} {url}",
    whatsappTemplateRobux: "Hi {brand}, {amount} Robux — BDT {price}.{robloxIdLine} {url}",
    version: put.body.version,
  });
  assert.equal(putWa.status, 200);
  assert.equal(putWa.body.whatsappNumber, "8801700000000");
  assert.equal(putWa.body.whatsappTemplateProduct, "Hi {brand}, I want {name} x{qty} — BDT {price}.{robloxIdLine} {url}");
  assert.equal(putWa.body.whatsappTemplateRobux, "Hi {brand}, {amount} Robux — BDT {price}.{robloxIdLine} {url}");

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
    product: "Hi {brand}, I want {name} x{qty} — BDT {price}.{robloxIdLine} {url}",
    robux: "Hi {brand}, {amount} Robux — BDT {price}.{robloxIdLine} {url}",
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
    tagline: { en: "Robux guide", bn: "রোবক্স গাইড" },
    version: robux.version,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, robux.version + 1);
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
    name: { en: "Mystic Shadow Cloak", bn: "রহস্যময় ছায়া চাদর" },
    short: { en: "A rare cloak", bn: "একটি বিরল চাদর" },
    description: { en: "Full description of mystic shadow cloak.", bn: "রহস্যময় ছায়া চাদরের বিস্তারিত বিবরণ।" },
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
    name: { en: "Persistent Dragon Sword", bn: "ড্রাগন তরবারি" },
    short: { en: "Will survive server restart", bn: "সার্ভার রিস্টার্টেও টিকবে" },
    description: { en: "A sword that proves persistence.", bn: "স্থায়িত্ব প্রমাণকারী তরবারি।" },
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

