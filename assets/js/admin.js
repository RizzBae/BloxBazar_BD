/* =========================================================
   BloxBazaar BD — admin.js
   Product table with filters, add/edit drawer, validation,
   quick stock toggle, archive/delete confirms, save feedback.

   Every change goes through /api/v1/admin with the session
   cookie + CSRF header; the server enforces the state rules
   (eligibility gates publishing, featured only when orderable,
   archive instead of delete, optimistic concurrency) and
   returns the stored record.
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

  /* ---------- Working data ---------- */
  var rows = [];

  var filter = "all";
  var q = "";
  var editingId = null;
  var pending = null;   /* {kind, id} for confirm modal */
  var saving = false;
  var drawerImageKey = "";   /* image key currently in the drawer */
  var loadedImageKey = "";   /* what the drawer opened with */
  var activeTab = "products";   /* "products" | "settings" | "team" */
  var settingsLoaded = false;   /* shop-settings form filled from current values */
  var settingsVersion = null;   /* API mode: optimistic-concurrency token */
  var savingSettings = false;
  var currentAdmin = null;      /* API mode: { id, email, role, hasRecovery } */
  var admins = [];              /* owner-only team list */
  var adminsLoaded = false;
  var savingAccount = false;
  var savingRecovery = false;
  var savingAdmin = false;

  /* ---------- Elements ---------- */
  var tbody = document.getElementById("admin-tbody");
  var emptyBox = document.getElementById("admin-empty");
  var chipsEl = document.getElementById("admin-chips");
  var qInput = document.getElementById("admin-q");
  var banner = document.getElementById("save-banner");
  var btnAdd = document.getElementById("btn-add");
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
  var dzThumb = document.querySelector(".dropzone .dz-thumb");

  /* Section tabs + shop settings */
  var tabButtons = T.$$(".admin-tab");
  var panelProducts = document.getElementById("panel-products");
  var panelSettings = document.getElementById("panel-settings");
  var panelAccount = document.getElementById("panel-account");
  var panelTeam = document.getElementById("panel-team");
  var tabTeam = document.getElementById("tab-team");
  var pageTitle = document.querySelector(".aph-title");
  var pageSub = document.querySelector(".aph-sub");
  var sNumber = document.getElementById("s-wa-number");
  var sTplProduct = document.getElementById("s-tpl-product");
  var sTplRobux = document.getElementById("s-tpl-robux");
  var btnSaveSettings = document.getElementById("btn-save-settings");
  var settingsNote = document.getElementById("settings-mode-note");

  /* Account, recovery code, team */
  var accountCard = document.getElementById("account-card");
  var recoveryCard = document.getElementById("recovery-card");
  var accEmail = document.getElementById("acc-email");
  var accCurrent = document.getElementById("acc-current");
  var accNew = document.getElementById("acc-new");
  var accConfirm = document.getElementById("acc-confirm");
  var btnSaveAccount = document.getElementById("btn-save-account");
  var recoveryStatus = document.getElementById("recovery-status");
  var recCurrent = document.getElementById("rec-current");
  var btnNewRecovery = document.getElementById("btn-new-recovery");
  var recoveryResult = document.getElementById("recovery-result");
  var newRecoveryCode = document.getElementById("new-recovery-code");
  var copyRecovery = document.getElementById("copy-recovery");
  var btnAddAdmin = document.getElementById("btn-add-admin");
  var adminsTbody = document.getElementById("admins-tbody");
  var teamEmpty = document.getElementById("team-empty");

  var adminModal = document.getElementById("admin-modal-backdrop");
  var adminModalForm = document.getElementById("admin-modal-form");
  var adminModalDone = document.getElementById("admin-modal-done");
  var adminModalError = document.getElementById("admin-modal-error");
  var adminModalErrorText = adminModalError ? adminModalError.querySelector("span") : null;
  var aEmail = document.getElementById("a-email");
  var aRole = document.getElementById("a-role");
  var aPassword = document.getElementById("a-password");
  var btnAdminSave = document.getElementById("admin-modal-save");
  var newAdminCode = document.getElementById("new-admin-code");
  var copyAdminCode = document.getElementById("copy-admin-code");

  var modal = document.getElementById("modal-backdrop");
  var modalTitle = document.getElementById("modal-title");
  var modalBody = document.getElementById("modal-body");
  var modalConfirm = document.getElementById("modal-confirm");

  function findRow(id) {
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }

  function findAdmin(id) {
    for (var i = 0; i < admins.length; i++) if (admins[i].id === id) return admins[i];
    return null;
  }

  function canManageAdmins() {
    return !!(apiMode() && currentAdmin && currentAdmin.role === "owner");
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
    return '<button type="button" class="badge ' + (on ? "badge-in" : "badge-out") + ' badge-dot stock-toggle" data-act="stock" data-id="' + T.esc(p.id) + '" aria-pressed="' + on + '" title="' + T.t("admin.toggleStock") + '">' + T.t(on ? "badge.inStock" : "badge.outOfStock") + "</button>";
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
        '<button class="btn btn-ghost btn-sm" type="button" data-act="edit" data-id="' + T.esc(p.id) + '">' + T.t("admin.edit") + "</button>" +
        (archived
          ? '<button class="icon-btn" type="button" data-act="restore" data-id="' + T.esc(p.id) + '" aria-label="' + T.t("admin.restore") + '" title="' + T.t("admin.restore") + '">' + T.icon.restore + "</button>"
          : '<button class="icon-btn" type="button" data-act="archive" data-id="' + T.esc(p.id) + '" aria-label="' + T.t("admin.archive") + '" title="' + T.t("admin.archive") + '">' + T.icon.archive + "</button>") +
        '<button class="icon-btn danger" type="button" data-act="delete" data-id="' + T.esc(p.id) + '" aria-label="' + T.t("admin.delete") + '" title="' + T.t("admin.delete") + '">' + T.icon.trash + "</button>" +
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
    if (modal.hidden && (!adminModal || adminModal.hidden)) document.body.style.overflow = "";
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map(function (w) { return w.charAt(0).toUpperCase(); }).join("") || "BB";
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

    saveProductApi(
      v.name,
      v.price,
      v.desc,
      segGet(dStock) || "in",
      segGet(dPublication) || "draft",
      dEligibility.value
    );
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
      rows = res.items || [];
      render();
    });
  }

  /* ---------- Section tabs (Products / Settings / Account / Team) ---------- */
  var TAB_HEAD = {
    products: { title: "admin.dashboardTitle", sub: "admin.dashboardSub" },
    settings: { title: "admin.settingsTitle", sub: "admin.settingsSub" },
    account: { title: "admin.tabAccount", sub: "admin.accountSub" },
    team: { title: "admin.tabTeam", sub: "admin.teamPageSub" }
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
    if (tab === "team" && !canManageAdmins()) tab = "products";
    activeTab = (tab === "settings" || tab === "account" || tab === "team") ? tab : "products";
    tabButtons.forEach(function (b) {
      var on = b.getAttribute("data-tab") === activeTab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    panelProducts.hidden = activeTab !== "products";
    panelSettings.hidden = activeTab !== "settings";
    if (panelAccount) panelAccount.hidden = activeTab !== "account";
    if (panelTeam) panelTeam.hidden = activeTab !== "team";
    /* .btn sets its own display — toggle via style, not [hidden]. */
    if (btnAdd) btnAdd.style.display = activeTab === "products" ? "" : "none";
    applyTabHead();
    if (activeTab === "settings" && !settingsLoaded) loadSettings();
    if (activeTab === "team" && !adminsLoaded) loadAdmins();
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
    if (settingsNote) settingsNote.textContent = T.t("admin.settingsNoteApi");
  }

  function loadSettings() {
    applySettingsNote();
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
    saveSettingsApi(values);
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

  /* ---------- Account (self-service) ---------- */
  function setRecoveryStatus() {
    if (!recoveryStatus) return;
    recoveryStatus.textContent = currentAdmin && currentAdmin.hasRecovery
      ? T.t("admin.recoverySet")
      : T.t("admin.recoveryNone");
  }

  function fillAccount() {
    if (currentAdmin && accEmail) accEmail.value = currentAdmin.email;
  }

  function clearAccountErrors() {
    ["f-account-email", "f-account-current", "f-account-new", "f-account-confirm"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove("has-error");
    });
  }

  function markAccountError(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("has-error");
  }

  function saveAccount() {
    if (savingAccount || !apiMode() || !currentAdmin) return;
    var email = accEmail ? accEmail.value.trim() : "";
    var current = accCurrent ? accCurrent.value : "";
    var next = accNew ? accNew.value : "";
    var confirm = accConfirm ? accConfirm.value : "";

    clearAccountErrors();
    var emailOk = /.+@.+\..+/.test(email);
    var currentOk = current.length > 0;
    var newOk = next.length === 0 || next.length >= 10;
    var confirmOk = next === confirm;

    if (!emailOk) { markAccountError("f-account-email"); if (accEmail) accEmail.focus(); return; }
    if (!currentOk) { markAccountError("f-account-current"); if (accCurrent) accCurrent.focus(); return; }
    if (!newOk) { markAccountError("f-account-new"); if (accNew) accNew.focus(); return; }
    if (!confirmOk) { markAccountError("f-account-confirm"); if (accConfirm) accConfirm.focus(); return; }

    if (email.toLowerCase() === String(currentAdmin.email).toLowerCase() && !next) {
      T.toast(T.t("admin.accountNoChanges"));
      return;
    }

    savingAccount = true;
    if (btnSaveAccount) btnSaveAccount.disabled = true;
    API.admin.updateAccount({
      email: email,
      currentPassword: current,
      newPassword: next
    }).then(function (res) {
      if (res && res.admin) currentAdmin = res.admin;
      if (userNameEl) userNameEl.textContent = currentAdmin.email;
      fillAccount();
      if (accCurrent) accCurrent.value = "";
      if (accNew) accNew.value = "";
      if (accConfirm) accConfirm.value = "";
      setRecoveryStatus();
      T.toast(T.t("admin.accountSaved"));
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      if (err && err.status === 403) {
        markAccountError("f-account-current");
        T.toast(T.t("admin.currentPasswordWrong"));
        if (accCurrent) { accCurrent.focus(); accCurrent.select(); }
        return;
      }
      if (err && err.status === 409) {
        markAccountError("f-account-email");
        T.toast(T.t("admin.accountEmailTaken"));
        if (accEmail) accEmail.focus();
        return;
      }
      if (err && err.fieldErrors && err.fieldErrors.length) {
        var map = {
          email: "f-account-email",
          currentPassword: "f-account-current",
          password: "f-account-new"
        };
        var first = null;
        err.fieldErrors.forEach(function (fe) {
          if (map[fe.field]) {
            markAccountError(map[fe.field]);
            if (!first) first = document.getElementById(map[fe.field]);
          }
        });
        T.toast(err.fieldErrors[0].message);
        if (first) {
          var input = first.querySelector("input");
          if (input) input.focus();
        }
        return;
      }
      if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
      T.toast(T.t("admin.accountError"));
    }).then(function () {
      savingAccount = false;
      if (btnSaveAccount) btnSaveAccount.disabled = false;
    });
  }

  function generateRecovery() {
    if (savingRecovery || !apiMode()) return;
    var current = recCurrent ? recCurrent.value : "";
    var box = document.getElementById("f-recovery-current");
    if (box) box.classList.remove("has-error");
    if (!current) {
      if (box) box.classList.add("has-error");
      if (recCurrent) recCurrent.focus();
      return;
    }

    savingRecovery = true;
    if (btnNewRecovery) btnNewRecovery.disabled = true;
    API.admin.newRecoveryCode({ currentPassword: current }).then(function (res) {
      if (recCurrent) recCurrent.value = "";
      if (currentAdmin) currentAdmin.hasRecovery = true;
      setRecoveryStatus();
      if (res && res.recoveryCode && newRecoveryCode && recoveryResult) {
        newRecoveryCode.textContent = res.recoveryCode;
        recoveryResult.hidden = false;
        if (copyRecovery) copyRecovery.focus();
      }
      T.toast(T.t("admin.recoveryGenerated"));
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      if (err && err.status === 403) {
        if (box) box.classList.add("has-error");
        T.toast(T.t("admin.currentPasswordWrong"));
        if (recCurrent) { recCurrent.focus(); recCurrent.select(); }
        return;
      }
      if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
      T.toast(T.t("admin.recoveryError"));
    }).then(function () {
      savingRecovery = false;
      if (btnNewRecovery) btnNewRecovery.disabled = false;
    });
  }

  /* ---------- Team (owner only) ---------- */
  function setTeamVisible() {
    if (!tabTeam) return;
    tabTeam.hidden = !canManageAdmins();
    if (!canManageAdmins() && activeTab === "team") activateTab("products");
  }

  function loadAdmins() {
    if (!canManageAdmins()) return Promise.resolve();
    return API.admin.listAdmins().then(function (res) {
      admins = res.items || [];
      adminsLoaded = true;
      renderAdmins();
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      T.toast(T.t("admin.teamLoadError"));
    });
  }

  function renderAdmins() {
    if (!adminsTbody) return;
    adminsTbody.innerHTML = admins.map(function (a) {
      var self = currentAdmin && a.id === currentAdmin.id;
      var roleBadge = a.role === "owner"
        ? '<span class="badge badge-accent">' + T.t("admin.roleOwner") + "</span>"
        : '<span class="badge">' + T.t("admin.roleEditor") + "</span>";
      var statusBadge = a.active
        ? '<span class="badge badge-in">' + T.t("admin.statusActive") + "</span>"
        : '<span class="badge badge-out">' + T.t("admin.statusDisabled") + "</span>";
      var lastSignIn = a.lastSignInAt
        ? T.fmtDate(String(a.lastSignInAt).slice(0, 10))
        : T.t("admin.never");
      var roleAction = self
        ? ""
        : '<button class="btn btn-ghost btn-sm" type="button" data-admin-act="' +
            (a.role === "owner" ? "make-editor" : "make-owner") + '" data-id="' + T.esc(a.id) + '">' +
            T.t(a.role === "owner" ? "admin.makeEditor" : "admin.makeOwner") + "</button>";
      var activateAction = self
        ? ""
        : '<button class="btn btn-ghost btn-sm" type="button" data-admin-act="' +
            (a.active ? "deactivate" : "activate") + '" data-id="' + T.esc(a.id) + '">' +
            T.t(a.active ? "admin.deactivate" : "admin.activate") + "</button>";
      var deleteAction = self
        ? ""
        : '<button class="icon-btn danger" type="button" data-admin-act="delete" data-id="' + T.esc(a.id) +
            '" aria-label="' + T.t("admin.deleteAdmin") + '" title="' + T.t("admin.deleteAdmin") + '">' +
            T.icon.trash + "</button>";
      var action = self
        ? '<span class="cell-muted">—</span>'
        : roleAction + activateAction + deleteAction;

      return "<tr>" +
        '<td><span class="cell-label">' + T.t("admin.colAdmin") + '</span><span class="team-email">' + T.esc(a.email) + "</span>" +
          (self ? ' <span class="cell-muted">(' + T.t("admin.you") + ")</span>" : "") + "</td>" +
        '<td><span class="cell-label">' + T.t("admin.colRole") + "</span>" + roleBadge + "</td>" +
        '<td><span class="cell-label">' + T.t("admin.colStatus") + "</span>" + statusBadge + "</td>" +
        '<td><span class="cell-label">' + T.t("admin.colLastSignIn") + '</span><span class="cell-muted">' + T.esc(lastSignIn) + "</span></td>" +
        '<td><span class="cell-label">' + T.t("admin.colActions") + '</span><div class="team-actions">' + action + "</div></td>" +
      "</tr>";
    }).join("");

    if (teamEmpty) {
      teamEmpty.innerHTML = admins.length
        ? ""
        : '<p class="team-empty">' + T.esc(T.t("admin.teamEmpty")) + "</p>";
    }
  }

  function showAdminModalError(message) {
    if (!adminModalError) return;
    if (message) {
      if (adminModalErrorText) adminModalErrorText.textContent = message;
      adminModalError.classList.add("is-visible");
    } else {
      adminModalError.classList.remove("is-visible");
    }
  }

  function clearAdminModalErrors() {
    showAdminModalError("");
    ["f-admin-email", "f-admin-password"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove("has-error");
    });
  }

  function openAdminModal() {
    if (!canManageAdmins()) return;
    clearAdminModalErrors();
    if (aEmail) aEmail.value = "";
    if (aRole) aRole.value = "editor";
    if (aPassword) aPassword.value = "";
    if (adminModalForm) adminModalForm.hidden = false;
    if (adminModalDone) adminModalDone.hidden = true;
    if (adminModal) adminModal.hidden = false;
    document.body.style.overflow = "hidden";
    if (aEmail) aEmail.focus();
  }

  function closeAdminModal() {
    if (!adminModal) return;
    adminModal.hidden = true;
    if (newAdminCode) newAdminCode.textContent = "";
    if (drawer.hidden && modal.hidden) document.body.style.overflow = "";
  }

  function createAdmin() {
    if (savingAdmin) return;
    clearAdminModalErrors();

    var email = aEmail ? aEmail.value.trim() : "";
    var role = aRole ? aRole.value : "editor";
    var password = aPassword ? aPassword.value : "";

    var emailOk = /.+@.+\..+/.test(email);
    var passwordOk = password.length >= 10;
    if (!emailOk) {
      var emailBox = document.getElementById("f-admin-email");
      if (emailBox) emailBox.classList.add("has-error");
      if (aEmail) aEmail.focus();
      return;
    }
    if (!passwordOk) {
      var pwBox = document.getElementById("f-admin-password");
      if (pwBox) pwBox.classList.add("has-error");
      if (aPassword) aPassword.focus();
      return;
    }

    savingAdmin = true;
    if (btnAdminSave) btnAdminSave.disabled = true;
    API.admin.createAdmin({ email: email, role: role, password: password }).then(function (res) {
      if (res && res.admin) {
        admins.push(res.admin);
        renderAdmins();
      }
      if (newAdminCode) newAdminCode.textContent = (res && res.recoveryCode) || "";
      if (adminModalForm) adminModalForm.hidden = true;
      if (adminModalDone) adminModalDone.hidden = false;
      if (copyAdminCode) copyAdminCode.focus();
      adminsLoaded = true;
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      if (err && err.status === 409) {
        var emailBox = document.getElementById("f-admin-email");
        if (emailBox) emailBox.classList.add("has-error");
        showAdminModalError(T.t("admin.accountEmailTaken"));
        if (aEmail) aEmail.focus();
        return;
      }
      if (err && err.fieldErrors && err.fieldErrors.length) {
        var map = { email: "f-admin-email", password: "f-admin-password" };
        var first = null;
        err.fieldErrors.forEach(function (fe) {
          if (map[fe.field]) {
            var box = document.getElementById(map[fe.field]);
            if (box) {
              box.classList.add("has-error");
              if (!first) first = box;
            }
          }
        });
        showAdminModalError(err.fieldErrors[0].message);
        if (first) {
          var input = first.querySelector("input");
          if (input) input.focus();
        }
        return;
      }
      showAdminModalError((err && err.problem && err.problem.detail) || T.t("admin.adminError"));
    }).then(function () {
      savingAdmin = false;
      if (btnAdminSave) btnAdminSave.disabled = false;
    });
  }

  function setConfirmTone(danger) {
    modalConfirm.className = "btn " + (danger ? "btn-danger" : "btn-primary");
  }

  function openAdminConfirm(id) {
    var admin = findAdmin(id);
    if (!admin || (currentAdmin && admin.id === currentAdmin.id)) return;
    var activate = !admin.active;
    pending = { kind: activate ? "admin-activate" : "admin-deactivate", id: admin.id };
    modalTitle.textContent = T.t(activate ? "admin.activateTitle" : "admin.deactivateTitle", {
      email: admin.email
    });
    modalBody.textContent = T.t(activate ? "admin.activateBody" : "admin.deactivateBody");
    modalConfirm.textContent = T.t(activate ? "admin.activate" : "admin.deactivate");
    setConfirmTone(!activate);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalConfirm.focus();
  }

  function openAdminRoleConfirm(id, role) {
    var admin = findAdmin(id);
    if (!admin || (currentAdmin && admin.id === currentAdmin.id) || admin.role === role) return;
    pending = { kind: "admin-role", id: admin.id, role: role };
    modalTitle.textContent = T.t(role === "owner" ? "admin.makeOwnerTitle" : "admin.makeEditorTitle", {
      email: admin.email
    });
    modalBody.textContent = T.t(role === "owner" ? "admin.makeOwnerBody" : "admin.makeEditorBody");
    modalConfirm.textContent = T.t(role === "owner" ? "admin.makeOwner" : "admin.makeEditor");
    setConfirmTone(false);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalConfirm.focus();
  }

  function openAdminDeleteConfirm(id) {
    var admin = findAdmin(id);
    if (!admin || (currentAdmin && admin.id === currentAdmin.id)) return;
    pending = { kind: "admin-delete", id: admin.id };
    modalTitle.textContent = T.t("admin.deleteAdminTitle", { email: admin.email });
    modalBody.textContent = T.t("admin.deleteAdminBody");
    modalConfirm.textContent = T.t("admin.deleteAdmin");
    setConfirmTone(true);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalConfirm.focus();
  }

  function updateAdminRow(id, patch) {
    API.admin.updateAdmin(id, patch).then(function (res) {
      var updated = (res && res.admin) || res;
      for (var i = 0; i < admins.length; i += 1) {
        if (admins[i].id === updated.id) { admins[i] = updated; break; }
      }
      renderAdmins();
      T.toast(T.t("admin.adminChanged"));
    }).catch(function (err) {
      if (err && err.status === 401) {
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        return;
      }
      if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
      T.toast(T.t("admin.adminError"));
    });
  }

  /* Shared copy-to-clipboard with a selection fallback for http hosts. */
  function copyToClipboard(text, button) {
    if (!text) return;
    var done = function () {
      if (!button) return;
      button.textContent = T.t("admin.codeCopied");
      setTimeout(function () { button.textContent = T.t("admin.copyCode"); }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
      return;
    }
    fallback();
    function fallback() {
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        done();
      } catch (e) { /* leave the code on screen for manual copy */ }
    }
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
    setConfirmTone(true);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalConfirm.focus();
  }

  function closeModal() {
    modal.hidden = true;
    pending = null;
    if (drawer.hidden && (!adminModal || adminModal.hidden)) document.body.style.overflow = "";
  }

  function confirmAction() {
    if (!pending) return;
    var id = pending.id;
    var kind = pending.kind;

    if (kind === "admin-activate" || kind === "admin-deactivate") {
      closeModal();
      updateAdminRow(id, { active: kind === "admin-activate" });
      return;
    }

    if (kind === "admin-role") {
      var nextRole = pending.role;
      closeModal();
      updateAdminRow(id, { role: nextRole });
      return;
    }

    if (kind === "admin-delete") {
      closeModal();
      API.admin.deleteAdmin(id).then(function () {
        admins = admins.filter(function (a) { return a.id !== id; });
        renderAdmins();
        T.toast(T.t("admin.toastAdminDeleted"));
      }).catch(function (err) {
        if (err && err.status === 401) {
          location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
          return;
        }
        if (err && err.problem && err.problem.detail) { T.toast(err.problem.detail); return; }
        T.toast(T.t("admin.adminError"));
      });
      return;
    }

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
  if (btnSaveAccount) btnSaveAccount.addEventListener("click", saveAccount);
  if (btnNewRecovery) btnNewRecovery.addEventListener("click", generateRecovery);
  if (btnAddAdmin) btnAddAdmin.addEventListener("click", openAdminModal);

  if (copyRecovery) {
    copyRecovery.addEventListener("click", function () {
      copyToClipboard(newRecoveryCode ? newRecoveryCode.textContent : "", copyRecovery);
    });
  }
  if (copyAdminCode) {
    copyAdminCode.addEventListener("click", function () {
      copyToClipboard(newAdminCode ? newAdminCode.textContent : "", copyAdminCode);
    });
  }

  if (adminModal) {
    adminModal.addEventListener("click", function (e) { if (e.target === adminModal) closeAdminModal(); });
    document.getElementById("admin-modal-cancel").addEventListener("click", closeAdminModal);
    document.getElementById("admin-modal-close").addEventListener("click", closeAdminModal);
    btnAdminSave.addEventListener("click", createAdmin);
  }

  if (adminsTbody) {
    adminsTbody.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-admin-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-admin-act");
      if (act === "make-owner") openAdminRoleConfirm(btn.getAttribute("data-id"), "owner");
      else if (act === "make-editor") openAdminRoleConfirm(btn.getAttribute("data-id"), "editor");
      else if (act === "delete") openAdminDeleteConfirm(btn.getAttribute("data-id"));
      else openAdminConfirm(btn.getAttribute("data-id"));
    });
  }

  [accEmail, accCurrent, accNew, accConfirm, recCurrent, aEmail, aPassword].forEach(function (input) {
    if (!input) return;
    input.addEventListener("input", function () {
      var field = input.closest(".field");
      if (field) field.classList.remove("has-error");
      if (input === aEmail || input === aPassword) showAdminModalError("");
    });
  });

  btnAdd.addEventListener("click", function () {
    if (activeTab !== "products") activateTab("products");
    openDrawer(null);
  });

  if (btnSignOut) btnSignOut.addEventListener("click", function () {
    API.admin.signOut().catch(function () { /* sign out locally anyway */ })
      .then(function () { location.href = "admin-login.html"; });
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
      var r1 = findRow(id);
      if (!r1) return;
      API.admin.setPublication(id, "draft", r1.version).then(function (updated) {
        replaceRow(updated);
        T.toast(T.t("admin.toastRestored"));
        render();
      }).catch(apiErrorToast);
      return;
    }

    if (act === "stock") {
      var r2 = findRow(id);
      if (!r2) return;
      API.admin.setStock(id, r2.stock === "in" ? "out" : "in", r2.version).then(function (updated) {
        replaceRow(updated);
        T.toast(T.t(updated.stock === "in" ? "admin.toastStockIn" : "admin.toastStockOut"));
        render();
      }).catch(apiErrorToast);
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
      if (adminModal && !adminModal.hidden) closeAdminModal();
      else if (!modal.hidden) closeModal();
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
    if (canManageAdmins() && adminsLoaded) renderAdmins();
    setRecoveryStatus();
    if (!drawer.hidden) drawerTitle.textContent = T.t(editingId ? "admin.drawerEdit" : "admin.drawerAdd");
  });

  /* ---------- Init ---------- */
  function openFromParams() {
    if (T.param("drawer") === "add") openDrawer(null);
    if (T.param("drawer") === "edit") openDrawer(T.param("id") || "robux-1000");
  }

  function initApiMode() {
    wireUpload();

    API.admin.session()
      .catch(function (err) {
        /* The server gates /admin.html too — this is belt and braces. */
        location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
        throw err;
      })
      .then(function (res) {
        markAuthed();
        currentAdmin = (res && res.admin) || null;
        if (currentAdmin) {
          if (userNameEl) {
            userNameEl.removeAttribute("data-i18n");
            userNameEl.textContent = currentAdmin.email;
          }
          if (accountCard) accountCard.hidden = false;
          if (recoveryCard) recoveryCard.hidden = false;
          fillAccount();
          setRecoveryStatus();
          setTeamVisible();
        }
        return loadRows().catch(function () { T.toast(T.t("admin.saveError")); });
      })
      .then(function () {
        openFromParams();
        var tab = T.param("tab");
        if (tab === "settings") activateTab("settings");
        else if (tab === "account") activateTab("account");
        else if (tab === "team" && canManageAdmins()) activateTab("team");
      })
      .catch(function () { /* session redirect already handled */ });
  }

  function initStaticMode() {
    /* Admin data lives on the server. Without the backend this page has
       nothing to show, so send the visitor to the sign-in screen, which
       explains that the server version is required. */
    location.replace("admin-login.html?next=" + encodeURIComponent("admin.html" + location.search));
  }

  document.addEventListener("bb:ready", function () {
    renderCategoryOptions();
    updateSku();
    activateTab("products");

    if (isApiMode()) initApiMode();
    else initStaticMode();
  });
})();
