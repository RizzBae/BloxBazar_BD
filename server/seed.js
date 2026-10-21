/* =========================================================
   BloxBazaar BD — server/seed.js
   One-time import from the static catalogue (PRD §14).

   Reads assets/js/config.js and assets/js/guides-data.js in a
   sandbox and writes their contents into the database. Re-runs
   are idempotent: existing rows are kept, so admin edits are
   never overwritten by a later seed.
   ========================================================= */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { openDatabase, nowIso, getSettingsRow } = require("./db");
const { hashPassword } = require("./lib/auth");

const INSERT_PRODUCT_OR_IGNORE = `INSERT OR IGNORE INTO product (
  id, sku, name, short, description, includes, category_id, price, price_from,
  list_price, robux_amount, tag, stock, publication, eligibility, eligibility_note,
  eligibility_reviewed_at, eligibility_review_due_at, featured, tone, monogram,
  image_key, created_at, updated_at, updated_by, version
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

function loadBrowserGlobal(filePath, globalName) {
  const source = fs.readFileSync(filePath, "utf8");
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(source, context, { filename: path.basename(filePath) });
  return context.window[globalName];
}

function j(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function isoFromDay(day) {
  const date = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10);
  return date + "T00:00:00.000Z";
}

function seedAll(db, options) {
  const rootDir = options.rootDir;
  const seedConfig = options.config || {};
  const bb = loadBrowserGlobal(path.join(rootDir, "assets", "js", "config.js"), "BB_DATA");
  const guides = loadBrowserGlobal(path.join(rootDir, "assets", "js", "guides-data.js"), "BB_GUIDES");

  const report = {
    settings: false,
    admin: null,
    categories: 0,
    products: 0,
    productsSkipped: 0,
    guides: 0,
    guidesSkipped: 0,
  };

  const seedNote = "Imported from the static catalogue on " + nowIso().slice(0, 10) +
    " — owner records the evidence basis and review date (PRD decision D-1).";
  const generatedPassword = !seedConfig.seedAdminPassword;
  const seedPassword = seedConfig.seedAdminPassword ||
    ("BB-" + crypto.randomBytes(9).toString("base64url"));

  db.exec("BEGIN IMMEDIATE");
  try {
    /* Shop settings (single row). */
    if (!getSettingsRow(db)) {
      const tpl = bb.whatsappTemplates || {};
      db.prepare(
        `INSERT INTO shop_settings (id, whatsapp_number, whatsapp_template_product, whatsapp_template_robux,
         support_email, support_hours, default_locale,
         brand_name, robux_rules, data_version, version, updated_at, updated_by)
         VALUES (1, ?, ?, ?, '', ?, 'bn', ?, ?, ?, 1, ?, NULL)`
      ).run(
        String(bb.whatsappNumber || ""),
        String(tpl.product || ""),
        String(tpl.robux || ""),
        JSON.stringify({ en: "", bn: "" }),
        String(bb.brand || "BloxBazaar BD"),
        JSON.stringify(bb.robuxRules || {}),
        Number(bb.dataVersion) || 1,
        nowIso()
      );
      report.settings = true;
    }

    /* Categories. */
    const insertCategory = db.prepare(
      "INSERT OR IGNORE INTO category (id, en, bn, image_key, display_order, visible) VALUES (?,?,?,?,?,1)"
    );
    (bb.categories || []).forEach(function (c, index) {
      const r = insertCategory.run(c.id, String(c.en || c.id), String(c.bn || c.en || c.id), c.image || null, index);
      if (r.changes) report.categories += r.changes;
    });

    /* Owner account. */
    const existingAdmin = db.prepare("SELECT id FROM admin_user WHERE lower(email) = lower(?)")
      .get(seedConfig.seedAdminEmail);
    if (!existingAdmin) {
      db.prepare(
        `INSERT INTO admin_user (id, email, password_hash, role, active, mfa_enrolled, created_at)
         VALUES (?, ?, ?, 'owner', 1, 0, ?)`
      ).run(crypto.randomUUID(), seedConfig.seedAdminEmail, hashPassword(seedPassword), nowIso());
      report.admin = seedConfig.seedAdminEmail;
      if (generatedPassword) report.adminPassword = seedPassword;
    }

    /* Products — every seeded state is preserved (draft, needs-review,
       archived, out-of-stock) so the admin table renders as designed. */
    const insertProduct = db.prepare(INSERT_PRODUCT_OR_IGNORE);
    (bb.products || []).forEach(function (p) {
      const updatedAt = isoFromDay(p.updated);
      const eligibility = p.eligibility || "review";
      const r = insertProduct.run(
        p.id,
        p.sku,
        j(p.name),
        j(p.short),
        j(p.description),
        JSON.stringify(p.includes || []),
        p.category,
        Number(p.price),
        p.priceFrom ? 1 : 0,
        p.listPrice === undefined ? null : p.listPrice,
        p.robuxAmount === undefined ? null : p.robuxAmount,
        j(p.tag),
        p.stock || "out",
        p.publication || "draft",
        eligibility,
        eligibility === "approved" ? seedNote : null,
        eligibility === "approved" ? updatedAt : null,
        null,
        p.featured ? 1 : 0,
        p.tone || null,
        p.monogram || null,
        p.image || null,
        updatedAt,
        updatedAt,
        "seed-import",
        1
      );
      if (r.changes) report.products += r.changes;
      else report.productsSkipped += 1;
    });

    /* Guides. */
    const insertGuide = db.prepare(
      "INSERT OR IGNORE INTO guide (id, name, tagline, content, publication, updated_at, version) VALUES (?,?,?,?,?,?,1)"
    );
    Object.keys(guides || {}).forEach(function (key) {
      const g = guides[key];
      const content = {};
      ["idx", "monogram", "tone", "intro", "waysTitle", "ways", "safety", "links"].forEach(function (field) {
        if (g[field] !== undefined && g[field] !== "") content[field] = g[field];
      });
      const r = insertGuide.run(
        g.id || key,
        j(g.name),
        j(g.tagline),
        JSON.stringify(content),
        "published",
        isoFromDay(g.updated)
      );
      if (r.changes) report.guides += r.changes;
      else report.guidesSkipped += 1;
    });

    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (e) { /* already rolled back */ }
    throw err;
  }

  return report;
}

/* Called by the server entry point: seeds only an empty database. */
function seedIfEmpty(db, seedConfig) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM product").get().n;
  if (count > 0) return null;
  return seedAll(db, { rootDir: seedConfig.rootDir, config: seedConfig });
}

module.exports = { seedAll, seedIfEmpty };

if (require.main === module) {
  const config = require("./config");
  const db = openDatabase(config.dbPath);
  const report = seedAll(db, { rootDir: config.rootDir, config });
  const adminPassword = report.adminPassword;
  delete report.adminPassword;
  console.log("[bb-seed] Import complete:");
  console.log(JSON.stringify(report, null, 2));
  console.log("[bb-seed] Admin sign-in: " + config.seedAdminEmail);
  if (adminPassword) {
    console.log("[bb-seed] First-run owner password: " + adminPassword);
    console.log("[bb-seed] Save it now, then change it in Shop settings.");
  }
  db.close();
}
