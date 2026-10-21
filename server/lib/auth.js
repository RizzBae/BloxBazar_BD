/* =========================================================
   BloxBazaar BD — server/lib/auth.js
   Password hashing (scrypt), server-side sessions, CSRF, and
   role checks (PRD §7, §10).

   The production PRD calls for a managed auth provider with MFA
   (PRD §10). This module is the self-hosted equivalent used by
   the local build and keeps the same session semantics:
   HttpOnly cookie, 12 h idle timeout, ≤ 30 days absolute with
   "keep me signed in", CSRF on every write, lockout on failures.
   MFA enrolment stays a pre-launch item (see README).
   ========================================================= */

"use strict";

const crypto = require("node:crypto");
const { nowIso } = require("../db");
const { sendProblem } = require("./problem");

const COOKIE_SESSION = "bb_sess";
const COOKIE_CSRF = "bb_csrf";

/* A real scrypt hash used for missing accounts so a failed sign-in spends the
   same work whether or not the email exists. */
const DUMMY_PASSWORD_HASH = "scrypt:2139f1b96519df554bae31bf2ee6f8ee:3e3098716b9c2c4fc94c3e7c3373c9a95ab232227124e5de49235673ce622b22c4a7d125ae38d61bee3ead58bb2bbb12eed3f668a134094e43a5c26f8053df9c";

/* ---------- Passwords ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const calc = crypto.scryptSync(String(password), parts[1], 64);
    const want = Buffer.from(parts[2], "hex");
    return calc.length === want.length && crypto.timingSafeEqual(calc, want);
  } catch (e) {
    return false;
  }
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/* ---------- Password policy & recovery ---------- */

const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 200;
const EMAIL_MAX_LENGTH = 254;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_LENGTH = 12;

/* Returns a human-readable problem, or null when the password passes. */
function passwordProblem(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return "Password must be at least " + PASSWORD_MIN_LENGTH + " characters.";
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return "Password must be at most " + PASSWORD_MAX_LENGTH + " characters.";
  }
  return null;
}

/* Email doubles as the admin username. Stored lowercase. */
function emailProblem(email) {
  if (typeof email !== "string") return "Enter a valid email address.";
  const value = email.trim();
  if (!value || value.length > EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a valid email address.";
  }
  return null;
}

/* ---------- Recovery code ----------
   A recovery code is the no-email fallback for a forgotten password.
   It is high-entropy, stored only as a SHA-256 hash, and replaced
   every time it is used. Format: XXXX-XXXX-XXXX (dashes optional). */

function generateRecoveryCode() {
  const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out.slice(0, 4) + "-" + out.slice(4, 8) + "-" + out.slice(8);
}

function normalizeRecoveryCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function recoveryCodeHash(value) {
  return sha256Hex(normalizeRecoveryCode(value));
}

/* Stores a fresh code hash and returns the plaintext once. */
function setAdminRecoveryCode(db, adminId) {
  const code = generateRecoveryCode();
  db.prepare(
    "UPDATE admin_user SET recovery_hash = ?, recovery_updated_at = ? WHERE id = ?"
  ).run(recoveryCodeHash(code), nowIso(), adminId);
  return code;
}

function verifyRecoveryCode(row, code) {
  const stored = row && row.recovery_hash ? String(row.recovery_hash) : "0".repeat(64);
  return safeEqual(recoveryCodeHash(code), stored);
}

/* Sets a new password and revokes every session for that account
   (PRD §10: a reset signs the admin out everywhere). */
function setAdminPassword(db, adminId, password) {
  db.prepare("UPDATE admin_user SET password_hash = ? WHERE id = ?")
    .run(hashPassword(password), adminId);
  db.prepare("DELETE FROM admin_session WHERE admin_id = ?").run(adminId);
}

