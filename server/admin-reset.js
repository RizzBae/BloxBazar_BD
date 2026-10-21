#!/usr/bin/env node
/* =========================================================
   BloxBazaar BD — server/admin-reset.js
   Owner password recovery on the server host.

   The self-service route uses a recovery code. Use this CLI when the
   code is lost or nobody can sign in. It sets a new password, signs the
   account out everywhere, and issues a fresh recovery code.

     npm run admin:reset
     npm run admin:reset -- --email owner@example.com
     npm run admin:reset -- --password "my new password"

   Without --password a random temporary password is printed once.
   ========================================================= */

"use strict";

const crypto = require("node:crypto");
const config = require("./config");
const { openDatabase, nowIso, transaction } = require("./db");
const { setAdminPassword, setAdminRecoveryCode, passwordProblem } = require("./lib/auth");

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  const value = process.argv[index + 1];
  return typeof value === "string" && value.indexOf("--") !== 0 ? value : "";
}

function main() {
  const db = openDatabase(config.dbPath);
  try {
    const email = argValue("--email").trim().toLowerCase();
    const admin = email
      ? db.prepare("SELECT * FROM admin_user WHERE lower(email) = ?").get(email)
      : db.prepare(
        `SELECT * FROM admin_user
          WHERE active = 1
          ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC
          LIMIT 1`
      ).get();

    if (!admin) {
      console.error("[bb] No matching admin account" + (email ? " for " + email : "") + ".");
      process.exitCode = 1;
      return;
    }

    const provided = argValue("--password") || process.env.BB_RESET_PASSWORD || "";
    const password = provided || "BB-" + crypto.randomBytes(9).toString("base64url");
    const problem = passwordProblem(password);
    if (problem) {
      console.error("[bb] " + problem);
      process.exitCode = 1;
      return;
    }

    const recoveryCode = transaction(db, function () {
      setAdminPassword(db, admin.id, password);
      const code = setAdminRecoveryCode(db, admin.id);
      db.prepare(
        `INSERT INTO audit_event
           (actor_admin_id, action, entity_type, entity_id, before, after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        null, "auth.password.reset_cli", "admin_user", admin.id,
        null, JSON.stringify({ via: "cli" }), nowIso()
      );
      return code;
    });

    console.log("");
    console.log("[bb] Password reset for " + admin.email + " (" + admin.role + ").");
    if (provided) {
      console.log("[bb] The password you supplied is now active.");
    } else {
      console.log("[bb] Temporary password: " + password);
      console.log("[bb] Save it now — it is not shown again. To choose your own password later, run:");
      console.log("[bb]   npm run admin:reset -- --password \"your new password\"");
    }
    console.log("[bb] New recovery code: " + recoveryCode);
    console.log("[bb] Save it now — it replaces the old code and is not shown again.");
    console.log("[bb] Use it on /admin-forgot.html if you forget the password, or create a new one in Settings.");
    console.log("[bb] All sessions for this account were cleared.");
    console.log("");
  } finally {
    db.close();
  }
}

main();
