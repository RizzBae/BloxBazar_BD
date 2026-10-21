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

/* Resolve a request path the same way the static file handler will. Express
   keeps percent-encoding in req.path, while express.static decodes it, so a
   raw-path blocklist can be bypassed with /server%2Fconfig.js. Decode and
   normalize first, then allow only storefront files. */
function decodePath(raw) {
  let value = String(raw || "");
  for (let i = 0; i < 3; i += 1) {
    let next;
    try { next = decodeURIComponent(value); } catch (e) { break; }
    if (next === value) break;
    value = next;
  }
  return value.replace(/\\/g, "/").replace(/\0/g, "");
}

function normalizedPath(raw) {
  const clean = decodePath(raw).split("?")[0].split("#")[0];
  let value = path.posix.normalize(clean);
  if (!value.startsWith("/")) value = "/" + value;
  return value;
}

/* The static site is a fixed set of root HTML pages plus /assets. Everything
   else (server source, database, dependencies, docs, package metadata) is
   never reachable through the web server. */
function isPublicStaticPath(raw) {
  const value = normalizedPath(raw).toLowerCase();
  if (value === "/") return true;
  if (/^\/[a-z0-9_-]+\.html$/.test(value)) return true;
  return value.startsWith("/assets/");
}

function isUploadPath(raw) {
  const value = normalizedPath(raw);
  return /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(value);
}

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
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
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

  /* Uploaded images: random immutable keys, long-lived caching. Only files
     matching the generated UUID name are served, which also stops encoded
     path traversal through the uploads mount. */
  app.use("/uploads", function (req, res, next) {
    if (!isUploadPath(req.url)) {
      return res.status(404).type("text/plain").send("Not found");
    }
    next();
  }, express.static(config.uploadsDir, {
    index: false,
    dotfiles: "ignore",
    maxAge: "365d",
    immutable: true,
  }));

  /* One server-side gate for the admin page, matched after decoding. This
     covers /admin%2Ehtml, case variants, and /assets/../admin.html. */
  app.use(function (req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (normalizedPath(req.path).toLowerCase() !== "/admin.html") return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (!loadSession(db, req, config)) {
      return res.redirect(302, "/admin-login.html?next=" + encodeURIComponent("/admin.html"));
    }
    next();
  });

  /* Static storefront: root HTML pages and /assets only. */
  app.use(function (req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/api" || req.path.indexOf("/api/") === 0) return next();
    if (!isPublicStaticPath(req.path)) {
      return res.status(404).type("text/plain").send("Not found");
    }
    next();
  });

  app.use(express.static(config.rootDir, {
    index: "index.html",
    dotfiles: "ignore",
    setHeaders: function (res, filePath) {
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
