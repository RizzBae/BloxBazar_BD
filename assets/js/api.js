/* =========================================================
   BloxBazaar BD — api.js
   Data layer. When the site runs on the backend, this fetches
   the catalogue, guides, and shop settings from /api/v1 and
   populates the same window.BB_DATA / window.BB_GUIDES shapes
   the design stage used, so the page scripts stay unchanged.
   On file:// (or when the API is unreachable) it falls back to
   the static bundle loaded from config.js — the design demo
   keeps working without a server.

   Switch (optional): window.BB_DATA_SOURCE = "static" pins the
   static bundle; "api" logs API failures loudly instead of
   falling back silently. Default is automatic.
   ========================================================= */

window.BB_API = (function () {
  "use strict";

  var BASE = "/api/v1";
  var httpMode = /^https?:$/.test(location.protocol);
  var mode = (httpMode && window.BB_DATA_SOURCE !== "static") ? "api" : "static";

  /* ---------- Helpers ---------- */

  function cookie(name) {
    var match = String(document.cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function requestError(res, data) {
    var err = new Error((data && data.detail) || ("Request failed (" + res.status + ")"));
    err.status = res.status;
    err.problem = data;
    err.fieldErrors = (data && data.errors) || null;
    err.retryAfter = res.headers.get("retry-after");
    return err;
  }

  function parseResponse(res) {
    if (res.status === 204) return Promise.resolve(null);
    return res.json().catch(function () { return null; }).then(function (data) {
      if (!res.ok) throw requestError(res, data);
      return data;
    });
  }

  function jsonFetch(path, options) {
    var opts = options || {};
    var headers = { Accept: "application/json" };
    var init = {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin"
    };
    if (init.method === "GET" || init.method === "HEAD") {
      /* Revalidate against the server's dataVersion ETag on every load:
         unchanged data answers 304 (cheap and cache-friendly), while an
         admin edit is visible on the next page view instead of waiting
         out the public max-age window. */
      init.cache = "no-cache";
    }
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (init.method !== "GET" && init.method !== "HEAD") {
      var csrf = cookie("bb_csrf");
      if (csrf) headers["x-csrf-token"] = csrf;
    }
    return fetch(BASE + path, init).then(parseResponse);
  }

  function adminFetch(path, method, body) {
    return jsonFetch("/admin" + path, { method: method || "GET", body: body });
  }

  /* ---------- Public data ---------- */

  function applyBundle(bootstrap, catalogue, guides) {
    var lang = "en";
    try { lang = localStorage.getItem("bb_lang") || "en"; } catch (e) { /* file:// */ }
    var hours = (bootstrap.supportHours || {});

    window.BB_DATA = {
      brand: bootstrap.brand,
      dataVersion: bootstrap.dataVersion,
      robuxRules: bootstrap.robuxRules,
      whatsappNumber: bootstrap.whatsappNumber || "",
      whatsappTemplates: {
        product: (bootstrap.whatsappTemplates && bootstrap.whatsappTemplates.product) || "",
        robux: (bootstrap.whatsappTemplates && bootstrap.whatsappTemplates.robux) || ""
      },
      placeholders: {
        whatsappNumber: bootstrap.whatsappNumber || "[WhatsApp number to be added]",
        supportEmail: bootstrap.supportEmail || "[Support email to be added]",
        supportHours: hours[lang] || hours.en || "[Support hours to be added]"
      },
      categories: bootstrap.categories || [],
      products: (catalogue && catalogue.items) || []
    };

    var byId = {};
    ((guides && guides.items) || []).forEach(function (g) { byId[g.id] = g; });
    window.BB_GUIDES = byId;
  }

  /* Resolves to { source: "api" | "static" } — never rejects. */
  function load() {
    var forced = window.BB_DATA_SOURCE;
    if (forced === "static") {
      mode = "static";
      return Promise.resolve({ source: "static" });
    }
    if (!httpMode) {
      /* file:// — the design demo runs on the static bundle. */
      mode = "static";
      return Promise.resolve({ source: "static" });
    }
    return Promise.all([
      jsonFetch("/bootstrap"),
      /* The catalogue grows with the shop; page scripts filter client-side
         for now and switch to the API's paging params when it exceeds 60. */
      jsonFetch("/catalogue?limit=60"),
      jsonFetch("/guides")
    ]).then(function (results) {
      applyBundle(results[0], results[1], results[2]);
      mode = "api";
      return { source: "api" };
    }).catch(function (err) {
      if (forced === "api") {
        console.error("[BB_API] API mode requested but the API failed — using the static bundle.", err);
      } else {
        console.warn("[BB_API] Marketplace API unavailable — using the static bundle.", (err && err.message) || err);
      }
      mode = "static";
      return { source: "static" };
    });
  }

  /* ---------- Admin API ---------- */

  var adminApi = {
    session: function () { return adminFetch("/session"); },
    signIn: function (email, password, remember) {
      return adminFetch("/session", "POST", { email: email, password: password, remember: !!remember });
    },
    signOut: function () { return adminFetch("/session", "DELETE"); },

    listProducts: function (params) {
      var qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return adminFetch("/products" + qs);
    },
    createProduct: function (payload) { return adminFetch("/products", "POST", payload); },
    updateProduct: function (id, payload) {
      return adminFetch("/products/" + encodeURIComponent(id), "PATCH", payload);
    },
    setPublication: function (id, publication, version) {
      return adminFetch("/products/" + encodeURIComponent(id) + "/publication", "POST",
        { publication: publication, version: version });
    },
    setStock: function (id, stock, version) {
      return adminFetch("/products/" + encodeURIComponent(id) + "/stock", "POST",
        { stock: stock, version: version });
    },
    setEligibility: function (id, eligibility, version, note, reviewDueAt) {
      return adminFetch("/products/" + encodeURIComponent(id) + "/eligibility", "POST",
        { eligibility: eligibility, version: version, note: note, review_due_at: reviewDueAt });
    },
    deleteProduct: function (id, version) {
      return adminFetch("/products/" + encodeURIComponent(id) + "?version=" + encodeURIComponent(version), "DELETE");
    },

    getSettings: function () { return adminFetch("/settings"); },
    putSettings: function (payload) { return adminFetch("/settings", "PUT", payload); },

    listGuides: function () { return adminFetch("/guides"); },
    updateGuide: function (id, payload) {
      return adminFetch("/guides/" + encodeURIComponent(id), "PATCH", payload);
    },

    listAudit: function (params) {
      var qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return adminFetch("/audit" + qs);
    },

    upload: function (file) {
      var fd = new FormData();
      fd.append("file", file);
      return fetch(BASE + "/admin/uploads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": cookie("bb_csrf") },
        body: fd
      }).then(parseResponse);
    }
  };

  return {
    load: load,
    mode: function () { return mode; },
    admin: adminApi,
    cookie: cookie
  };
})();
