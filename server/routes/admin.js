/* =========================================================
   BloxBazaar BD — server/routes/admin.js
   Authenticated admin API (PRD §7, §8): session, product
   management with the eligibility/stock/publication guards,
   uploads, shop settings, guides, and the audit trail.

   Every state rule from PRD §6 is enforced here, server-side:
   nothing becomes public without an explicit approval record,
   out-of-stock products never carry order data, and records
   are archived rather than hard-deleted.
   ========================================================= */

"use strict";

const crypto = require("node:crypto");
const express = require("express");
const multer = require("multer");
const { nowIso, getSettingsRow, bumpDataVersion, transaction } = require("../db");
const { sendProblem, fieldError } = require("../lib/problem");
const {
  verifyPassword,
  hashPassword,
  passwordProblem,
  emailProblem,
  DUMMY_PASSWORD_HASH,
  normalizeRecoveryCode,
  setAdminRecoveryCode,
  verifyRecoveryCode,
  setAdminPassword,
  createSession,
  destroySession,
  setSessionCookies,
  clearSessionCookies,
  requireAuth,
  requireOwner,
  requireCsrf,
  purgeExpiredSessions,
} = require("../lib/auth");
const {
  validateProduct,
  validateSettings,
  validateGuidePatch,
  PUBLICATIONS,
  STOCKS,
  ELIGIBILITIES,
} = require("../lib/validate");
const {
  adminProduct,
  adminGuide,
  settingsPayload,
  parseJson,
  dateOnly,
} = require("../lib/serialize");
const { createLimiter, createLockout } = require("../lib/ratelimit");
const { processUpload } = require("../lib/images");

const PRODUCT_CATEGORY_CODES = {
  robux: "RB",
  "blox-fruits": "BF",
  mm2: "M2",
  rivals: "RV",
  "steal-a-brainrot": "SB",
};

