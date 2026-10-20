/* =========================================================
   BloxBazaar BD — server/app.js
   Express application: security headers, JSON parsing, the
   public and admin APIs, the server-side admin page gate,
   static files, and the problem+json error handler
   (Backend PRD §4, §8, §10).
   ========================================================= */

"use strict";

const path = require("node:path");
const express = require("express");
const { sendProblem, fieldError } = require("./lib/problem");
const { loadSession } = require("./lib/auth");
const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");
const pkg = require("../package.json");

/* Paths that must never be served by the static handler. */
const BLOCKED = [
  /^\/server(\/|$)/i,
  /^\/node_modules(\/|$)/i,
  /^\/\.git(\/|$)/i,
  /^\/\.env$/i,
  /^\/package(-lock)?\.json$/i,
  /^\/\.gitignore$/i,
];

function createApp(options) {
  const db = options.db;
  const config = options.config;
  const app = express();

  app.disable("x-powered-by");
  app.set("etag", false); /* public routes manage their dv-based ETag (PRD §12) */
  app.set("trust proxy", config.trustProxy ? 1 : false);

  /* Security headers (PRD §10). Inline styles stay allowed because the
     shipped design uses style attributes; scripts are same-origin only. */
  app.use(function (req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "));
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });

  app.get("/healthz", function (req, res) {
    res.json({ status: "ok", version: pkg.version });
  });

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1", publicRoutes(db, config));
  app.use("/api/v1/admin", adminRoutes(db, config));

  /* Uploaded images: random immutable keys, long-lived caching (PRD §12). */
  app.use("/uploads", express.static(config.uploadsDir, {
    index: false,
    dotfiles: "ignore",
    maxAge: "365d",
    immutable: true,
  }));

  app.use(function (req, res, next) {
    if (BLOCKED.some(function (re) { return re.test(req.path); })) {
      return sendProblem(res, 404, "Not found", "Nothing here.");
    }
    next();
  });

  /* Server-side gate for the admin page (PRD §10): the client UI is
     useless without a session anyway, but the page itself is gated too. */
  app.get("/admin.html", function (req, res, next) {
    if (!loadSession(db, req, config)) {
      return res.redirect(302, "/admin-login.html?next=" + encodeURIComponent(req.originalUrl));
    }
    next();
  });

  /* Static site (the same files the design stage shipped). */
  app.use(express.static(config.rootDir, {
    index: "index.html",
    dotfiles: "ignore",
    setHeaders: function (res, filePath) {
      /* Assets revalidate so local admin edits show immediately; a CDN
         in front adds the long-lived caching described in PRD §12. */
      if (filePath.indexOf(path.sep + "assets" + path.sep) !== -1) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));

  app.use(function (req, res) {
    if (req.path.indexOf("/api/") === 0) {
      return sendProblem(res, 404, "Not found", "No such API route.");
    }
    res.status(404).type("text/plain").send("Not found");
  });

  /* Central error handler — never leaks stack traces or DB details. */
  app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err && err.name === "MulterError") {
      if (err.code === "LIMIT_FILE_SIZE") {
        return sendProblem(res, 413, "File too large", "Images must be 2 MB or smaller.", [
          fieldError("file", "Images must be 2 MB or smaller."),
        ]);
      }
      return sendProblem(res, 422, "Validation failed", "The upload could not be read.", [
        fieldError("file", String(err.code || "Upload error")),
      ]);
    }

    if (err && (err.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400))) {
      return sendProblem(res, 400, "Invalid request", "The request body must be valid JSON.");
    }

    const status = (err && err.status) || 500;
    if (status >= 500) {
      console.error("[bb-server]", (err && err.stack) || err);
    }
    if (err && err.fieldErrors) {
      return sendProblem(res, status, err.problemTitle || "Validation failed", err.message, err.fieldErrors);
    }
    if (status >= 500) {
      return sendProblem(res, 500, "Server error", "Something went wrong. Please try again.");
    }
    sendProblem(res, status, err && err.problemTitle ? err.problemTitle : "Request failed", err && err.message);
  });

  return app;
}

module.exports = { createApp };
