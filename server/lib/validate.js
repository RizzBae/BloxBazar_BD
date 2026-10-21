/* =========================================================
   BloxBazaar BD — server/lib/validate.js
   Server-side validation for products, guides, and shop
   settings (Backend PRD §8.2). Returns field-level errors in
   the { field, message } shape the API documents.
   ========================================================= */

"use strict";

const { fieldError } = require("./problem");

const ID_RE = /^[a-z0-9-]{2,64}$/;
const SKU_RE = /^[A-Za-z0-9-]{3,32}$/;
const IMAGE_KEY_RE = /^(assets\/img\/[A-Za-z0-9._/-]+|uploads\/[A-Za-z0-9._-]+)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WHATSAPP_RE = /^[1-9]\d{7,14}$/; /* E.164 digits, no plus (S7) */
const INTERNAL_LINK_RE = /^[a-z0-9-]+\.html(#[\w-]+)?$/i;

const STOCKS = ["in", "out"];
const PUBLICATIONS = ["draft", "published", "archived"];
const ELIGIBILITIES = ["review", "approved", "rejected", "informational"];
const LOCALES = ["en", "bn"];
const TONES = ["green", "sand"];

/* Guide links must be https and on an allow-listed host (PRD §5.2). */
const GUIDE_LINK_HOSTS = ["roblox.com", "google.com", "apple.com", "whatsapp.com"];

function cleanText(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* External guide links are rendered into an href, so reject anything that can
   break out of the attribute, then return the canonical URL for storage. */
function safeHttpsUrl(url) {
  const raw = String(url);
  if (/[\u0000-\u0020\u007f"'<>`\\]/.test(raw)) return "";
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return "";
  }
  if (u.protocol !== "https:") return "";
  if (u.username || u.password) return "";
  if (!GUIDE_LINK_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) return "";
  return u.href;
}

function allowedHttpsUrl(url) {
  return safeHttpsUrl(url) !== "";
}

/* ---------------------------------------------------------
   Product write validation (create + patch).
   `body` uses the public API's camelCase field names; values
   only contains successfully validated fields that were sent.
   --------------------------------------------------------- */
function validateProduct(db, body, ctx) {
  const options = ctx || {};
  const existing = options.existing || null;
  const b = isPlainObject(body) ? body : {};
  const errors = [];
  const values = {};

  function err(field, message) {
    errors.push(fieldError(field, message));
  }

  function text(v, field, max) {
    if (typeof v !== "string") {
      err(field, "Must be a string.");
      return undefined;
    }
    const cleaned = cleanText(v);
    if (max && cleaned.length > max) {
      err(field, `Must be ${max} characters or fewer.`);
      return undefined;
    }
    return cleaned;
  }

  /* { en, bn } bilingual value. */
  function lang(v, field, opts) {
    const o = opts || {};
    if (!isPlainObject(v)) {
      err(field, "Must be an object with en and bn text.");
      return undefined;
    }
    const out = { en: "", bn: "" };
    let bad = false;
    ["en", "bn"].forEach(function (key) {
      const raw = v[key];
      if (raw === undefined || raw === null) return;
      if (typeof raw !== "string") {
        err(field, "Text values must be strings.");
        bad = true;
        return;
      }
      const cleaned = cleanText(raw);
      if (o.max && cleaned.length > o.max) {
        err(field, `Must be ${o.max} characters or fewer.`);
        bad = true;
        return;
      }
      out[key] = cleaned;
    });
    if (o.requiredEn && !out.en) {
      err(field, "English text is required.");
      bad = true;
    }
    if (o.requiredBn && !out.bn) {
      err(field, "Bangla text is required.");
      bad = true;
    }
    return bad ? undefined : out;
  }

  function integer(v, field, opts) {
    const o = opts || {};
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      err(field, "Must be a whole number.");
      return undefined;
    }
    if (o.min !== undefined && n < o.min) {
      err(field, `Must be at least ${o.min}.`);
      return undefined;
    }
    if (o.max !== undefined && n > o.max) {
      err(field, `Must be at most ${o.max}.`);
      return undefined;
    }
    if (o.step && n % o.step !== 0) {
      err(field, `Must be a multiple of ${o.step}.`);
      return undefined;
    }
    return n;
  }

  /* id — create only, optional (generated from the name when absent). */
  if (b.id !== undefined) {
    if (!options.isCreate) {
      if (b.id !== (existing && existing.id)) err("id", "The id cannot be changed after creation.");
    } else {
      const id = text(b.id, "id", 64).toLowerCase();
      if (id !== undefined) {
        if (!ID_RE.test(id)) err("id", "Use lowercase letters, numbers, and dashes (2–64 characters).");
        else if (db.prepare("SELECT id FROM product WHERE id = ?").get(id)) err("id", "This id is already in use.");
        else values.id = id;
      }
    }
  }

  if (b.sku !== undefined && b.sku !== null && b.sku !== "") {
    const sku = text(b.sku, "sku", 32);
    if (sku !== undefined) {
      if (!SKU_RE.test(sku)) err("sku", "Use letters, numbers, and dashes (3–32 characters).");
      else {
        const clash = db.prepare("SELECT id FROM product WHERE sku = ? AND id != ?")
          .get(sku, existing ? existing.id : "");
        if (clash) err("sku", "This SKU is already in use.");
        else values.sku = sku;
      }
    }
  }

  if (b.name !== undefined) {
    values.name = lang(b.name, "name", { max: 120, requiredEn: true });
  } else if (options.isCreate) {
    err("name", "English text is required.");
  }

  if (b.short !== undefined) values.short = lang(b.short, "short", { max: 200 });
  if (b.description !== undefined) values.description = lang(b.description, "description", { max: 4000 });
  if (b.tag !== undefined) values.tag = b.tag === null ? null : lang(b.tag, "tag", { max: 60 });

  if (b.includes !== undefined) {
    if (!Array.isArray(b.includes)) err("includes", "Must be a list.");
    else if (b.includes.length > 8) err("includes", "At most 8 rows are allowed.");
    else {
      const items = [];
      let bad = false;
      b.includes.forEach(function (item, i) {
        const parsed = lang(item, "includes", { max: 160 });
        if (parsed === undefined) bad = true;
        else items.push(parsed);
      });
      if (!bad) values.includes = items;
    }
  }

  if (b.category !== undefined || b.categoryId !== undefined) {
    const cat = text(b.category !== undefined ? b.category : b.categoryId, "category", 64);
    if (cat !== undefined) {
      if (!db.prepare("SELECT id FROM category WHERE id = ?").get(cat)) {
        err("category", "Unknown category.");
      } else {
        values.category = cat;
      }
    }
  } else if (options.isCreate) {
    err("category", "A category is required.");
  }

  if (b.price !== undefined || options.isCreate) {
    const price = integer(b.price, "price", { min: 1, max: 10000000 });
    if (price === undefined) {
      if (options.isCreate && b.price === undefined) err("price", "A price is required.");
    } else if (price !== null) {
      values.price = price;
    }
  }

  if (b.priceFrom !== undefined) {
    if (typeof b.priceFrom !== "boolean") err("priceFrom", "Must be true or false.");
    else values.priceFrom = b.priceFrom;
  }

  if (b.listPrice !== undefined) {
    if (b.listPrice === null) values.listPrice = null;
    else {
      const lp = integer(b.listPrice, "listPrice", { min: 1, max: 10000000 });
      if (lp !== undefined && lp !== null) values.listPrice = lp;
      else if (lp === null) values.listPrice = null;
    }
  }

  if (b.robuxAmount !== undefined) {
    if (b.robuxAmount === null) values.robuxAmount = null;
    else {
      const ra = integer(b.robuxAmount, "robuxAmount", { min: 10, max: 100000, step: 10 });
      if (ra !== undefined) values.robuxAmount = ra;
    }
  }

  if (b.stock !== undefined) {
    if (STOCKS.indexOf(b.stock) === -1) err("stock", "Must be \"in\" or \"out\".");
    else values.stock = b.stock;
  }

  if (b.publication !== undefined) {
    if (PUBLICATIONS.indexOf(b.publication) === -1) {
      err("publication", "Must be draft, published, or archived.");
    } else {
      values.publication = b.publication;
    }
  }

  if (b.eligibility !== undefined) {
    if (ELIGIBILITIES.indexOf(b.eligibility) === -1) {
      err("eligibility", "Must be review, approved, rejected, or informational.");
    } else {
      values.eligibility = b.eligibility;
    }
  }

  if (b.eligibilityNote !== undefined) {
    if (b.eligibilityNote === null || b.eligibilityNote === "") values.eligibilityNote = null;
    else {
      const note = text(b.eligibilityNote, "eligibilityNote", 2000);
      if (note !== undefined) values.eligibilityNote = note;
    }
  }

  if (b.eligibilityReviewDueAt !== undefined) {
    if (b.eligibilityReviewDueAt === null || b.eligibilityReviewDueAt === "") {
      values.eligibilityReviewDueAt = null;
    } else {
      const due = text(b.eligibilityReviewDueAt, "eligibilityReviewDueAt", 10);
      if (due !== undefined) {
        if (!DATE_RE.test(due)) err("eligibilityReviewDueAt", "Use the YYYY-MM-DD format.");
        else values.eligibilityReviewDueAt = due;
      }
    }
  }

  if (b.featured !== undefined) {
    if (typeof b.featured !== "boolean") err("featured", "Must be true or false.");
    else values.featured = b.featured;
  }

  if (b.tone !== undefined) {
    if (b.tone === null || b.tone === "") values.tone = null;
    else if (TONES.indexOf(b.tone) === -1) err("tone", "Must be \"green\", \"sand\", or empty.");
    else values.tone = b.tone;
  }

  if (b.monogram !== undefined) {
    if (b.monogram === null || b.monogram === "") values.monogram = null;
    else {
      const m = text(b.monogram, "monogram", 4);
      if (m !== undefined) {
        if (!m.length) err("monogram", "Use 1–4 characters.");
        else values.monogram = m;
      }
    }
  }

  if (b.imageKey !== undefined) {
    if (b.imageKey === null || b.imageKey === "") values.imageKey = null;
    else {
      const key = text(b.imageKey, "imageKey", 300);
      if (key !== undefined) {
        if (key.indexOf("..") !== -1 || !IMAGE_KEY_RE.test(key)) {
          err("imageKey", "Use a path under assets/img/ or uploads/.");
        } else {
          values.imageKey = key;
        }
      }
    }
  }

  /* Cross-field rules. */
  const finalPrice = values.price !== undefined ? values.price : existing ? existing.price : null;
  const finalListPrice = values.listPrice !== undefined ? values.listPrice : existing ? existing.list_price : null;
  if (values.listPrice !== undefined && finalListPrice !== null && finalPrice !== null && finalListPrice < finalPrice) {
    err("listPrice", "The list price must be at least the selling price.");
  } else if (values.listPrice === undefined && finalListPrice !== null && finalPrice !== null && finalListPrice < finalPrice) {
    /* Raising the price past an existing list price clears the stale discount. */
    values.listPrice = null;
  }

  const finalCategory = values.category !== undefined
    ? values.category
    : existing ? existing.category_id : null;
  const finalRobuxAmount = values.robuxAmount !== undefined
    ? values.robuxAmount
    : existing ? existing.robux_amount : null;
  if (values.category !== undefined && values.category !== "robux" && values.robuxAmount === undefined && existing && existing.robux_amount) {
    /* Changing category away from Robux clears the Robux amount automatically. */
    values.robuxAmount = null;
  } else if (finalRobuxAmount !== null && finalRobuxAmount !== undefined && finalCategory && finalCategory !== "robux") {
    err("robuxAmount", "Only Robux products can set a Robux amount.");
  }

  return { errors, values };
}

/* ---------------------------------------------------------
   Shop settings validation (PRD §5.2, §8.2).
   --------------------------------------------------------- */
function validateSettings(body) {
  const b = isPlainObject(body) ? body : {};
  const errors = [];
  const values = {};

  function err(field, message) {
    errors.push(fieldError(field, message));
  }

  if (b.brandName !== undefined) {
    const v = typeof b.brandName === "string" ? cleanText(b.brandName) : null;
    if (!v || v.length > 60) err("brandName", "Use 1–60 characters.");
    else values.brandName = v;
  }

  if (b.whatsappNumber !== undefined) {
    const v = typeof b.whatsappNumber === "string" ? cleanText(b.whatsappNumber).replace(/[^\d]/g, "") : null;
    if (v === null) err("whatsappNumber", "Must be a string of digits.");
    else if (v === "") values.whatsappNumber = "";
    else if (!WHATSAPP_RE.test(v)) {
      err("whatsappNumber", "Use the international format without a plus, e.g. 8801XXXXXXXXX.");
    } else {
      values.whatsappNumber = v;
    }
  }

  /* Custom WhatsApp order-message templates (admin panel → Shop
     settings). Empty string means "use the built-in localized message"
     — templates are free text with {placeholder} tokens. */
  ["whatsappTemplateProduct", "whatsappTemplateRobux"].forEach(function (field) {
    if (b[field] === undefined) return;
    const v = typeof b[field] === "string" ? cleanText(b[field]) : null;
    if (v === null) err(field, "Must be a string.");
    else if (v.length > 1000) err(field, "Use 1000 characters or fewer.");
    else values[field] = v;
  });

  if (b.supportEmail !== undefined) {
    const v = typeof b.supportEmail === "string" ? cleanText(b.supportEmail) : null;
    if (v === null) err("supportEmail", "Must be a string.");
    else if (v === "") values.supportEmail = "";
    else if (!EMAIL_RE.test(v)) err("supportEmail", "Enter a valid email address.");
    else values.supportEmail = v;
  }

  if (b.supportHours !== undefined) {
    if (!isPlainObject(b.supportHours)) err("supportHours", "Must be an object with en and bn text.");
    else {
      const out = { en: "", bn: "" };
      let bad = false;
      ["en", "bn"].forEach(function (k) {
        const raw = b.supportHours[k];
        if (raw === undefined || raw === null) return;
        if (typeof raw !== "string" || cleanText(raw).length > 200) {
          err("supportHours", "Each value must be text of 200 characters or fewer.");
          bad = true;
          return;
        }
        out[k] = cleanText(raw);
      });
      if (!bad) values.supportHours = out;
    }
  }

  if (b.defaultLocale !== undefined) {
    if (LOCALES.indexOf(b.defaultLocale) === -1) err("defaultLocale", "Must be \"en\" or \"bn\".");
    else values.defaultLocale = b.defaultLocale;
  }

  if (b.robuxRules !== undefined) {
    const r = b.robuxRules;
    if (!isPlainObject(r)) err("robuxRules", "Must be an object.");
    else {
      const out = {};
      let bad = false;
      const min = Number(r.min);
      const max = Number(r.max);
      const defaultAmount = Number(r.defaultAmount);
      if (!Number.isInteger(min) || min < 1 || min > 1000000) { err("robuxRules", "The minimum must be a whole number of at least 1."); bad = true; }
      if (!Number.isInteger(max) || max <= min || max > 1000000) { err("robuxRules", "The maximum must be a whole number above the minimum."); bad = true; }
      if (!Number.isInteger(defaultAmount) || defaultAmount < min || defaultAmount > max) { err("robuxRules", "The default amount must sit between the minimum and maximum."); bad = true; }

      const presets = Array.isArray(r.presets) ? r.presets : [];
      if (!presets.length || presets.length > 30) { err("robuxRules", "Provide 1–30 preset amounts."); bad = true; }
      else {
        for (let i = 0; i < presets.length; i++) {
          const n = Number(presets[i]);
          if (!Number.isInteger(n) || n < min || n > max) { err("robuxRules", "Every preset must be a whole number between the minimum and maximum."); bad = true; break; }
        }
      }

      const tiers = Array.isArray(r.tiers) ? r.tiers : [];
      if (!tiers.length || tiers.length > 10) { err("robuxRules", "Provide 1–10 rate tiers."); bad = true; }
      else {
        let hasZero = false;
        for (let i = 0; i < tiers.length; i++) {
          const t = tiers[i];
          const from = Number(t && t.from);
          const rate = Number(t && t.rate);
          if (!Number.isInteger(from) || from < 0) { err("robuxRules", "Every tier needs a whole-number \"from\" of 0 or more."); bad = true; break; }
          if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) { err("robuxRules", "Every tier needs a positive rate."); bad = true; break; }
          if (from === 0) hasZero = true;
        }
        if (!bad && !hasZero) { err("robuxRules", "Rate tiers must include one starting at 0."); bad = true; }
      }

      if (!bad) {
        out.min = min; out.max = max; out.defaultAmount = defaultAmount;
        out.presets = presets.map(Number);
        out.tiers = tiers.map(function (t) { return { from: Number(t.from), rate: Number(t.rate) }; });
        values.robuxRules = out;
      }
    }
  }

  return { errors, values };
}

/* ---------------------------------------------------------
   Guide patch validation (PRD §5.2): bilingual text plus a
   light structural check on the shipped guide content shape.
   --------------------------------------------------------- */
function validateGuidePatch(body) {
  const b = isPlainObject(body) ? body : {};
  const errors = [];
  const values = {};

  function err(field, message) {
    errors.push(fieldError(field, message));
  }

  function lang(v, field, max) {
    if (!isPlainObject(v)) {
      err(field, "Must be an object with en and bn text.");
      return undefined;
    }
    const out = { en: "", bn: "" };
    let bad = false;
    ["en", "bn"].forEach(function (k) {
      const raw = v[k];
      if (raw === undefined || raw === null) return;
      if (typeof raw !== "string") { err(field, "Text values must be strings."); bad = true; return; }
      const cleaned = cleanText(raw);
      if (max && cleaned.length > max) { err(field, `Must be ${max} characters or fewer.`); bad = true; return; }
      out[k] = cleaned;
    });
    if (!out.en) { err(field, "English text is required."); bad = true; }
    return bad ? undefined : out;
  }

  if (b.name !== undefined) values.name = lang(b.name, "name", 120);
  if (b.tagline !== undefined) values.tagline = lang(b.tagline, "tagline", 300);

  if (b.publication !== undefined) {
    if (["draft", "published"].indexOf(b.publication) === -1) err("publication", "Must be draft or published.");
    else values.publication = b.publication;
  }

  if (b.content !== undefined) {
    const c = b.content;
    if (!isPlainObject(c)) err("content", "Must be an object.");
    else {
      let bad = false;
      if (c.ways !== undefined) {
        if (!Array.isArray(c.ways)) { err("content", "ways must be a list."); bad = true; }
        else {
          c.ways.forEach(function (w) {
            if (!isPlainObject(w)) { err("content", "Each way must be an object."); bad = true; return; }
            if (w.link && !w.internal) {
              const safe = safeHttpsUrl(w.link);
              if (!safe) {
                err("content", "Way links must be https on an allow-listed domain (Roblox or similar).");
                bad = true;
              } else {
                w.link = safe;
              }
            }
            if (w.link && w.internal && !INTERNAL_LINK_RE.test(String(w.link))) {
              err("content", "Internal links must point at a local .html page.");
              bad = true;
            }
          });
        }
      }
      if (c.links !== undefined) {
        if (!Array.isArray(c.links)) { err("content", "links must be a list."); bad = true; }
        else {
          c.links.forEach(function (l) {
            const safe = isPlainObject(l) ? safeHttpsUrl(l.url) : "";
            if (!safe) {
              err("content", "Guide links must be https on an allow-listed domain (Roblox or similar).");
              bad = true;
            } else {
              l.url = safe;
            }
          });
        }
      }
      if (!bad) values.content = c;
    }
  }

  return { errors, values };
}

module.exports = {
  STOCKS,
  PUBLICATIONS,
  ELIGIBILITIES,
  LOCALES,
  TONES,
  ID_RE,
  cleanText,
  isPlainObject,
  validateProduct,
  validateSettings,
  validateGuidePatch,
  allowedHttpsUrl,
  safeHttpsUrl,
};