const INSERT_PRODUCT_SQL = `INSERT INTO product (
  id, sku, name, short, description, includes, category_id, price, price_from,
  list_price, robux_amount, tag, stock, publication, eligibility, eligibility_note,
  eligibility_reviewed_at, eligibility_review_due_at, featured, tone, monogram,
  image_key, created_at, updated_at, updated_by, version
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

const UPDATE_PRODUCT_SQL = `UPDATE product SET
  sku = ?, name = ?, short = ?, description = ?, includes = ?, category_id = ?, price = ?, price_from = ?,
  list_price = ?, robux_amount = ?, tag = ?, stock = ?, publication = ?, eligibility = ?, eligibility_note = ?,
  eligibility_reviewed_at = ?, eligibility_review_due_at = ?, featured = ?, tone = ?, monogram = ?, image_key = ?,
  updated_at = ?, updated_by = ?, version = ?
  WHERE id = ?`;

function jsonOrNull(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

module.exports = function adminRoutes(db, config) {
  const router = express.Router();

  /* Session, account, recovery, and admin data must never be stored by a
     browser cache or a shared proxy. */
  router.use(function (req, res, next) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  const readLimiter = createLimiter({
    windowMs: 60000,
    max: config.adminReadRatePerMin,
    keyFn: (req) => "rd:" + (req.admin ? req.admin.id : req.ip),
  });
  const writeLimiter = createLimiter({
    windowMs: 60000,
    max: config.adminWriteRatePerMin,
    keyFn: (req) => "wr:" + (req.admin ? req.admin.id : req.ip),
  });
  const uploadLimiter = createLimiter({
    windowMs: 3600000,
    max: config.uploadRatePerHour,
    keyFn: (req) => "up:" + (req.admin ? req.admin.id : req.ip),
  });

  const lockoutAccount = createLockout({
    maxFails: config.signinAccountMaxFails,
    windowMs: config.signinWindowMinutes * 60000,
    baseLockMs: 15 * 60000,
  });
  const lockoutIp = createLockout({
    maxFails: config.signinIpMaxFails,
    windowMs: config.signinWindowMinutes * 60000,
    baseLockMs: 15 * 60000,
  });

  /* Sign-in and password-recovery attempts, keyed by IP. */
  const authLimiter = createLimiter({
    windowMs: 60000,
    max: config.authRatePerMin,
    keyFn: (req) => "auth:" + req.ip,
  });

  /* A recovery code is the only credential on the public reset endpoint,
     so failed guesses are locked out per account and per IP. */
  const recoveryWindowMs = Math.max(1, config.recoveryWindowMin) * 60000;
  const recoveryAccountLockout = createLockout({
    maxFails: Math.max(1, config.recoveryAccountMax),
    windowMs: recoveryWindowMs,
    baseLockMs: recoveryWindowMs,
  });
  const recoveryIpLockout = createLockout({
    maxFails: Math.max(1, config.recoveryIpMax),
    windowMs: recoveryWindowMs,
    baseLockMs: recoveryWindowMs,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 4, parts: 8 },
  });

  function audit(actorId, action, entityType, entityId, before, after) {
    db.prepare(
      `INSERT INTO audit_event (actor_admin_id, action, entity_type, entity_id, before, after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actorId, action, entityType, entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      nowIso()
    );
  }

  /* Admin rows never leave the server with password/recovery hashes. */
  function adminUser(row) {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      active: !!row.active,
      mfaEnrolled: !!row.mfa_enrolled,
      hasRecovery: !!row.recovery_hash,
      lastSignInAt: row.last_sign_in_at || null,
      createdAt: row.created_at,
    };
  }

  function getAdmin(id) {
    return db.prepare("SELECT * FROM admin_user WHERE id = ?").get(id);
  }

  function otherActiveOwners(id) {
    return db.prepare(
      "SELECT COUNT(*) AS n FROM admin_user WHERE role = 'owner' AND active = 1 AND id <> ?"
    ).get(id).n;
  }

  function getProduct(id) {
    return db.prepare("SELECT * FROM product WHERE id = ?").get(id);
  }

  function versionFrom(req) {
    const ifMatch = req.get("if-match");
    if (ifMatch) {
      const m = /"?(\d+)"?/.exec(ifMatch);
      if (m) return Number(m[1]);
    }
    const source = req.body && req.body.version !== undefined
      ? req.body.version
      : req.query.version;
    if (source === undefined || source === null || source === "") return null;
    const n = Number(source);
    return Number.isInteger(n) ? n : null;
  }

  /* 428 when the client forgot the version; 409 when it is stale (PRD §6, §8). */
  function checkVersion(req, res, record) {
    const version = versionFrom(req);
    if (version === null) {
      sendProblem(res, 428, "Precondition required", "Include the record version (body \"version\" or If-Match).");
      return null;
    }
    if (version !== record.version) {
      sendProblem(res, 409, "Version conflict", `This record was updated elsewhere. Current version is ${record.version}.`);
      return null;
    }
    return version;
  }

  function slugify(text) {
    const s = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return s.length >= 2 ? s : "item";
  }

  function uniqueId(base) {
    let id = base;
    let i = 2;
    while (db.prepare("SELECT id FROM product WHERE id = ?").get(id)) {
      id = base + "-" + i;
      i += 1;
    }
    return id;
  }

  function generateSku(categoryId, price) {
    const code = PRODUCT_CATEGORY_CODES[categoryId] || "XX";
    const amount = Number.isFinite(Number(price)) ? String(Number(price)).padStart(4, "0") : "0000";
    return "BB-" + code + "-" + amount;
  }

  function uniqueSku(base) {
    let sku = base;
    let i = 2;
    while (db.prepare("SELECT id FROM product WHERE sku = ?").get(sku)) {
      sku = base + "-" + i;
      i += 1;
    }
    return sku;
  }

  function defaultEligibilityNote() {
    return "Approved from the admin panel on " + dateOnly(nowIso()) +
      " — the owner records the evidence basis and review date (PRD decision D-1).";
  }

  function isOrderable(doc) {
    return doc.publication === "published" && doc.eligibility === "approved" && doc.stock === "in";
  }

  /* Guards for the final merged record (PRD §6). */
  function writeGuards(finalDoc, opts) {
    const errors = [];
    if (finalDoc.publication === "published") {
      if (finalDoc.eligibility !== "approved") {
        errors.push(fieldError("publication", "Only products approved for external sale can be published (PRD §3)."));
      }
      if (!finalDoc.name || !finalDoc.name.bn) {
        errors.push(fieldError("name", "Bangla text is required before publishing."));
      }
      if (!finalDoc.imageKey) {
        errors.push(fieldError("imageKey", "A product image is required before publishing."));
      }
    }
    if (opts && opts.featuredExplicit && finalDoc.featured === true && !isOrderable(finalDoc)) {
      errors.push(fieldError("featured", "Only published, approved, in-stock items can be featured."));
    }
    return errors;
  }

  /* Merge validated values into a row, run the guards, and persist with
     audit + version + data_version. Returns { errors } or { updated }. */
  function applyProductUpdate(row, values, admin, action) {
    const merged = adminProduct(row);
    Object.keys(values).forEach(function (key) {
      if (values[key] !== undefined) merged[key] = values[key];
    });

    if (values.eligibility !== undefined && values.eligibility !== row.eligibility) {
      merged.eligibilityReviewedAt = nowIso();
    }
    if (merged.eligibility === "approved" && !merged.eligibilityNote) {
      merged.eligibilityNote = defaultEligibilityNote();
    }

    const errors = writeGuards(merged, { featuredExplicit: values.featured === true });
    if (errors.length) return { errors };

    /* A write that makes an item non-orderable drops it from the
       featured surface automatically (PRD §6). */
    if (merged.featured === true && !isOrderable(merged)) merged.featured = false;

    merged.updatedAt = nowIso();
    merged.updatedBy = admin.id;
    merged.version = row.version + 1;

    const updated = transaction(db, function () {
      db.prepare(UPDATE_PRODUCT_SQL).run(
        merged.sku,
        jsonOrNull(merged.name),
        jsonOrNull(merged.short),
        jsonOrNull(merged.description),
        JSON.stringify(merged.includes || []),
        merged.category,
        merged.price,
        merged.priceFrom ? 1 : 0,
        merged.listPrice === undefined ? null : merged.listPrice,
        merged.robuxAmount === undefined ? null : merged.robuxAmount,
        jsonOrNull(merged.tag),
        merged.stock,
        merged.publication,
        merged.eligibility,
        merged.eligibilityNote === undefined ? null : merged.eligibilityNote,
        merged.eligibilityReviewedAt === undefined ? null : merged.eligibilityReviewedAt,
        merged.eligibilityReviewDueAt === undefined ? null : merged.eligibilityReviewDueAt,
        merged.featured ? 1 : 0,
        merged.tone === undefined ? null : merged.tone,
        merged.monogram === undefined ? null : merged.monogram,
        merged.imageKey === undefined ? null : merged.imageKey,
        merged.updatedAt,
        merged.updatedBy,
        merged.version,
        row.id
      );
      const next = getProduct(row.id);
      audit(admin.id, action, "product", row.id, adminProduct(row), adminProduct(next));
      bumpDataVersion(db);
      return adminProduct(next);
    });

    return { updated };
  }

  /* ================= Session ================= */

  router.post("/session", function (req, res) {
    const body = req.body || {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || email.length > 254 || password.length > 200) {
      return sendProblem(res, 400, "Invalid request", "Email and password are required.");
    }

    const ipKey = "ip:" + req.ip;
    const accountKey = "acct:" + email;
    const locked = Math.max(lockoutIp.check(ipKey), lockoutAccount.check(accountKey));
    if (locked > 0) {
      res.setHeader("Retry-After", String(locked));
      return sendProblem(res, 429, "Too many attempts", `Too many sign-in attempts. Try again in ${locked} seconds.`);
    }

    purgeExpiredSessions(db);
    const user = db.prepare("SELECT * FROM admin_user WHERE lower(email) = lower(?)").get(email);
    const passwordOk = verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    const valid = !!(user && user.active && passwordOk);

    if (!valid) {
      const ipJustLocked = lockoutIp.fail(ipKey);
      const acctJustLocked = lockoutAccount.fail(accountKey);
      const justLocked = Math.max(ipJustLocked, acctJustLocked);
      if (justLocked > 0) {
        res.setHeader("Retry-After", String(justLocked));
        return sendProblem(res, 429, "Too many attempts", `Too many sign-in attempts. Try again in ${justLocked} seconds.`);
      }
      return sendProblem(res, 401, "Sign-in failed", "Incorrect email or password.");
    }

    lockoutIp.success(ipKey);
    lockoutAccount.success(accountKey);
    db.prepare("UPDATE admin_user SET last_sign_in_at = ? WHERE id = ?").run(nowIso(), user.id);

    const session = createSession(db, user.id, config, !!body.remember);
    setSessionCookies(res, req, config, session);
    res.json({
      admin: {
        id: user.id,
        email: user.email,
        role: user.role,
        mfaEnrolled: !!user.mfa_enrolled,
        hasRecovery: !!user.recovery_hash,
      },
    });
  });

  /* ================= Password recovery =================
     No email is sent. The admin proves ownership with the recovery
     code saved from their account page (or issued by the CLI). The
     code is single-use: a successful reset returns a fresh one and
     revokes every session. */

  router.post("/password/recover", authLimiter, function (req, res) {
    const body = req.body || {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const recoveryCode = normalizeRecoveryCode(body.recoveryCode);
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || recoveryCode.length !== 12 || emailProblem(email)) {
      return sendProblem(res, 400, "Invalid request", "Enter your email and recovery code.");
    }
    const problem = passwordProblem(password);
    if (problem) {
      return sendProblem(res, 422, "Validation failed", "Choose a stronger password.", [
        fieldError("password", problem),
      ]);
    }

    const ipKey = "rec-ip:" + req.ip;
    const accountKey = "rec-acct:" + email;
    const locked = Math.max(
      recoveryIpLockout.check(ipKey),
      recoveryAccountLockout.check(accountKey)
    );
    if (locked > 0) {
      res.setHeader("Retry-After", String(locked));
      return sendProblem(
        res, 429, "Too many attempts",
        `Too many recovery attempts. Try again in ${locked} seconds.`
      );
    }

    const user = db.prepare("SELECT * FROM admin_user WHERE lower(email) = lower(?)").get(email);
    const codeOk = verifyRecoveryCode(user, recoveryCode);
    if (!user || !user.active || !codeOk) {
      const ipLock = recoveryIpLockout.fail(ipKey);
      const accountLock = recoveryAccountLockout.fail(accountKey);
      const justLocked = Math.max(ipLock, accountLock);
      if (justLocked > 0) {
        res.setHeader("Retry-After", String(justLocked));
        return sendProblem(
          res, 429, "Too many attempts",
          `Too many recovery attempts. Try again in ${justLocked} seconds.`
        );
      }
      return sendProblem(res, 401, "Recovery failed", "Incorrect email or recovery code.");
    }

    const newCode = transaction(db, function () {
      setAdminPassword(db, user.id, password);
      const code = setAdminRecoveryCode(db, user.id);
      audit(user.id, "auth.password.recovered", "admin_user", user.id, null, {
        via: "recovery_code",
      });
      return code;
    });

    recoveryIpLockout.success(ipKey);
    recoveryAccountLockout.success(accountKey);
    lockoutIp.success("ip:" + req.ip);
    lockoutAccount.success("acct:" + email);

    res.json({ ok: true, recoveryCode: newCode });
  });

  /* Everything below requires an authenticated session (PRD §10). */
  router.use(requireAuth(db, config));

  router.get("/session", readLimiter, function (req, res) {
    res.json({ admin: req.admin });
  });

  router.delete("/session", requireCsrf, function (req, res) {
    destroySession(db, req.session.sessionId);
    clearSessionCookies(res);
    res.status(204).end();
  });

  /* ================= Account (self-service) ================= */

  router.post("/account", authLimiter, writeLimiter, requireCsrf, function (req, res) {
    const body = req.body || {};
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    const user = getAdmin(req.admin.id);
    if (!user) return sendProblem(res, 401, "Unauthorized", "Sign in again to continue.");

    const wantsEmail = newEmail !== String(user.email).toLowerCase();
    const wantsPassword = newPassword.length > 0;
    if (!wantsEmail && !wantsPassword) {
      return sendProblem(
        res, 422, "Nothing to update",
        "Change your email or choose a new password."
      );
    }
    if (currentPassword.length > 200 || !verifyPassword(currentPassword, user.password_hash)) {
      return sendProblem(res, 403, "Incorrect password", "Your current password is incorrect.", [
        fieldError("currentPassword", "Your current password is incorrect."),
      ]);
    }

    if (wantsEmail) {
      const problem = emailProblem(newEmail);
      if (problem) {
        return sendProblem(res, 422, "Validation failed", problem, [
          fieldError("email", problem),
        ]);
      }
      const clash = db.prepare(
        "SELECT id FROM admin_user WHERE lower(email) = lower(?) AND id <> ?"
      ).get(newEmail, user.id);
      if (clash) {
        return sendProblem(res, 409, "Email already in use", "Another admin already uses that email.", [
          fieldError("email", "Another admin already uses that email."),
        ]);
      }
    }

    if (wantsPassword) {
      const problem = passwordProblem(newPassword);
      if (problem) {
        return sendProblem(res, 422, "Validation failed", "Choose a stronger password.", [
          fieldError("password", problem),
        ]);
      }
    }

    transaction(db, function () {
      if (wantsEmail) {
        db.prepare("UPDATE admin_user SET email = ? WHERE id = ?").run(newEmail, user.id);
        audit(user.id, "admin.email.changed", "admin_user", user.id,
          { email: user.email }, { email: newEmail });
      }
      if (wantsPassword) {
        setAdminPassword(db, user.id, newPassword);
        audit(user.id, "admin.password.changed", "admin_user", user.id, null, {
          via: "account",
        });
      }
    });

    /* A password change revoked every session including this one, so
       issue a fresh session for the tab that made the change. */
    if (wantsPassword) {
      const session = createSession(db, user.id, config, false);
      setSessionCookies(res, req, config, session);
    }

    res.json({
      ok: true,
      passwordChanged: wantsPassword,
      admin: adminUser(getAdmin(user.id)),
    });
  });

  router.post("/account/recovery", authLimiter, writeLimiter, requireCsrf, function (req, res) {
    const body = req.body || {};
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const user = getAdmin(req.admin.id);
    if (!user) return sendProblem(res, 401, "Unauthorized", "Sign in again to continue.");
    if (currentPassword.length > 200 || !verifyPassword(currentPassword, user.password_hash)) {
      return sendProblem(res, 403, "Incorrect password", "Your current password is incorrect.", [
        fieldError("currentPassword", "Your current password is incorrect."),
      ]);
    }

    const code = setAdminRecoveryCode(db, user.id);
    audit(user.id, "admin.recovery.generated", "admin_user", user.id, null, null);
    res.json({ ok: true, recoveryCode: code });
  });

  /* ================= Admins (owner only) ================= */

  router.get("/admins", readLimiter, requireOwner, function (req, res) {
    const items = db.prepare(
      `SELECT * FROM admin_user
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC`
    ).all().map(adminUser);
    res.json({ items });
  });

  router.post("/admins", writeLimiter, requireCsrf, requireOwner, function (req, res) {
    const body = req.body || {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role === undefined ? "editor" : body.role;

    const emailErr = emailProblem(email);
    if (emailErr) {
      return sendProblem(res, 422, "Validation failed", emailErr, [fieldError("email", emailErr)]);
    }
    const pwErr = passwordProblem(password);
    if (pwErr) {
      return sendProblem(res, 422, "Validation failed", "Choose a stronger password.", [
        fieldError("password", pwErr),
      ]);
    }
    if (role !== "owner" && role !== "editor") {
      return sendProblem(res, 422, "Validation failed", "Choose the owner or editor role.", [
        fieldError("role", "Choose the owner or editor role."),
      ]);
    }

    const clash = db.prepare("SELECT id FROM admin_user WHERE lower(email) = lower(?)").get(email);
    if (clash) {
      return sendProblem(res, 409, "Email already in use", "Another admin already uses that email.", [
        fieldError("email", "Another admin already uses that email."),
      ]);
    }

    const id = crypto.randomUUID();
    const recoveryCode = transaction(db, function () {
      db.prepare(
        `INSERT INTO admin_user
           (id, email, password_hash, role, active, mfa_enrolled, last_sign_in_at, created_at)
         VALUES (?, ?, ?, ?, 1, 0, NULL, ?)`
      ).run(id, email, hashPassword(password), role, nowIso());
      const code = setAdminRecoveryCode(db, id);
      audit(req.admin.id, "admin.created", "admin_user", id, null, { email, role });
      return code;
    });

    res.status(201).json({ admin: adminUser(getAdmin(id)), recoveryCode });
  });

  router.patch("/admins/:id", writeLimiter, requireCsrf, requireOwner, function (req, res) {
    const body = req.body || {};
    const target = getAdmin(req.params.id);
    if (!target) return sendProblem(res, 404, "Not found", "That admin account does not exist.");

    const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
    const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
    const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
    if (!hasEmail && !hasRole && !hasActive) {
      return sendProblem(res, 422, "Nothing to update", "Change the email, role, or status.");
    }

    let email = target.email;
    let role = target.role;
    let active = !!target.active;

    if (hasEmail) {
      email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const problem = emailProblem(email);
      if (problem) {
        return sendProblem(res, 422, "Validation failed", problem, [fieldError("email", problem)]);
      }
      const clash = db.prepare(
        "SELECT id FROM admin_user WHERE lower(email) = lower(?) AND id <> ?"
      ).get(email, target.id);
      if (clash) {
        return sendProblem(res, 409, "Email already in use", "Another admin already uses that email.", [
          fieldError("email", "Another admin already uses that email."),
        ]);
      }
    }
    if (hasRole) {
      role = body.role;
      if (role !== "owner" && role !== "editor") {
        return sendProblem(res, 422, "Validation failed", "Choose the owner or editor role.", [
          fieldError("role", "Choose the owner or editor role."),
        ]);
      }
    }
    if (hasActive) {
      if (typeof body.active !== "boolean") {
        return sendProblem(res, 422, "Validation failed", "Active must be true or false.", [
          fieldError("active", "Active must be true or false."),
        ]);
      }
      active = body.active;
    }

    if (target.id === req.admin.id && !active) {
      return sendProblem(
        res, 422, "Cannot deactivate yourself",
        "You cannot deactivate the account you are signed in with."
      );
    }
    if (target.role === "owner" && target.active && (role !== "owner" || !active)) {
      if (otherActiveOwners(target.id) === 0) {
        return sendProblem(
          res, 422, "Owner required",
          "Keep at least one active owner account."
        );
      }
    }

    transaction(db, function () {
      db.prepare("UPDATE admin_user SET email = ?, role = ?, active = ? WHERE id = ?")
        .run(email, role, active ? 1 : 0, target.id);
      if (!active) {
        db.prepare("DELETE FROM admin_session WHERE admin_id = ?").run(target.id);
      }
      audit(req.admin.id, "admin.updated", "admin_user", target.id,
        { email: target.email, role: target.role, active: !!target.active },
        { email, role, active });
    });

    res.json({ admin: adminUser(getAdmin(target.id)) });
  });

  router.delete("/admins/:id", writeLimiter, requireCsrf, requireOwner, function (req, res) {
    const target = getAdmin(req.params.id);
    if (!target) return sendProblem(res, 404, "Not found", "That admin account does not exist.");

    if (target.id === req.admin.id) {
      return sendProblem(
        res, 422, "Cannot delete yourself",
        "You cannot delete the account you are signed in with."
      );
    }
    if (target.role === "owner" && target.active && otherActiveOwners(target.id) === 0) {
      return sendProblem(res, 422, "Owner required", "Keep at least one active owner account.");
    }

    transaction(db, function () {
      db.prepare("DELETE FROM admin_session WHERE admin_id = ?").run(target.id);
      audit(req.admin.id, "admin.deleted", "admin_user", target.id,
        { email: target.email, role: target.role, active: !!target.active }, null);
      db.prepare("DELETE FROM admin_user WHERE id = ?").run(target.id);
    });

    res.status(204).end();
  });

  /* ================= Products ================= */

  router.get("/products", readLimiter, function (req, res) {
    const where = [];
    const params = [];
    const state = String(req.query.state || "all");
    if (state === "in") where.push("stock = 'in'");
    else if (state === "out") where.push("stock = 'out'");
    else if (state === "review") where.push("eligibility = 'review'");
    else if (state === "draft") where.push("publication = 'draft'");
    else if (state === "archived") where.push("publication = 'archived'");

    const q = String(req.query.q || "").trim();
    if (q) {
      const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
      where.push(
        "(json_extract(name, '$.en') LIKE ? ESCAPE '\\'" +
        " OR json_extract(name, '$.bn') LIKE ? ESCAPE '\\'" +
        " OR sku LIKE ? ESCAPE '\\')"
      );
      params.push(like, like, like);
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const sqlWhere = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM product ${sqlWhere}`).get(...params).n;
    const rows = db.prepare(
      `SELECT * FROM product ${sqlWhere} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`
    ).all(...params, limit, (page - 1) * limit);

    res.json({ page, limit, total, items: rows.map(adminProduct) });
  });

  router.post("/products", writeLimiter, requireCsrf, function (req, res) {
    const { errors, values } = validateProduct(db, req.body || {}, { isCreate: true });
    if (errors.length) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", errors);
    }
    if (req.admin.role !== "owner" && values.eligibility !== undefined && values.eligibility !== "review") {
      return sendProblem(res, 403, "Forbidden", "Only the owner can set the eligibility state.");
    }

    const now = nowIso();
    const defaultMonogram = values.name && values.name.en
      ? values.name.en.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("").slice(0, 4) || "BB"
      : null;

    const doc = {
      id: values.id || uniqueId(slugify(values.name.en)),
      sku: values.sku || uniqueSku(generateSku(values.category, values.price)),
      name: values.name,
      short: values.short || null,
      description: values.description || null,
      includes: values.includes || [],
      category: values.category,
      price: values.price,
      priceFrom: values.priceFrom === true,
      listPrice: values.listPrice !== undefined ? values.listPrice : null,
      robuxAmount: values.robuxAmount !== undefined ? values.robuxAmount : null,
      tag: values.tag !== undefined ? values.tag : null,
      stock: values.stock || "out",          /* never sell by accident (PRD §5.2) */
      publication: values.publication || "draft",
      eligibility: values.eligibility || "review",
      eligibilityNote: values.eligibilityNote !== undefined ? values.eligibilityNote : null,
      eligibilityReviewedAt: values.eligibility === "approved" ? now : null,
      eligibilityReviewDueAt: values.eligibilityReviewDueAt !== undefined ? values.eligibilityReviewDueAt : null,
      featured: values.featured === true,
      tone: values.tone !== undefined ? values.tone : null,
      monogram: values.monogram !== undefined ? values.monogram : defaultMonogram,
      imageKey: values.imageKey !== undefined ? values.imageKey : null,
    };
    if (doc.eligibility === "approved" && !doc.eligibilityNote) {
      doc.eligibilityNote = defaultEligibilityNote();
    }

    const guardErrors = writeGuards(doc, { featuredExplicit: values.featured === true });
    if (guardErrors.length) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", guardErrors);
    }

    const created = transaction(db, function () {
      db.prepare(INSERT_PRODUCT_SQL).run(
        doc.id, doc.sku, jsonOrNull(doc.name), jsonOrNull(doc.short), jsonOrNull(doc.description),
        JSON.stringify(doc.includes), doc.category, doc.price, doc.priceFrom ? 1 : 0,
        doc.listPrice, doc.robuxAmount, jsonOrNull(doc.tag), doc.stock, doc.publication,
        doc.eligibility, doc.eligibilityNote, doc.eligibilityReviewedAt, doc.eligibilityReviewDueAt,
        doc.featured ? 1 : 0, doc.tone, doc.monogram, doc.imageKey,
        now, now, req.admin.id, 1
      );
      const row = getProduct(doc.id);
      audit(req.admin.id, "product.create", "product", doc.id, null, adminProduct(row));
      bumpDataVersion(db);
      return adminProduct(row);
    });

    res.status(201).json(created);
  });

  router.patch("/products/:id", writeLimiter, requireCsrf, function (req, res) {
    const row = getProduct(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No product with this id.");
    if (checkVersion(req, res, row) === null) return;

    const { errors, values } = validateProduct(db, req.body || {}, { existing: row });
    if (errors.length) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", errors);
    }
    if (req.admin.role !== "owner" && values.eligibility !== undefined && values.eligibility !== row.eligibility) {
      return sendProblem(res, 403, "Forbidden", "Only the owner can change the eligibility state.");
    }

    const result = applyProductUpdate(row, values, req.admin, "product.update");
    if (result.errors) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", result.errors);
    }
    res.json(result.updated);
  });

  router.post("/products/:id/publication", writeLimiter, requireCsrf, function (req, res) {
    const row = getProduct(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No product with this id.");
    if (checkVersion(req, res, row) === null) return;

    const publication = req.body && req.body.publication;
    if (PUBLICATIONS.indexOf(publication) === -1) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", [
        fieldError("publication", "Must be draft, published, or archived."),
      ]);
    }
    const result = applyProductUpdate(row, { publication }, req.admin, "product.publication");
    if (result.errors) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", result.errors);
    }
    res.json(result.updated);
  });

  router.post("/products/:id/stock", writeLimiter, requireCsrf, function (req, res) {
    const row = getProduct(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No product with this id.");
    if (checkVersion(req, res, row) === null) return;

    const stock = req.body && req.body.stock;
    if (STOCKS.indexOf(stock) === -1) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", [
        fieldError("stock", "Must be \"in\" or \"out\"."),
      ]);
    }
    const result = applyProductUpdate(row, { stock }, req.admin, "product.stock");
    if (result.errors) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", result.errors);
    }
    res.json(result.updated);
  });

  router.post("/products/:id/eligibility", writeLimiter, requireCsrf, requireOwner, function (req, res) {
    const row = getProduct(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No product with this id.");
    if (checkVersion(req, res, row) === null) return;

    const body = req.body || {};
    if (ELIGIBILITIES.indexOf(body.eligibility) === -1) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", [
        fieldError("eligibility", "Must be review, approved, rejected, or informational."),
      ]);
    }
    const values = { eligibility: body.eligibility };
    if (body.note !== undefined) values.eligibilityNote = body.note === "" ? null : String(body.note).slice(0, 2000);
    if (body.review_due_at !== undefined) {
      if (body.review_due_at === null || body.review_due_at === "") values.eligibilityReviewDueAt = null;
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.review_due_at))) {
        return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", [
          fieldError("review_due_at", "Use the YYYY-MM-DD format."),
        ]);
      } else {
        values.eligibilityReviewDueAt = String(body.review_due_at);
      }
    }

    const result = applyProductUpdate(row, values, req.admin, "product.eligibility");
    if (result.errors) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", result.errors);
    }
    res.json(result.updated);
  });

  router.delete("/products/:id", writeLimiter, requireCsrf, requireOwner, function (req, res) {
    const row = getProduct(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No product with this id.");
    if (checkVersion(req, res, row) === null) return;

    /* Published history is never destroyed silently (PRD §1, §6). */
    if (row.publication === "published") {
      return sendProblem(res, 422, "Validation failed", "Unpublish or archive this product first.", [
        fieldError("publication", "Published products cannot be deleted — archive them first."),
      ]);
    }

    transaction(db, function () {
      audit(req.admin.id, "product.delete", "product", row.id, adminProduct(row), null);
      db.prepare("DELETE FROM product WHERE id = ?").run(row.id);
      bumpDataVersion(db);
    });
    res.status(204).end();
  });

  /* ================= Uploads ================= */

  router.post("/uploads", uploadLimiter, requireCsrf, upload.single("file"), function (req, res, next) {
    if (!req.file) {
      return sendProblem(res, 422, "Validation failed", "Attach a file field named \"file\".", [
        fieldError("file", "A file is required."),
      ]);
    }
    processUpload(req.file.buffer, config.uploadsDir)
      .then(function (result) { res.json(result); })
      .catch(next);
  });

  /* ================= Shop settings ================= */

  router.get("/settings", readLimiter, function (req, res) {
    res.json(settingsPayload(getSettingsRow(db)));
  });

  router.put("/settings", writeLimiter, requireCsrf, requireOwner, function (req, res) {
    const row = getSettingsRow(db);
    if (checkVersion(req, res, row) === null) return;

    const { errors, values } = validateSettings(req.body || {});
    if (errors.length) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", errors);
    }

    const next = {
      brand_name: values.brandName !== undefined ? values.brandName : row.brand_name,
      whatsapp_number: values.whatsappNumber !== undefined ? values.whatsappNumber : row.whatsapp_number,
      whatsapp_template_product: values.whatsappTemplateProduct !== undefined ? values.whatsappTemplateProduct : row.whatsapp_template_product,
      whatsapp_template_robux: values.whatsappTemplateRobux !== undefined ? values.whatsappTemplateRobux : row.whatsapp_template_robux,
      support_email: values.supportEmail !== undefined ? values.supportEmail : row.support_email,
      support_hours: values.supportHours !== undefined ? JSON.stringify(values.supportHours) : row.support_hours,
      default_locale: values.defaultLocale !== undefined ? values.defaultLocale : row.default_locale,
      robux_rules: values.robuxRules !== undefined ? JSON.stringify(values.robuxRules) : row.robux_rules,
    };

    const updated = transaction(db, function () {
      db.prepare(
        `UPDATE shop_settings SET brand_name = ?, whatsapp_number = ?, whatsapp_template_product = ?,
         whatsapp_template_robux = ?, support_email = ?, support_hours = ?,
         default_locale = ?, robux_rules = ?, version = version + 1, updated_at = ?, updated_by = ?
         WHERE id = 1`
      ).run(
        next.brand_name, next.whatsapp_number, next.whatsapp_template_product,
        next.whatsapp_template_robux, next.support_email, next.support_hours,
        next.default_locale, next.robux_rules, nowIso(), req.admin.id
      );
      const after = getSettingsRow(db);
      audit(req.admin.id, "settings.update", "settings", "shop", settingsPayload(row), settingsPayload(after));
      bumpDataVersion(db);
      return settingsPayload(getSettingsRow(db));
    });

    res.json(updated);
  });

  /* ================= Audit trail ================= */

  router.get("/audit", readLimiter, requireOwner, function (req, res) {
    const where = [];
    const params = [];
    if (req.query.entity_type) {
      where.push("a.entity_type = ?");
      params.push(String(req.query.entity_type));
    }
    if (req.query.entity_id) {
      where.push("a.entity_id = ?");
      params.push(String(req.query.entity_id));
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const sqlWhere = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_event a ${sqlWhere}`).get(...params).n;
    const rows = db.prepare(
      `SELECT a.*, (SELECT u.email FROM admin_user u WHERE u.id = a.actor_admin_id) AS actor_email
         FROM audit_event a ${sqlWhere} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, (page - 1) * limit);

    res.json({
      page,
      limit,
      total,
      items: rows.map(function (a) {
        return {
          id: a.id,
          actor: a.actor_email || null,
          action: a.action,
          entityType: a.entity_type,
          entityId: a.entity_id,
          before: parseJson(a.before, null),
          after: parseJson(a.after, null),
          createdAt: a.created_at,
        };
      }),
    });
  });

  /* ================= Guides ================= */

  router.get("/guides", readLimiter, function (req, res) {
    const rows = db.prepare(
      "SELECT * FROM guide ORDER BY json_extract(content, '$.idx'), id"
    ).all();
    res.json({ items: rows.map(adminGuide) });
  });

  router.patch("/guides/:id", writeLimiter, requireCsrf, function (req, res) {
    const row = db.prepare("SELECT * FROM guide WHERE id = ?").get(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No guide with this id.");
    if (checkVersion(req, res, row) === null) return;

    const { errors, values } = validateGuidePatch(req.body || {});
    if (errors.length) {
      return sendProblem(res, 422, "Validation failed", "Some fields need fixing.", errors);
    }

    const current = adminGuide(row);
    const next = {
      name: values.name !== undefined ? values.name : current.name,
      tagline: values.tagline !== undefined ? values.tagline : current.tagline,
      content: values.content !== undefined ? values.content : current.content,
      publication: values.publication !== undefined ? values.publication : row.publication,
    };

    const updated = transaction(db, function () {
      db.prepare(
        `UPDATE guide SET name = ?, tagline = ?, content = ?, publication = ?,
         updated_at = ?, version = version + 1 WHERE id = ?`
      ).run(
        JSON.stringify(next.name), JSON.stringify(next.tagline), JSON.stringify(next.content),
        next.publication, nowIso(), row.id
      );
      const after = db.prepare("SELECT * FROM guide WHERE id = ?").get(row.id);
      audit(req.admin.id, "guide.update", "guide", row.id, adminGuide(row), adminGuide(after));
      bumpDataVersion(db);
      return adminGuide(after);
    });

    res.json(updated);
  });

  return router;
};
