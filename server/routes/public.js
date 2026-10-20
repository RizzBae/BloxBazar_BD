/* =========================================================
   BloxBazaar BD — server/routes/public.js
   Read-only public API (PRD §8.1): bootstrap, catalogue,
   product detail, guides. Public responses only ever contain
   published + approved products; the search/filter contract
   mirrors the shipped front-end (Appendix A).
   ========================================================= */

"use strict";

const express = require("express");
const { getDataVersion } = require("../db");
const { sendProblem, fieldError } = require("../lib/problem");
const { createLimiter } = require("../lib/ratelimit");
const {
  publicProduct,
  publicGuide,
  bootstrapPayload,
} = require("../lib/serialize");

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (m) => "\\" + m);
}

module.exports = function publicRoutes(db, config) {
  const router = express.Router();

  const publicLimiter = createLimiter({
    windowMs: 60000,
    max: config.publicRatePerMin,
    keyFn: (req) => "pub:" + req.ip,
  });

  function setCache(res, dv) {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    res.setHeader("ETag", `W/"dv${dv}"`);
  }

  function notModified(req, res, dv) {
    const inm = req.headers["if-none-match"];
    if (inm && String(inm).split(",").some((t) => t.trim() === `W/"dv${dv}"`)) {
      res.status(304).end();
      return true;
    }
    return false;
  }

  function intParam(raw, field, errors, min) {
    if (raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < (min || 0)) {
      errors.push(fieldError(field, "Must be a whole number."));
      return null;
    }
    return n;
  }

  /* GET /api/v1/bootstrap */
  router.get("/bootstrap", publicLimiter, (req, res) => {
    const dv = getDataVersion(db);
    setCache(res, dv);
    if (notModified(req, res, dv)) return;
    res.json(bootstrapPayload(db));
  });

  /* GET /api/v1/catalogue?category&q&min_price&max_price&featured&available&page&limit */
  router.get("/catalogue", publicLimiter, (req, res) => {
    const errors = [];
    const where = ["publication = 'published'", "eligibility = 'approved'"];
    const params = [];

    if (req.query.category !== undefined && String(req.query.category) !== "") {
      const category = String(req.query.category);
      if (!db.prepare("SELECT id FROM category WHERE id = ?").get(category)) {
        return sendProblem(res, 400, "Invalid request", "Unknown category.", [
          fieldError("category", "Unknown category."),
        ]);
      }
      where.push("category_id = ?");
      params.push(category);
    }

    if (req.query.q !== undefined && String(req.query.q).trim() !== "") {
      const term = String(req.query.q).trim();
      if (term.length < 2) {
        return sendProblem(res, 400, "Invalid request", "Search needs at least 2 characters.", [
          fieldError("q", "Search needs at least 2 characters."),
        ]);
      }
      const like = "%" + escapeLike(term) + "%";
      where.push(
        "(json_extract(name, '$.en') LIKE ? ESCAPE '\\'" +
        " OR json_extract(name, '$.bn') LIKE ? ESCAPE '\\'" +
        " OR sku LIKE ? ESCAPE '\\')"
      );
      params.push(like, like, like);
    }

    const minPrice = intParam(req.query.min_price, "min_price", errors, 0);
    if (minPrice !== null) { where.push("price >= ?"); params.push(minPrice); }
    const maxPrice = intParam(req.query.max_price, "max_price", errors, 0);
    if (maxPrice !== null) { where.push("price <= ?"); params.push(maxPrice); }

    if (String(req.query.featured) === "1") where.push("featured = 1");
    if (String(req.query.available) === "1") where.push("stock = 'in'");

    const page = Math.max(1, intParam(req.query.page, "page", errors, 1) || 1);
    const rawLimit = intParam(req.query.limit, "limit", errors, 1);
    const limit = Math.min(60, rawLimit || 24);

    if (errors.length) {
      return sendProblem(res, 400, "Invalid request", "Some query parameters need fixing.", errors);
    }

    const dv = getDataVersion(db);
    setCache(res, dv);
    if (notModified(req, res, dv)) return;

    const sqlWhere = "WHERE " + where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS n FROM product ${sqlWhere}`).get(...params).n;
    const rows = db.prepare(
      `SELECT * FROM product ${sqlWhere} ORDER BY featured DESC, updated_at DESC, id ASC LIMIT ? OFFSET ?`
    ).all(...params, limit, (page - 1) * limit);

    res.json({
      page,
      limit,
      total,
      dataVersion: dv,
      items: rows.map(publicProduct),
    });
  });

  /* GET /api/v1/products/{id} */
  router.get("/products/:id", publicLimiter, (req, res) => {
    const row = db.prepare("SELECT * FROM product WHERE id = ?").get(req.params.id);
    const isPublic = row && row.publication === "published" && row.eligibility === "approved";
    if (!isPublic) {
      return sendProblem(res, 404, "Not found", "No public product with this id.");
    }
    const dv = getDataVersion(db);
    setCache(res, dv);
    if (notModified(req, res, dv)) return;
    res.json(publicProduct(row));
  });

  /* GET /api/v1/guides */
  router.get("/guides", publicLimiter, (req, res) => {
    const dv = getDataVersion(db);
    setCache(res, dv);
    if (notModified(req, res, dv)) return;
    const rows = db.prepare(
      "SELECT * FROM guide WHERE publication = 'published' ORDER BY json_extract(content, '$.idx'), id"
    ).all();
    res.json({ dataVersion: dv, items: rows.map(publicGuide) });
  });

  /* GET /api/v1/guides/{id} */
  router.get("/guides/:id", publicLimiter, (req, res) => {
    const row = db.prepare("SELECT * FROM guide WHERE id = ? AND publication = 'published'").get(req.params.id);
    if (!row) return sendProblem(res, 404, "Not found", "No public guide with this id.");
    const dv = getDataVersion(db);
    setCache(res, dv);
    if (notModified(req, res, dv)) return;
    res.json(publicGuide(row));
  });

  return router;
};
