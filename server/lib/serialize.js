/* =========================================================
   BloxBazaar BD — server/lib/serialize.js
   Row → JSON mapping. Public payloads mirror the shipped
   front-end's field names (Appendix A) so pages can switch
   data sources without redesign; admin payloads add the
   internal review fields.
   ========================================================= */

"use strict";

const { getSettingsRow } = require("../db");

function parseJson(text, fallback) {
  if (text === null || text === undefined || text === "") return fallback;
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

function dateOnly(iso) {
  return iso ? String(iso).slice(0, 10) : null;
}

/* ---------- Products ---------- */

function publicProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: parseJson(row.name, {}),
    short: parseJson(row.short, null),
    description: parseJson(row.description, null),
    includes: parseJson(row.includes, []),
    category: row.category_id,
    price: row.price,
    priceFrom: !!row.price_from,
    listPrice: row.list_price,
    robuxAmount: row.robux_amount,
    tag: parseJson(row.tag, null),
    stock: row.stock,
    /* Harmless constants for front-end compatibility (PRD §8.1): the
       front-end filters on these; the server only ever emits public
       records through this serializer. */
    publication: "published",
    eligibility: "approved",
    featured: !!row.featured,
    tone: row.tone || null,
    monogram: row.monogram || null,
    image: row.image_key || null,
    updated: dateOnly(row.updated_at),
  };
}

function adminProduct(row) {
  const p = publicProduct(row);
  p.publication = row.publication;
  p.eligibility = row.eligibility;
  p.eligibilityNote = row.eligibility_note || null;
  p.eligibilityReviewedAt = row.eligibility_reviewed_at || null;
  p.eligibilityReviewDueAt = row.eligibility_review_due_at || null;
  p.imageKey = row.image_key || null;
  p.version = row.version;
  p.createdAt = row.created_at;
  p.updatedAt = row.updated_at;
  p.updatedBy = row.updated_by || null;
  return p;
}

/* ---------- Guides ---------- */

function publicGuide(row) {
  const content = parseJson(row.content, {});
  return {
    id: row.id,
    name: parseJson(row.name, {}),
    tagline: parseJson(row.tagline, {}),
    monogram: content.monogram || null,
    tone: content.tone || null,
    idx: content.idx || 0,
    intro: content.intro || null,
    waysTitle: content.waysTitle || null,
    ways: content.ways || [],
    safety: content.safety || [],
    links: content.links || [],
    updated: dateOnly(row.updated_at),
  };
}

function adminGuide(row) {
  const g = publicGuide(row);
  g.publication = row.publication;
  g.version = row.version;
  g.content = parseJson(row.content, {});
  g.updatedAt = row.updated_at;
  return g;
}

/* ---------- Bootstrap ---------- */

function bootstrapPayload(db) {
  const settings = getSettingsRow(db);
  const categories = db.prepare(
    "SELECT * FROM category WHERE visible = 1 ORDER BY display_order, id"
  ).all().map(function (c) {
    return { id: c.id, en: c.en, bn: c.bn, image: c.image_key || null };
  });
  return {
    brand: settings.brand_name,
    dataVersion: settings.data_version,
    defaultLocale: settings.default_locale,
    whatsappNumber: settings.whatsapp_number || "",
    whatsappTemplates: {
      product: settings.whatsapp_template_product || "",
      robux: settings.whatsapp_template_robux || "",
    },
    supportEmail: settings.support_email || "",
    supportHours: parseJson(settings.support_hours, {}),
    robuxRules: parseJson(settings.robux_rules, {}),
    categories,
  };
}

function settingsPayload(row) {
  return {
    brandName: row.brand_name,
    whatsappNumber: row.whatsapp_number,
    whatsappTemplateProduct: row.whatsapp_template_product || "",
    whatsappTemplateRobux: row.whatsapp_template_robux || "",
    supportEmail: row.support_email,
    supportHours: parseJson(row.support_hours, {}),
    defaultLocale: row.default_locale,
    robuxRules: parseJson(row.robux_rules, {}),
    dataVersion: row.data_version,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null,
  };
}

module.exports = {
  parseJson,
  dateOnly,
  publicProduct,
  adminProduct,
  publicGuide,
  adminGuide,
  bootstrapPayload,
  settingsPayload,
};
