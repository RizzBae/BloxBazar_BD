/* =========================================================
   BloxBazaar BD — server/db.js
   SQLite storage layer (node:sqlite, zero dependencies).

   The schema mirrors the Backend PRD Appendix B 1:1: table and
   column names are identical, JSON columns are TEXT holding JSON,
   timestamps are ISO 8601 UTC strings. That keeps the swap to the
   PRD's production PostgreSQL target mechanical (same DDL shape,
   jsonb instead of TEXT, timestamptz instead of TEXT).
   ========================================================= */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS category (
  id            TEXT PRIMARY KEY,
  en            TEXT NOT NULL,
  bn            TEXT NOT NULL,
  image_key     TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  visible       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admin_user (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('owner','editor')),
  active              INTEGER NOT NULL DEFAULT 1,
  mfa_enrolled        INTEGER NOT NULL DEFAULT 0,
  recovery_hash       TEXT,
  recovery_updated_at TEXT,
  last_sign_in_at     TEXT,
  created_at          TEXT NOT NULL
);

/* Login is case-insensitive; keep the stored address unique that way too. */
CREATE UNIQUE INDEX IF NOT EXISTS admin_user_email_lower_idx
  ON admin_user (lower(email));

CREATE TABLE IF NOT EXISTS product (
  id                        TEXT PRIMARY KEY,
  sku                       TEXT NOT NULL UNIQUE,
  name                      TEXT NOT NULL,
  short                     TEXT,
  description               TEXT,
  includes                  TEXT NOT NULL DEFAULT '[]',
  category_id               TEXT NOT NULL REFERENCES category(id),
  price                     INTEGER NOT NULL CHECK (price BETWEEN 1 AND 10000000),
  price_from                INTEGER NOT NULL DEFAULT 0,
  list_price                INTEGER,
  robux_amount              INTEGER,
  tag                       TEXT,
  stock                     TEXT NOT NULL DEFAULT 'out' CHECK (stock IN ('in','out')),
  publication               TEXT NOT NULL DEFAULT 'draft' CHECK (publication IN ('draft','published','archived')),
  eligibility               TEXT NOT NULL DEFAULT 'review' CHECK (eligibility IN ('review','approved','rejected','informational')),
  eligibility_note          TEXT,
  eligibility_reviewed_at   TEXT,
  eligibility_review_due_at TEXT,
  featured                  INTEGER NOT NULL DEFAULT 0,
  tone                      TEXT,
  monogram                  TEXT,
  image_key                 TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  updated_by                TEXT,
  version                   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS product_public_idx
  ON product (publication, eligibility, stock, category_id);

CREATE INDEX IF NOT EXISTS product_featured_idx
  ON product (featured)
  WHERE publication = 'published' AND eligibility = 'approved' AND stock = 'in';

CREATE TABLE IF NOT EXISTS guide (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '{}',
  publication TEXT NOT NULL DEFAULT 'draft' CHECK (publication IN ('draft','published')),
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admin_session (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT NOT NULL REFERENCES admin_user(id),
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_event (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_admin_id TEXT,
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  before         TEXT,
  after          TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_lookup_idx
  ON audit_event (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_settings (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  whatsapp_number           TEXT NOT NULL DEFAULT '',
  whatsapp_template_product TEXT NOT NULL DEFAULT '',
  whatsapp_template_robux   TEXT NOT NULL DEFAULT '',
  support_email             TEXT NOT NULL DEFAULT '',
  support_hours             TEXT NOT NULL DEFAULT '{}',
  default_locale            TEXT NOT NULL DEFAULT 'bn',
  brand_name                TEXT NOT NULL DEFAULT 'BloxBazaar BD',
  robux_rules               TEXT NOT NULL DEFAULT '{}',
  data_version              INTEGER NOT NULL DEFAULT 1,
  version                   INTEGER NOT NULL DEFAULT 1,
  updated_at                TEXT NOT NULL,
  updated_by                TEXT
);
`;

/* Columns added after the first release. Existing dev databases are
   upgraded in place so they keep working without a re-seed. */
const SETTINGS_COLUMNS = [
  ["whatsapp_template_product", "TEXT NOT NULL DEFAULT ''"],
  ["whatsapp_template_robux", "TEXT NOT NULL DEFAULT ''"],
];

const ADMIN_COLUMNS = [
  ["recovery_hash", "TEXT"],
  ["recovery_updated_at", "TEXT"],
];

function migrate(db) {
  const existing = new Set(
    db.prepare("PRAGMA table_info(shop_settings)").all().map(function (c) { return c.name; })
  );
  SETTINGS_COLUMNS.forEach(function (col) {
    if (!existing.has(col[0])) {
      db.exec("ALTER TABLE shop_settings ADD COLUMN " + col[0] + " " + col[1]);
    }
  });

  const adminExisting = new Set(
    db.prepare("PRAGMA table_info(admin_user)").all().map(function (c) { return c.name; })
  );
  ADMIN_COLUMNS.forEach(function (col) {
    if (!adminExisting.has(col[0])) {
      db.exec("ALTER TABLE admin_user ADD COLUMN " + col[0] + " " + col[1]);
    }
  });

  /* The old reset-link flow was removed; drop its legacy table. */
  db.exec("DROP TABLE IF EXISTS admin_password_reset");
}

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function getSettingsRow(db) {
  return db.prepare("SELECT * FROM shop_settings WHERE id = 1").get() || null;
}

function getDataVersion(db) {
  const row = db.prepare("SELECT data_version AS dv FROM shop_settings WHERE id = 1").get();
  return row ? row.dv : 0;
}

/* Any change that affects public output bumps data_version; it is the
   ETag seed and the front-end's cache-busting signal (PRD §12). */
function bumpDataVersion(db) {
  db.prepare("UPDATE shop_settings SET data_version = data_version + 1 WHERE id = 1").run();
  return getDataVersion(db);
}

/* Multi-statement writes run inside a transaction so a failure cannot
   leave mismatched state (PRD §11). */
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (e) { /* already rolled back */ }
    throw err;
  }
}

module.exports = {
  SCHEMA,
  openDatabase,
  nowIso,
  getSettingsRow,
  getDataVersion,
  bumpDataVersion,
  transaction,
};
