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
            a.email, a.role, a.active, a.mfa_enrolled
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
