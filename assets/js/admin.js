/* =========================================================
   BloxBazaar BD — admin.js
   Product table with filters, add/edit drawer, validation,
   quick stock toggle, archive/delete confirms, save feedback.

   Backend mode (page served by the backend, API reachable):
   every change goes through /api/v1/admin with the session
   cookie + CSRF header; the server enforces the state rules
   (eligibility gates publishing, featured only when orderable,
   archive instead of delete, optimistic concurrency) and
   returns the stored record.

   Static mode (file:// design preview or a static file host):
   the original browser-only demo — changes persist in this
   browser's localStorage (bb_admin_v1); reset from the top bar.

   Preview: admin.html?drawer=add | ?drawer=edit&id=robux-1000
            | ?state=empty
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB;
  var API = window.BB_API;

  /* The data layer decides the mode when the bundle loads. */
  function apiMode() { return !!(API && API.mode && API.mode() === "api"); }
  function isApiMode() { return apiMode(); }

  /* ---------- Working data ---------- */
  var rows = [];
  var stateParam = T.param("state");

  var filter = "all";
  var q = "";
  var editingId = null;
  var pending = null;   /* {kind, id} for confirm modal */
  var saving = false;
  var drawerImageKey = "";   /* image key currently in the drawer */
  var loadedImageKey = "";   /* what the drawer opened with */
  var activeTab = "products";   /* "products" | "settings" */
  var settingsLoaded = false;   /* shop-settings form filled from current values */
  var settingsVersion = null;   /* API mode: optimistic-concurrency token */
  var savingSettings = false;

  /* ---------- Elements ---------- */
  var tbody = document.getElementById("admin-tbody");
  var emptyBox = document.getElementById("admin-empty");
  var chipsEl = document.getElementById("admin-chips");
  var qInput = document.getElementById("admin-q");
  var banner = document.getElementById("save-banner");
  var bannerText = banner ? banner.querySelector("span") : null;
  var btnAdd = document.getElementById("btn-add");
  var btnReset = document.getElementById("btn-reset");
  var btnSignOut = document.getElementById("btn-signout");
  var userNameEl = document.querySelector(".at-user span:last-child");

  var drawer = document.getElementById("drawer");
  var drawerBackdrop = document.getElementById("drawer-backdrop");
  var drawerTitle = document.getElementById("drawer-title");
  var dName = document.getElementById("d-name");
  var dSku = document.getElementById("d-sku");
  var dCategory = document.getElementById("d-category");
  var dPrice = document.getElementById("d-price");
  var dEligibility = document.getElementById("d-eligibility");
  var dDescription = document.getElementById("d-description");
  var dStock = document.getElementById("d-stock");
  var dPublication = document.getElementById("d-publication");
  var dzNote = document.querySelector(".dropzone .dz-note");
  var dzThumb = document.querySelector(".dropzone .dz-thumb");

  /* Section tabs + shop settings */
  var tabButtons = T.$$(".admin-tab");
  var panelProducts = document.getElementById("panel-products");
  var panelSettings = document.getElementById("panel-settings");
  var pageTitle = document.querySelector(".aph-title");
  var pageSub = document.querySelector(".aph-sub");
  var sNumber = document.getElementById("s-wa-number");
  var sTplProduct = document.getElementById("s-tpl-product");
  var sTplRobux = document.getElementById("s-tpl-robux");
  var btnSaveSettings = document.getElementById("btn-save-settings");
  var settingsNote = document.getElementById("settings-mode-note");

  var modal = document.getElementById("modal-backdrop");
  var modalTitle = document.getElementById("modal-title");
  var modalBody = document.getElementById("modal-body");
  var modalConfirm = document.getElementById("modal-confirm");

  function findRow(id) {
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }

  function replaceRow(updated) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === updated.id) { rows[i] = updated; return; }
    }
    rows.unshift(updated);
  }

  function markAuthed() {
    if (document.documentElement.className.indexOf("bb-admin-auth") === -1) {
      document.documentElement.className += " bb-admin-auth";
    }
  }

  /* ---------- Badges ---------- */
  function stockCell(p) {
    if (p.publication === "archived") return '<span class="cell-muted">—</span>';
    var on = p.stock === "in";
    return '<button type="button" class="badge ' + (on ? "badge-in" : "badge-out") + ' badge-dot stock-toggle" data-act="stock" data-id="' + p.id + '" aria-pressed="' + on + '" title="' + T.t("admin.toggleStock") + '">' + T.t(on ? "badge.inStock" : "badge.outOfStock") + "</button>";
  }

  function pubBadge(p) {
    if (p.publication === "published") return '<span class="badge badge-accent">' + T.t("badge.published") + "</span>";
    if (p.publication === "archived") return '<span class="badge">' + T.t("badge.archived") + "</span>";
    return '<span class="badge">' + T.t("badge.draft") + "</span>";
  }

  function eligBadge(p) {
    if (p.eligibility === "approved") return '<span class="badge badge-accent">' + T.t("badge.approved") + "</span>";
    if (p.eligibility === "review") return '<span class="badge badge-warn">' + T.t("badge.needsReview") + "</span>";
    return '<span class="badge">' + T.t("badge.eligibilityInfo") + "</span>";
  }

  /* ---------- Table ---------- */
  function matches(p) {
    if (filter === "in" && p.stock !== "in") return false;
    if (filter === "out" && p.stock !== "out") return false;
    if (filter === "review" && p.eligibility !== "review") return false;
    if (filter === "draft" && p.publication !== "draft") return false;
    if (filter === "archived" && p.publication !== "archived") return false;
    if (q) {
      var nameEn = (p.name && typeof p.name === "object" ? p.name.en : p.name) || "";
      var nameBn = (p.name && typeof p.name === "object" ? p.name.bn : p.name) || "";
      var hay = [nameEn, nameBn, p.sku || ""].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function rowHtml(p) {
    var name = T.bg(p.name);
    var archived = p.publication === "archived";
    var actions =
      '<div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="edit" data-id="' + p.id + '">' + T.t("admin.edit") + "</button>" +
        (archived
          ? '<button class="icon-btn" type="button" data-act="restore" data-id="' + p.id + '" aria-label="' + T.t("admin.restore") + '" title="' + T.t("admin.restore") + '">' + T.icon.restore + "</button>"
          : '<button class="icon-btn" type="button" data-act="archive" data-id="' + p.id + '" aria-label="' + T.t("admin.archive") + '" title="' + T.t("admin.archive") + '">' + T.icon.archive + "</button>") +
        '<button class="icon-btn danger" type="button" data-act="delete" data-id="' + p.id + '" aria-label="' + T.t("admin.delete") + '" title="' + T.t("admin.delete") + '">' + T.icon.trash + "</button>" +
      "</div>";

    return "<tr>" +
      '<td><span class="cell-label">' + T.t("admin.colProduct") + '</span><span class="p-cell">' +
        '<span class="p-thumb' + (p.tone ? " tone-" + p.tone : "") + '">' + (p.image ? '<img src="' + T.esc(p.image) + '" alt="" loading="lazy">' : T.esc(p.monogram || "")) + "</span>" +
        "<span><span class=\"p-name\">" + T.esc(name) + '</span><br><span class="p-sku">' + T.esc(p.sku) + "</span></span>" +
      "</span></td>" +
      '<td><span class="cell-label">' + T.t("admin.colCategory") + "</span>" + T.esc(T.catLabel(p.category)) + "</td>" +
      '<td><span class="cell-label">' + T.t("admin.colPrice") + '</span><span class="strong nowrap">' + Number(p.price).toLocaleString("en-US") + "</span></td>" +
      '<td><span class="cell-label">' + T.t("admin.colStock") + "</span>" + stockCell(p) + "</td>" +
      '<td><span class="cell-label">' + T.t("admin.colPublication") + "</span>" + pubBadge(p) + "</td>" +
      '<td><span class="cell-label">' + T.t("admin.colEligibility") + "</span>" + eligBadge(p) + "</td>" +
      '<td><span class="cell-label">' + T.t("admin.colUpdated") + '</span><span class="cell-muted">' + T.fmtDate(p.updated) + "</span></td>" +
      "<td>" + actions + "</td>" +
    "</tr>";
  }

  /* ---------- Chips ---------- */
  function count(f) {
    return rows.filter(function (p) {
      if (f === "in") return p.stock === "in";
      if (f === "out") return p.stock === "out";
      if (f === "review") return p.eligibility === "review";
      if (f === "draft") return p.publication === "draft";
      if (f === "archived") return p.publication === "archived";
      return true;
    }).length;
  }

  function renderChips() {
    var defs = [
      ["all", T.t("admin.chipAll")],
      ["in", T.t("admin.chipIn")],
      ["out", T.t("admin.chipOut")],
      ["review", T.t("admin.chipReview")],
      ["draft", T.t("admin.chipDraft")],
      ["archived", T.t("admin.chipArchived")]
    ];
    chipsEl.innerHTML = defs.map(function (d) {
      var n = count(d[0]);
      var active = filter === d[0] ? " is-active" : "";
      var nText = T.getLang() === "bn" ? T.toBnDigits(n) : n;
      return '<button class="chip' + active + '" type="button" data-f="' + d[0] + '" aria-pressed="' + (filter === d[0]) + '">' +
        T.esc(d[1]) + ' <span class="chip-count">' + nText + "</span></button>";
    }).join("");
  }

  /* ---------- Render ---------- */
  function render() {
    renderChips();

    if (rows.length === 0) {
      tbody.innerHTML = "";
      emptyBox.innerHTML =
        '<div class="empty-state" style="border:0; border-radius:0;">' +
          '<div class="es-icon">' + T.icon.inbox + "</div>" +
          '<div class="es-title">' + T.t("admin.emptyTitle") + "</div>" +
          '<p class="es-desc">' + T.t("admin.emptyDesc") + "</p>" +
          '<div class="es-actions"><button class="btn btn-primary" type="button" id="empty-add">' + T.t("admin.addProduct") + "</button></div>" +
        "</div>";
      var b = document.getElementById("empty-add");
      if (b) b.addEventListener("click", function () { openDrawer(null); });
      return;
    }

    var items = rows.filter(matches);
    if (items.length === 0) {
      tbody.innerHTML = "";
      emptyBox.innerHTML =
        '<div class="empty-state" style="border:0; border-radius:0;">' +
          '<div class="es-icon">' + T.icon.search + "</div>" +
          '<div class="es-title">' + T.t("admin.emptyFiltered") + "</div>" +
          '<p class="es-desc">' + T.t("admin.emptyFilteredDesc") + "</p>" +
        "</div>";
      return;
    }

    emptyBox.innerHTML = "";
    tbody.innerHTML = items.map(rowHtml).join("");
  }

  /* ---------- Drawer ---------- */
  function segSet(group, value) {
    T.$$(".segmented-btn", group).forEach(function (b) {
      var on = b.getAttribute("data-value") === value;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
    });
  }
  function segGet(group) {
    var b = T.$(".segmented-btn.is-active", group);
    return b ? b.getAttribute("data-value") : null;
  }

  function updateSku() {
    var code = { robux: "RB", "blox-fruits": "BF", mm2: "M2", rivals: "RV", "steal-a-brainrot": "SB" }[dCategory.value] || "XX";
    var price = Number(dPrice.value || 0);
    dSku.textContent = "BB-" + code + "-" + (price > 0 ? String(price).padStart(4, "0") : "0000");
  }

  function clearErrors() {
    ["f-name", "f-category", "f-price", "f-description"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove("has-error");
    });
  }

  function setThumb(key) {
    if (!dzThumb) return;
    if (key) {
      dzThumb.innerHTML = '<img src="' + T.esc(key) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
    } else {
      dzThumb.innerHTML = T.icon.image;
    }
  }

  function openDrawer(id) {
    editingId = id || null;
    var p = findRow(editingId);

    drawerTitle.textContent = T.t(editingId ? "admin.drawerEdit" : "admin.drawerAdd");
    dName.value = p ? T.bg(p.name) : "";
    dCategory.value = p ? p.category : ((window.BB_DATA.categories[0] || {}).id || "");
    dPrice.value = p ? p.price : "";
    /* New products default to Draft + Needs review (PRD §3). */
    dEligibility.value = p ? p.eligibility : "review";
    dDescription.value = p ? T.bg(p.description) : "";
    segSet(dStock, p ? p.stock : "in");
    segSet(dPublication, p && p.publication === "published" ? "published" : "draft");

    drawerImageKey = p && p.imageKey ? p.imageKey : (p && p.image ? p.image : "");
    loadedImageKey = drawerImageKey;
    setThumb(drawerImageKey);

    updateSku();
    clearErrors();

    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    dName.focus();
  }

  function closeDrawer() {
    drawer.hidden = true;
    drawerBackdrop.hidden = true;
    document.body.style.overflow = "";
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map(function (w) { return w.charAt(0).toUpperCase(); }).join("") || "BB";
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function flashBanner() {
    banner.classList.add("is-visible");
    clearTimeout(banner._t);
    banner._t = setTimeout(function () { banner.classList.remove("is-visible"); }, 4200);
  }

  function validateDrawer() {
    var name = dName.value.trim();
    var price = Number(dPrice.value);
    var desc = dDescription.value.trim();

    updateSku(); /* keep the generated SKU in sync even without input events */
    clearErrors();
    var firstError = null;
    if (!name) { document.getElementById("f-name").classList.add("has-error"); firstError = firstError || dName; }
    if (!(price > 0)) { document.getElementById("f-price").classList.add("has-error"); firstError = firstError || dPrice; }
    if (!desc) { document.getElementById("f-description").classList.add("has-error"); firstError = firstError || dDescription; }
    if (firstError) { firstError.focus(); return null; }

    return { name: name, price: price, desc: desc };
  }

  function saveProduct() {
    if (saving) return;
    var v = validateDrawer();
    if (!v) return;

    var stock = segGet(dStock) || "in";
    var publication = segGet(dPublication) || "draft";
    var eligibility = dEligibility.value;

    if (apiMode()) {
      saveProductApi(v.name, v.price, v.desc, stock, publication, eligibility);
      return;
    }

    /* ---------- Static design demo (localStorage) ---------- */
    var sku = dSku.textContent;

    if (editingId) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === editingId) {
          var p = rows[i];
          p.name = { en: v.name, bn: v.name };
          p.category = dCategory.value;
          p.price = v.price;
          p.stock = stock;
          p.publication = publication;
          p.eligibility = eligibility;
          p.description = { en: v.desc, bn: v.desc };
          p.sku = sku;
          p.updated = todayIso();
          break;
        }
      }
    } else {
      rows.unshift({
        id: "custom-" + Date.now(),
        sku: sku,
        name: { en: v.name, bn: v.name },
        category: dCategory.value,
        price: v.price,
        stock: stock,
        publication: publication,
        eligibility: eligibility,
        featured: false,
        tone: "",
        monogram: initials(v.name),
        updated: todayIso(),
        short: { en: v.desc.slice(0, 110), bn: v.desc.slice(0, 110) },
        description: { en: v.desc, bn: v.desc },
        includes: [
          { en: "Details confirmed in the WhatsApp chat", bn: "বিবরণ WhatsApp চ্যাটে নিশ্চিত করা হয়" },
          { en: "Ask us in the same chat if you need help", bn: "সাহায্যে দরকার হলে একই চ্যাটে জিজ্ঞেস করুন" },
          { en: "We never ask for passwords or one-time codes", bn: "আমরা কখনো পাসওয়ার্ড বা ওয়ান-টাইম কোড চাই না" }
        ]
      });
    }

    closeDrawer();
    render();
    persist();
    T.toast(T.t("admin.toastSaved"));
    flashBanner();
  }

  /* ---------- Backend mode writes ---------- */
  function saveProductApi(name, price, desc, stock, publication, eligibility) {
    var existing = editingId ? findRow(editingId) : null;
    var currentLang = T.getLang();
    var namePayload = { en: name, bn: name };
    var shortPayload = { en: desc.slice(0, 110), bn: desc.slice(0, 110) };
    var descPayload = { en: desc, bn: desc };

    if (existing) {
      if (existing.name && typeof existing.name === "object") {
        if (currentLang === "bn") {
          namePayload = { en: existing.name.en || name, bn: name };
        } else {
          namePayload = { en: name, bn: existing.name.bn || name };
        }
      }
      if (existing.short && typeof existing.short === "object") {
        if (currentLang === "bn") {
          shortPayload = { en: existing.short.en || desc.slice(0, 110), bn: desc.slice(0, 110) };
        } else {
          shortPayload = { en: desc.slice(0, 110), bn: existing.short.bn || desc.slice(0, 110) };
        }
      }
      if (existing.description && typeof existing.description === "object") {
        if (currentLang === "bn") {
          descPayload = { en: existing.description.en || desc, bn: desc };
        } else {
          descPayload = { en: desc, bn: existing.description.bn || desc };
        }
      }
    }

    var payload = {
      name: namePayload,
      category: dCategory.value,
      price: price,
      stock: stock,
      publication: publication,
      eligibility: eligibility,
      short: shortPayload,
      description: descPayload
    };
    /* Only send the image when it actually changed. */
    if (drawerImageKey !== loadedImageKey) payload.imageKey = drawerImageKey || null;

    var request;
    if (editingId) {
      payload.version = existing ? existing.version : undefined;
      request = API.admin.updateProduct(editingId, payload);
    } else {
      payload.monogram = initials(name);
      request = API.admin.createProduct(payload);
    }

    saving = true;
    var btn = document.getElementById("drawer-save");
    if (btn) btn.disabled = true;

    request.then(function (saved) {
      replaceRow(saved);
      closeDrawer();
      render();
      T.toast(T.t("admin.toastSaved"));
      flashBanner();
    }).catch(function (err) {
      handleSaveError(err);
    }).then(function () {
      saving = false;
      if (btn) btn.disabled = false;
    });
  }

  function handleSaveError(err) {
    if (err && err.status === 401) {
      location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
      return;
    }
    if (err && err.status === 409) {
      /* Someone (or another tab) updated the record — reload and retry. */
      T.toast(T.t("admin.conflict"));
      closeDrawer();
      loadRows().catch(function () { /* toast already shown */ });
      return;
    }
    if (err && err.fieldErrors && err.fieldErrors.length) {
      var fieldMap = { name: "f-name", category: "f-category", price: "f-price", description: "f-description" };
      var first = null;
      err.fieldErrors.forEach(function (fe) {
        var box = fieldMap[fe.field] ? document.getElementById(fieldMap[fe.field]) : null;
        if (box) {
          box.classList.add("has-error");
          if (!first) first = box.querySelector("input, textarea, select") || box;
        }
      });
      T.toast(err.fieldErrors[0].message);
      if (first && first.focus) first.focus();
      return;
    }
    if (err && err.status === 403) { T.toast(T.t("admin.forbidden")); return; }
    if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
    T.toast(T.t("admin.saveError"));
  }

  function apiErrorToast(err) {
    if (err && err.status === 401) {
      location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
      return;
    }
    if (err && err.status === 409) {
      T.toast(T.t("admin.conflict"));
      loadRows().catch(function () { /* toast already shown */ });
      return;
    }
    if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
    T.toast(T.t("admin.saveError"));
  }

  function loadRows() {
    return API.admin.listProducts({ limit: 500 }).then(function (res) {
      rows = stateParam === "empty" ? [] : (res.items || []);
      render();
    });
  }

  /* ---------- Static-mode persistence ---------- */
  function persist() {
    try {
      localStorage.setItem("bb_admin_v1", JSON.stringify({
        version: BB_DATA.dataVersion,
        savedAt: new Date().toISOString(),
        products: rows
      }));
    } catch (e) { /* storage blocked or full — ignore */ }
  }

  /* ---------- Section tabs (Products / Shop settings) ---------- */
  var TAB_HEAD = {
    products: { title: "admin.dashboardTitle", sub: "admin.dashboardSub" },
    settings: { title: "admin.settingsTitle", sub: "admin.settingsSub" }
  };

  function applyTabHead() {
    var def = TAB_HEAD[activeTab];
    if (pageTitle) {
      pageTitle.setAttribute("data-i18n", def.title);
      pageTitle.textContent = T.t(def.title);
    }
    if (pageSub) {
      pageSub.setAttribute("data-i18n", def.sub);
      pageSub.textContent = T.t(def.sub);
    }
  }

  function activateTab(tab) {
    activeTab = tab === "settings" ? "settings" : "products";
    tabButtons.forEach(function (b) {
      var on = b.getAttribute("data-tab") === activeTab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    panelProducts.hidden = activeTab !== "products";
    panelSettings.hidden = activeTab !== "settings";
    /* .btn sets its own display — toggle via style, not [hidden]. */
    if (btnAdd) btnAdd.style.display = activeTab === "products" ? "" : "none";
    applyTabHead();
    if (activeTab === "settings" && !settingsLoaded) loadSettings();
  }

  /* ---------- Shop settings (WhatsApp number + order messages) ---------- */
  function settingsFields() {
    return {
      whatsappNumber: sNumber ? sNumber.value.trim() : "",
      whatsappTemplateProduct: sTplProduct ? sTplProduct.value.trim() : "",
      whatsappTemplateRobux: sTplRobux ? sTplRobux.value.trim() : ""
    };
  }

  function clearSettingsErrors() {
    ["f-settings-number", "f-settings-tpl-product", "f-settings-tpl-robux"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove("has-error");
    });
  }

  function fillSettings(data) {
    if (sNumber) sNumber.value = String(data.whatsappNumber || "");
    if (sTplProduct) sTplProduct.value = String(data.whatsappTemplateProduct || "");
    if (sTplRobux) sTplRobux.value = String(data.whatsappTemplateRobux || "");
    clearSettingsErrors();
  }

  function applySettingsNote() {
    if (settingsNote) {
      settingsNote.textContent = T.t(apiMode() ? "admin.settingsNoteApi" : "admin.settingsNoteStatic");
    }
  }

  function loadSettings() {
    applySettingsNote();
    if (!apiMode()) {
      /* Static demo: config.js already merged any saved overrides. */
      var bb = window.BB_DATA || {};
      var tpls = bb.whatsappTemplates || {};
      settingsLoaded = true;
      fillSettings({
        whatsappNumber: bb.whatsappNumber || "",
        whatsappTemplateProduct: tpls.product || "",
        whatsappTemplateRobux: tpls.robux || ""
      });
      return;
    }
    API.admin.getSettings().then(function (res) {
      settingsLoaded = true;
      settingsVersion = res.version;
      fillSettings(res);
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      T.toast(T.t("admin.settingsLoadError"));
    });
  }

  function saveSettings() {
    if (savingSettings) return;
    var values = settingsFields();
    var digits = values.whatsappNumber.replace(/[^\d]/g, "");
    if (digits && !/^[1-9]\d{7,14}$/.test(digits)) {
      var box = document.getElementById("f-settings-number");
      if (box) box.classList.add("has-error");
      T.toast(T.t("admin.settingsErrNumber"));
      if (sNumber) sNumber.focus();
      return;
    }
    values.whatsappNumber = digits;
    clearSettingsErrors();
    if (apiMode()) saveSettingsApi(values);
    else saveSettingsStatic(values);
  }

  function saveSettingsStatic(values) {
    /* The storefront reads this back through config.js on the next load. */
    try {
      localStorage.setItem("bb_admin_settings_v1", JSON.stringify({
        version: BB_DATA.dataVersion,
        savedAt: new Date().toISOString(),
        settings: values
      }));
    } catch (e) { /* storage blocked or full — ignore */ }
    BB_DATA.whatsappNumber = values.whatsappNumber;
    BB_DATA.whatsappTemplates = {
      product: values.whatsappTemplateProduct,
      robux: values.whatsappTemplateRobux
    };
    if (sNumber) sNumber.value = values.whatsappNumber;
    T.toast(T.t("admin.settingsSaved"));
    flashBanner();
  }

  function saveSettingsApi(values) {
    savingSettings = true;
    if (btnSaveSettings) btnSaveSettings.disabled = true;
    values.version = settingsVersion;
    API.admin.putSettings(values).then(function (res) {
      settingsVersion = res.version;
      fillSettings(res);
      T.toast(T.t("admin.settingsSaved"));
      flashBanner();
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      if (err && err.status === 409) {
        /* Another tab (or the owner's phone) saved first — reload and let
           the user review before saving again. */
        T.toast(T.t("admin.settingsConflict"));
        settingsLoaded = false;
        loadSettings();
        return;
      }
      if (err && err.status === 403) { T.toast(T.t("admin.settingsForbidden")); return; }
      if (err && err.fieldErrors && err.fieldErrors.length) {
        var fieldMap = {
          whatsappNumber: "f-settings-number",
          whatsappTemplateProduct: "f-settings-tpl-product",
          whatsappTemplateRobux: "f-settings-tpl-robux"
        };
        var first = null;
        err.fieldErrors.forEach(function (fe) {
          var box = fieldMap[fe.field] ? document.getElementById(fieldMap[fe.field]) : null;
          if (box) {
            box.classList.add("has-error");
            if (!first) first = box.querySelector("input, textarea") || box;
          }
        });
        T.toast(err.fieldErrors[0].message);
        if (first && first.focus) first.focus();
        return;
      }
      if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
      T.toast(T.t("admin.saveError"));
    }).then(function () {
      savingSettings = false;
      if (btnSaveSettings) btnSaveSettings.disabled = false;
    });
  }

  /* ---------- Confirm modal ---------- */
  function openConfirm(kind, id) {
    var p = findRow(id);
    if (!p) return;
    pending = { kind: kind, id: id };
    var name = T.bg(p.name);
    modalTitle.textContent = T.t(kind === "archive" ? "admin.archiveTitle" : "admin.deleteTitle");
    modalBody.textContent = T.t(kind === "archive" ? "admin.archiveBody" : "admin.deleteBody", { name: name });
    modalConfirm.textContent = T.t(kind === "archive" ? "admin.confirmArchive" : "admin.confirmDelete");
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalConfirm.focus();
  }

  function closeModal() {
    modal.hidden = true;
    pending = null;
    if (drawer.hidden) document.body.style.overflow = "";
  }

  function openResetConfirm() {
    pending = { kind: "reset", id: null };
    modalTitle.textContent = T.t("admin.resetTitle");
    modalBody.textContent = T.t("admin.resetBody");
    modalConfirm.textContent = T.t("admin.confirmReset");
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalConfirm.focus();
  }

  function confirmAction() {
    if (!pending) return;
    var id = pending.id;
    var kind = pending.kind;

    if (kind === "reset") {
      try {
        localStorage.removeItem("bb_admin_v1");
        localStorage.removeItem("bb_admin_settings_v1");
      } catch (e) { /* ignore */ }
      location.reload();
      return;
    }

    if (apiMode()) {
      var row = findRow(id);
      closeModal();
      if (!row) return;
      if (kind === "archive") {
        API.admin.setPublication(id, "archived", row.version).then(function (updated) {
          replaceRow(updated);
          T.toast(T.t("admin.toastArchived"));
          render();
        }).catch(apiErrorToast);
      } else {
        API.admin.deleteProduct(id, row.version).then(function () {
          rows = rows.filter(function (p) { return p.id !== id; });
          T.toast(T.t("admin.toastDeleted"));
          render();
        }).catch(apiErrorToast);
      }
      return;
    }

    if (kind === "archive") {
      rows.forEach(function (p) { if (p.id === id) { p.publication = "archived"; p.updated = todayIso(); } });
      T.toast(T.t("admin.toastArchived"));
    } else {
      rows = rows.filter(function (p) { return p.id !== id; });
      T.toast(T.t("admin.toastDeleted"));
    }
    persist();
    closeModal();
    render();
  }

  /* ---------- Image upload (backend mode only) ---------- */
  function wireUpload() {
    var dz = document.querySelector(".dropzone");
    if (!dz || dz.getAttribute("data-upload") === "on") return;
    dz.setAttribute("data-upload", "on");
    dz.style.cursor = "pointer";

    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.style.display = "none";
    dz.appendChild(input);

    dz.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { T.toast(T.t("admin.uploadError")); return; }
      API.admin.upload(file).then(function (res) {
        drawerImageKey = res.key;
        setThumb(res.key);
        T.toast(T.t("admin.toastUploaded"));
      }).catch(function (err) {
        if (err && err.fieldErrors && err.fieldErrors.length) T.toast(err.fieldErrors[0].message);
        else T.toast(T.t("admin.uploadError"));
      });
    });
  }

  /* ---------- Events ---------- */
  tabButtons.forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.getAttribute("data-tab")); });
  });

  if (btnSaveSettings) btnSaveSettings.addEventListener("click", saveSettings);

  btnAdd.addEventListener("click", function () {
    if (activeTab !== "products") activateTab("products");
    openDrawer(null);
  });
  if (btnReset) btnReset.addEventListener("click", openResetConfirm);

  if (btnSignOut) btnSignOut.addEventListener("click", function () {
    if (apiMode()) {
      API.admin.signOut().catch(function () { /* sign out locally anyway */ })
        .then(function () { location.href = "admin-login.html"; });
      return;
    }
    T.adminSignOut();
    location.href = "admin-login.html";
  });

  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-cancel").addEventListener("click", closeDrawer);
  document.getElementById("drawer-save").addEventListener("click", saveProduct);
  drawerBackdrop.addEventListener("click", closeDrawer);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  modalConfirm.addEventListener("click", confirmAction);

  T.$$(".segmented-btn", dStock).forEach(function (b) {
    b.addEventListener("click", function () { segSet(dStock, b.getAttribute("data-value")); });
  });
  T.$$(".segmented-btn", dPublication).forEach(function (b) {
    b.addEventListener("click", function () { segSet(dPublication, b.getAttribute("data-value")); });
  });
  dCategory.addEventListener("change", updateSku);
  dPrice.addEventListener("input", updateSku);

  tbody.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-act");

    if (act === "edit") { openDrawer(id); return; }
    if (act === "archive") { openConfirm("archive", id); return; }
    if (act === "delete") { openConfirm("delete", id); return; }

    if (act === "restore") {
      if (apiMode()) {
        var r1 = findRow(id);
        if (!r1) return;
        API.admin.setPublication(id, "draft", r1.version).then(function (updated) {
          replaceRow(updated);
          T.toast(T.t("admin.toastRestored"));
          render();
        }).catch(apiErrorToast);
        return;
      }
      rows.forEach(function (p) { if (p.id === id) { p.publication = "draft"; p.updated = todayIso(); } });
      T.toast(T.t("admin.toastRestored"));
      persist();
      render();
      return;
    }

    if (act === "stock") {
      if (apiMode()) {
        var r2 = findRow(id);
        if (!r2) return;
        API.admin.setStock(id, r2.stock === "in" ? "out" : "in", r2.version).then(function (updated) {
          replaceRow(updated);
          T.toast(T.t(updated.stock === "in" ? "admin.toastStockIn" : "admin.toastStockOut"));
          render();
        }).catch(apiErrorToast);
        return;
      }
      var toggled = null;
      rows.forEach(function (p) {
        if (p.id === id) { p.stock = p.stock === "in" ? "out" : "in"; p.updated = todayIso(); toggled = p; }
      });
      if (toggled) {
        T.toast(T.t(toggled.stock === "in" ? "admin.toastStockIn" : "admin.toastStockOut"));
        persist();
        render();
      }
    }
  });

  chipsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-f]");
    if (!btn) return;
    filter = btn.getAttribute("data-f");
    render();
  });

  var deb;
  qInput.addEventListener("input", function () {
    clearTimeout(deb);
    deb = setTimeout(function () { q = qInput.value.trim().toLowerCase(); render(); }, 150);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!modal.hidden) closeModal();
      else if (!drawer.hidden) closeDrawer();
    }
  });

  function renderCategoryOptions() {
    var cur = dCategory.value;
    dCategory.innerHTML = ((window.BB_DATA && BB_DATA.categories) || []).map(function (c) {
      return '<option value="' + c.id + '">' + T.esc(T.bg(c)) + "</option>";
    }).join("");
    if (cur) dCategory.value = cur;
  }

  document.addEventListener("bb:langchange", function () {
    render();
    renderCategoryOptions();
    applyTabHead();
    applySettingsNote();
    if (!drawer.hidden) drawerTitle.textContent = T.t(editingId ? "admin.drawerEdit" : "admin.drawerAdd");
  });

  /* ---------- Init ---------- */
  function openFromParams() {
    if (T.param("drawer") === "add") openDrawer(null);
    if (T.param("drawer") === "edit") openDrawer(T.param("id") || "robux-1000");
  }

  function initApiMode() {
    /* "Reset demo data" only applies to the browser-only demo. */
    if (btnReset) btnReset.style.display = "none";
    if (bannerText) {
      bannerText.setAttribute("data-i18n", "admin.saveBannerApi");
      bannerText.textContent = T.t("admin.saveBannerApi");
    }
    if (dzNote) {
      dzNote.setAttribute("data-i18n", "admin.dzNoteActive");
      dzNote.textContent = T.t("admin.dzNoteActive");
    }
    wireUpload();

    API.admin.session()
      .catch(function (err) {
        /* The server gates /admin.html too — this is belt and braces. */
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        throw err;
      })
      .then(function (res) {
        markAuthed();
        if (userNameEl && res && res.admin && res.admin.email) {
          userNameEl.removeAttribute("data-i18n");
          userNameEl.textContent = res.admin.email;
        }
        return loadRows().catch(function () { T.toast(T.t("admin.saveError")); });
      })
      .then(function () {
        openFromParams();
        if (T.param("tab") === "settings") activateTab("settings");
      })
      .catch(function () { /* session redirect already handled */ });
  }

  function initStaticMode() {
    if (!T.adminSessionActive()) { location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search)); return; }
    markAuthed();

    rows = (window.BB_DATA.products || []).map(function (p) {
      var copy = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) copy[k] = p[k];
      return copy;
    });
    if (stateParam === "empty") rows = [];
    render();
    openFromParams();
    if (T.param("tab") === "settings") activateTab("settings");
  }

  document.addEventListener("bb:ready", function () {
    renderCategoryOptions();
    updateSku();
    activateTab("products");

    if (isApiMode()) initApiMode();
    else initStaticMode();
  });
})();