/* ---------- Cookies ---------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) return;
    try { out[key] = decodeURIComponent(value); } catch (e) { out[key] = value; }
  });
  return out;
}

function getCookie(req, name) {
  return parseCookies(req.headers.cookie)[name];
}

function useSecureCookie(req, config) {
  if (config.cookieSecure === "always") return true;
  if (config.cookieSecure === "never") return false;
  return !!req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookies(res, req, config, session) {
  const base = {
    path: "/",
    sameSite: "lax",
    secure: useSecureCookie(req, config),
  };
  const sessionCookieOpts = Object.assign({}, base, { httpOnly: true });
  const csrfCookieOpts = Object.assign({}, base);
  if (session.remember) {
    sessionCookieOpts.maxAge = session.absoluteMs;
    csrfCookieOpts.maxAge = session.absoluteMs;
  }
  res.cookie(COOKIE_SESSION, session.token, sessionCookieOpts);
  res.cookie(COOKIE_CSRF, session.csrf, csrfCookieOpts);
}

function clearSessionCookies(res) {
  res.clearCookie(COOKIE_SESSION, { path: "/" });
  res.clearCookie(COOKIE_CSRF, { path: "/" });
}

/* ---------- Sessions ---------- */

function createSession(db, adminId, config, remember) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const absoluteMs = remember
    ? config.sessionRememberDays * 86400000
    : config.sessionAbsoluteHours * 3600000;
  db.prepare(
    `INSERT INTO admin_session (id, admin_id, csrf, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sha256Hex(token), adminId, csrf, nowIso(), nowIso(), new Date(now + absoluteMs).toISOString());
  return { token, csrf, absoluteMs, remember: !!remember };
}

function loadSession(db, req, config) {
  const token = getCookie(req, COOKIE_SESSION);
  if (!token) return null;
  const id = sha256Hex(token);
  const row = db.prepare(
    `SELECT s.id, s.admin_id, s.csrf, s.expires_at, s.last_seen_at,
            a.email, a.role, a.active, a.mfa_enrolled, a.recovery_hash
       FROM admin_session s
       JOIN admin_user a ON a.id = s.admin_id
      WHERE s.id = ?`
  ).get(id);
  if (!row) return null;

  const now = Date.now();
  const expired = Date.parse(row.expires_at) <= now;
  const idle = now - Date.parse(row.last_seen_at) > config.sessionIdleHours * 3600000;
  if (expired || idle || !row.active) {
    db.prepare("DELETE FROM admin_session WHERE id = ?").run(id);
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > 60000) {
    db.prepare("UPDATE admin_session SET last_seen_at = ? WHERE id = ?").run(nowIso(), id);
  }
  return {
    sessionId: id,
    csrf: row.csrf,
    admin: {
      id: row.admin_id,
      email: row.email,
      role: row.role,
      mfaEnrolled: !!row.mfa_enrolled,
      hasRecovery: !!row.recovery_hash,
    },
  };
}

function destroySession(db, sessionId) {
  db.prepare("DELETE FROM admin_session WHERE id = ?").run(sessionId);
}

function purgeExpiredSessions(db) {
  db.prepare("DELETE FROM admin_session WHERE expires_at <= ?").run(nowIso());
}

/* ---------- Middleware ---------- */

function requireAuth(db, config) {
  return function (req, res, next) {
    const session = loadSession(db, req, config);
    if (!session) {
      return sendProblem(res, 401, "Unauthorized", "Sign in with an admin account to use this endpoint.");
    }
    req.session = session;
    req.admin = session.admin;
    next();
  };
}

function requireOwner(req, res, next) {
  if (!req.admin || req.admin.role !== "owner") {
    return sendProblem(res, 403, "Forbidden", "This action requires the owner role.");
  }
  next();
}

function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token") || "";
  if (!req.session || !token || !safeEqual(token, req.session.csrf)) {
    return sendProblem(res, 403, "Forbidden", "Missing or invalid CSRF token.");
  }
  /* Defence in depth: a browser origin, when sent, must match this host. */
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch (e) { ok = false; }
    if (!ok) return sendProblem(res, 403, "Forbidden", "Cross-origin admin requests are rejected.");
  }
  next();
}

module.exports = {
  COOKIE_SESSION,
  COOKIE_CSRF,
  hashPassword,
  verifyPassword,
  passwordProblem,
  emailProblem,
  DUMMY_PASSWORD_HASH,
  generateRecoveryCode,
  normalizeRecoveryCode,
  setAdminRecoveryCode,
  verifyRecoveryCode,
  setAdminPassword,
  sha256Hex,
  getCookie,
  setSessionCookies,
  clearSessionCookies,
  createSession,
  loadSession,
  destroySession,
  purgeExpiredSessions,
  requireAuth,
  requireOwner,
  requireCsrf,
};
