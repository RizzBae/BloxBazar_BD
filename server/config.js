/* =========================================================
   BloxBazaar BD — server/config.js
   Environment-driven server configuration (Backend PRD §4, §10).

   Secrets never live in source. Copy server/.env.example to
   server/.env to override locally; production must inject real
   environment variables (BB_DB_PATH, BB_SEED_ADMIN_PASSWORD, …).
   ========================================================= */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/* Load server/.env when present (Node 20.12+; silently skipped otherwise). */
try {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envFile);
  }
} catch (e) {
  /* A malformed .env should not crash the server at require time; the
     defaults below stay in effect and the operator sees the warning. */
  console.warn("[bb-server] Could not load server/.env:", e.message);
}

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(name, fallback) {
  const n = Number(env(name, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const config = {
  rootDir: ROOT,

  /* Public checkout gate: localhost by default; put a reverse proxy /
     managed host in front for production (PRD §4). */
  port: envInt("PORT", 4173),
  host: env("HOST", "127.0.0.1"),
  trustProxy: env("BB_TRUST_PROXY", "0") === "1",

  /* Storage — the local build uses a SQLite file (see README); the PRD's
     production target is a managed PostgreSQL instance with the same
     schema shape (Appendix B). Uploads go to a local directory here and
     to S3-compatible object storage in production. */
  dbPath: env("BB_DB_PATH", path.join(__dirname, "data", "bloxbazaar.db")),
  uploadsDir: env("BB_UPLOADS_DIR", path.join(__dirname, "data", "uploads")),

  /* Sessions (PRD §7, §10): idle timeout 12 h; "keep me signed in"
     extends the absolute lifetime to ≤ 30 days. */
  sessionIdleHours: envInt("BB_SESSION_IDLE_HOURS", 12),
  sessionAbsoluteHours: envInt("BB_SESSION_HOURS", 12),
  sessionRememberDays: envInt("BB_SESSION_REMEMBER_DAYS", 30),

  /* auto | always | never. "auto" enables Secure cookies when the
     request arrives over https (X-Forwarded-Proto aware). */
  cookieSecure: env("BB_COOKIE_SECURE", "auto"),

  /* Sign-in lockout (PRD §8, §10): per account and per IP, escalating. */
  signinAccountMaxFails: envInt("BB_SIGNIN_ACCOUNT_MAX", 5),
  signinIpMaxFails: envInt("BB_SIGNIN_IP_MAX", 10),
  signinWindowMinutes: envInt("BB_SIGNIN_WINDOW_MIN", 15),

  /* Rate limits (PRD §8). Set to 0 to disable a limiter (local dev). */
  publicRatePerMin: envInt("BB_PUBLIC_RATE_PER_MIN", 120),
  adminReadRatePerMin: envInt("BB_ADMIN_READ_RATE_PER_MIN", 240),
  adminWriteRatePerMin: envInt("BB_ADMIN_WRITE_RATE_PER_MIN", 60),
  uploadRatePerHour: envInt("BB_UPLOAD_RATE_PER_HOUR", 20),

  /* Seeded owner account. CHANGE THE PASSWORD before any real use —
     the default is the design-stage demo password. */
  seedAdminEmail: env("BB_SEED_ADMIN_EMAIL", "owner@bloxbazaar.local"),
  seedAdminPassword: env("BB_SEED_ADMIN_PASSWORD", "BloxBazaar@2026"),
};

module.exports = config;
