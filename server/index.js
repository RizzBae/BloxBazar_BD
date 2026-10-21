/* =========================================================
   BloxBazaar BD — server/index.js
   Entry point: open the database, seed on first run, serve the
   storefront + API.  Run with:  npm run server
   ========================================================= */

"use strict";

const config = require("./config");
const { openDatabase } = require("./db");
const { createApp } = require("./app");
const { seedIfEmpty } = require("./seed");

const db = openDatabase(config.dbPath);

const seedReport = seedIfEmpty(db, config);
if (seedReport) {
  console.log("[bb-server] First run — imported the static catalogue:");
  console.log("[bb-server]   products: " + seedReport.products +
    " (skipped " + seedReport.productsSkipped + "), guides: " + seedReport.guides +
    ", categories: " + seedReport.categories);
  if (seedReport.adminPassword) {
    console.log("[bb-server] First-run owner password: " + seedReport.adminPassword);
    console.log("[bb-server] Save it now, then change it in Shop settings.");
  }
}

const app = createApp({ db, config });

const server = app.listen(config.port, config.host, function () {
  console.log("[bb-server] BloxBazaar BD running at http://" + config.host + ":" + config.port);
  console.log("[bb-server] Storefront: /   Admin: /admin.html   API: /api/v1");
  console.log("[bb-server] Admin sign-in: " + config.seedAdminEmail + " (run npm run admin:reset to change the password)");
  console.log("[bb-server] Password recovery: sign in and create a recovery code in the Account tab.");
});

function shutdown() {
  server.close(function () {
    try { db.close(); } catch (e) { /* already closed */ }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
