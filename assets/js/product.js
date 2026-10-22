/* =========================================================
   BloxBazaar BD — product.js
   Product detail with quantity picker (or Robux amount picker)
   and the WhatsApp order handoff.
   States: in stock / out of stock / loading / error / not found.
   Preview: product.html?id=robux-1000 | ?id=robux-custom |
            product.html?id=bf-fruit-notifier (out of stock) |
            ?state=loading|error
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB, C = window.BB_COMP;

  var root = document.getElementById("pd-root");
  var crumb = document.getElementById("pd-breadcrumb");
  var forced = T.param("state");
  var qty = 1;

  function findProduct(id) {
    var list = BB_DATA.products;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        /* Public visibility: published + approved only */
        if (list[i].publication === "published" && list[i].eligibility === "approved") return list[i];
        return null;
      }
    }
    return null;
  }

  /* ---------- Persisted Roblox username (delivery info) ---------- */
  function readId() {
    try { return localStorage.getItem("bb_rbx_id") || ""; } catch (e) { return ""; }
  }
  function saveId(v) {
    try { localStorage.setItem("bb_rbx_id", v); } catch (e) { /* ignore */ }
  }

  function crumbHtml(label) {
    var html = '<a href="catalogue.html">' + T.t("prod.breadcrumb") + "</a>";
    if (label) html += '<span class="sep" aria-hidden="true">/</span><span>' + T.esc(label) + "</span>";
    return html;
  }

  /* ---------- Skeleton / error / not found ---------- */
  function renderSkeleton() {
    crumb.innerHTML = crumbHtml(null);
    root.innerHTML =
      '<div class="pd-grid" aria-hidden="true">' +
        '<div class="skeleton" style="aspect-ratio: 4 / 3;"></div>' +
        '<div style="display:grid;gap:14px;padding-top:6px">' +
          '<div class="sk-line" style="width:30%"></div>' +
          '<div class="sk-line" style="width:65%;height:26px"></div>' +
          '<div class="sk-line" style="width:45%"></div>' +
          '<div class="sk-line" style="width:90%"></div>' +
          '<div class="sk-line" style="width:80%"></div>' +
          '<div class="sk-line" style="width:240px;height:44px"></div>' +
        "</div>" +
      "</div>";
  }

  function stateActions(extra) {
    return '<div class="es-actions">' +
      (extra || "") +
      '<a class="btn btn-secondary" href="catalogue.html">' + T.t("cta.backToCatalogue") + "</a>" +
      "</div>";
  }

  function renderError() {
    crumb.innerHTML = crumbHtml(null);
    root.innerHTML =
      '<div class="error-state mt-24">' +
        '<div class="es-icon">' + T.icon.alert + "</div>" +
        '<div class="es-title">' + T.t("prod.error.title") + "</div>" +
        '<p class="es-desc">' + T.t("prod.error.desc") + "</p>" +
        stateActions('<button class="btn btn-primary" type="button" id="pd-retry">' + T.t("cta.tryAgain") + "</button>") +
      "</div>";
    var b = document.getElementById("pd-retry");
    if (b) b.addEventListener("click", function () {
      forced = null;
      try {
        var url = new URL(location.href);
        url.searchParams.delete("state");
        history.replaceState(null, "", url.toString());
      } catch (e) { /* file:// */ }
      render();
    });
  }

  function renderNotFound() {
    document.title = "Product not available — BloxBazaar BD";
    crumb.innerHTML = crumbHtml(null);
    root.innerHTML =
      '<div class="empty-state mt-24">' +
        '<div class="es-icon">' + T.icon.search + "</div>" +
        '<div class="es-title">' + T.t("prod.notFound.title") + "</div>" +
        '<p class="es-desc">' + T.t("prod.notFound.desc") + "</p>" +
        stateActions("") +
      "</div>";
  }

  /* ---------- Shared parts ---------- */
  function mediaTile(p) {
    var name = T.bg(p.name);
    return '<div class="pd-media' + C.toneClass(p.tone) + '">' +
      (p.image
        ? '<img src="' + T.esc(p.image) + '" alt="' + T.esc(name) + '" decoding="async">'
        : '<span class="pd-monogram" aria-hidden="true">' + T.esc(p.monogram) + "</span>") +
      (p.tag
        ? '<div class="pd-badges"><span class="badge badge-info">' + T.esc(T.bg(p.tag)) + "</span></div>"
        : "") +
    "</div>";
  }

  function metaBlock(p, stockBadgeHtml) {
    return '<div class="pd-meta">' +
      '<div class="meta-row"><span class="meta-label">' + T.t("prod.sku") + '</span><span class="meta-value">' + T.esc(p.sku) + "</span></div>" +
      '<div class="meta-row"><span class="meta-label">' + T.t("prod.stockLabel") + '</span><span class="meta-value">' + stockBadgeHtml + "</span></div>" +
      '<div class="meta-row"><span class="meta-label">' + T.t("prod.updated") + '</span><span class="meta-value">' + T.fmtDate(p.updated) + "</span></div>" +
    "</div>";
  }

  function includesBlock(p) {
    var items = (p.includes || []).map(function (it) {
      return '<li>' + T.icon.check + "<span>" + T.esc(T.bg(it)) + "</span></li>";
    }).join("");
    return '<div class="pd-section"><h2>' + T.t("prod.includes") + "</h2><ul class=\"includes\">" + items + "</ul></div>";
  }

  function termsBlock() {
    return '<div class="pd-section"><h2>' + T.t("prod.orderTerms") + "</h2>" +
      '<div class="terms-card"><ul>' +
        '<li>' + T.icon.shield + "<span>" + T.t("prod.term1") + "</span></li>" +
        '<li>' + T.icon.shield + "<span>" + T.t("prod.term2") + "</span></li>" +
        '<li>' + T.icon.info + "<span>" + T.t("prod.term3") + "</span></li>" +
      "</ul></div></div>";
  }

  /* ---------- Product templates ---------- */
  function renderProduct(p) {
    var name = T.bg(p.name);
    document.title = name + " — BloxBazaar BD";
    crumb.innerHTML = crumbHtml(name);

    var inStock = p.stock === "in";
    var isRobux = p.category === "robux";
    var badge = C.stockBadge(p);
    var rules = BB_DATA.robuxRules;
    var amt0 = isRobux
      ? Math.min(rules.max, Math.max(rules.min, Math.round(p.robuxAmount || rules.defaultAmount)))
      : 0;

    var idField =
      '<div class="order-id">' +
        '<label class="qty-label" for="rbx-id">' + T.t("prod.rboxId") + "</label>" +
        '<input class="input" id="rbx-id" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="20" value="' + T.esc(readId()) + '" aria-describedby="rbx-id-hint">' +
        '<p class="field-hint" id="rbx-id-hint">' + T.t("prod.rboxIdHint") + "</p>" +
      "</div>";

    var orderArea;
    if (inStock && isRobux) {
      orderArea =
        idField +
        '<div class="amt-row">' +
          '<span class="qty-label">' + T.t("prod.amountLabel") + "</span>" +
          '<div class="amt-chips" role="group" aria-label="' + T.t("prod.amountLabel") + '">' +
            rules.presets.map(function (a) {
              return '<button type="button" class="chip amt-chip" data-amt="' + a + '" aria-pressed="false">' + Number(a).toLocaleString("en-US") + "</button>";
            }).join("") +
          "</div>" +
          '<div class="amt-custom">' +
            '<input class="input amt-input" id="amt-input" type="number" inputmode="numeric" min="' + rules.min + '" max="' + rules.max + '" step="10" value="' + amt0 + '" aria-label="' + T.t("prod.amountLabel") + '">' +
            '<span class="amt-unit">Robux</span>' +
          "</div>" +
          '<p class="field-hint">' + T.t("prod.amountHint", { min: Number(rules.min).toLocaleString("en-US"), max: Number(rules.max).toLocaleString("en-US") }) + "</p>" +
        "</div>" +
        '<div class="pd-actions">' +
          '<a class="btn btn-wa btn-lg" id="pd-order" href="' + T.robuxWaLink(p, amt0, T.robuxPrice(amt0), readId()) + '" target="_blank" rel="noopener">' +
            T.icon.whatsapp + "<span>" + T.t("cta.orderWa") + "</span>" +
          "</a>" +
          '<p class="wa-note">' + T.icon.info + "<span>" + T.t("prod.waNote") + "</span></p>" +
        "</div>";
    } else if (inStock) {
      orderArea =
        idField +
        '<div class="qty-row">' +
          '<span class="qty-label" id="qty-label">' + T.t("prod.qty") + "</span>" +
          '<div class="qty" role="group" aria-labelledby="qty-label">' +
            '<button type="button" class="qty-btn" id="qty-minus" aria-label="' + T.t("prod.decrease") + '">−</button>' +
            '<input class="qty-input" id="qty-input" type="number" inputmode="numeric" min="1" max="10" value="' + qty + '" aria-label="' + T.t("prod.qty") + '">' +
            '<button type="button" class="qty-btn" id="qty-plus" aria-label="' + T.t("prod.increase") + '">+</button>' +
          "</div>" +
        "</div>" +
        '<div class="pd-actions">' +
          '<a class="btn btn-wa btn-lg" id="pd-order" href="' + T.productWaLink(p, qty, readId()) + '" target="_blank" rel="noopener">' +
            T.icon.whatsapp + "<span>" + T.t("cta.orderWa") + "</span>" +
          "</a>" +
          '<p class="wa-note">' + T.icon.info + "<span>" + T.t("prod.waNote") + "</span></p>" +
        "</div>";
    } else {
      orderArea =
        '<div class="notice notice-warn mt-24" style="max-width: 520px;">' + T.icon.alert +
          "<span><strong>" + T.t("prod.outTitle") + ".</strong> " + T.t("prod.outDesc") + "</span>" +
        "</div>" +
        '<div class="pd-actions">' +
          '<a class="btn btn-secondary" href="contact.html">' + T.t("cta.askSupport") + "</a>" +
        "</div>";
    }

    var priceRow;
    if (isRobux) {
      priceRow =
        '<span class="pd-price"><small>BDT</small><span id="pd-price-val">' + Number(T.robuxPrice(amt0)).toLocaleString("en-US") + "</span></span>" +
        badge;
    } else {
      priceRow =
        '<span class="pd-price"><small>BDT</small>' + Number(p.price).toLocaleString("en-US") + "</span>" +
        (C.discountPct(p) > 0
          ? '<s class="pd-old">BDT ' + Number(p.listPrice).toLocaleString("en-US") + "</s>" +
            '<span class="pd-off">−' + C.discountPct(p) + "%</span>"
          : "") +
        badge;
    }

    root.innerHTML =
      '<div class="pd-grid">' +
        mediaTile(p) +
        "<div>" +
          '<div class="pd-cat cat-pill' + C.catClass(p.category) + '">' + T.esc(T.catLabel(p.category)) + "</div>" +
          '<h1 class="pd-title">' + T.esc(name) + "</h1>" +
          '<div class="pd-price-row">' + priceRow + "</div>" +
          '<p class="pd-desc">' + T.esc(T.bg(p.description)) + "</p>" +
          orderArea +
          metaBlock(p, badge) +
        "</div>" +
      "</div>" +
      includesBlock(p) +
      termsBlock();

    wireOrder(p);
  }

  function wireOrder(p) {
    var order = document.getElementById("pd-order");
    if (!order) return;
    var idInput = document.getElementById("rbx-id");

    function bindId(updateFn) {
      if (!idInput) return;
      var apply = function () {
        var v = String(idInput.value || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
        if (v !== idInput.value) idInput.value = v;
        saveId(v);
        updateFn();
      };
      idInput.addEventListener("input", apply);
      idInput.addEventListener("change", apply);
    }

    if (p.category === "robux") {
      var amtInput = document.getElementById("amt-input");
      var priceEl = document.getElementById("pd-price-val");
      var chips = Array.prototype.slice.call(document.querySelectorAll(".amt-chip"));
      var rules = BB_DATA.robuxRules;
      var amount = Math.min(rules.max, Math.max(rules.min, Math.round(p.robuxAmount || rules.defaultAmount)));

      var update = function () {
        var price = T.robuxPrice(amount);
        if (priceEl) priceEl.textContent = Number(price).toLocaleString("en-US");
        chips.forEach(function (c) {
          var on = Number(c.getAttribute("data-amt")) === amount;
          c.classList.toggle("is-active", on);
          c.setAttribute("aria-pressed", String(on));
        });
        order.setAttribute("href", T.robuxWaLink(p, amount, price, idInput ? idInput.value : ""));
      };

      var apply = function (raw, finalize) {
        var n = Math.round(Number(raw));
        if (isNaN(n)) return;
        if (n > rules.max) n = rules.max;
        if (n < rules.min) {
          if (!finalize) return; /* still typing */
          n = rules.min;
        }
        amount = n;
        amtInput.value = n;
        update();
      };

      chips.forEach(function (c) {
        c.addEventListener("click", function () { apply(c.getAttribute("data-amt"), true); });
      });
      amtInput.addEventListener("input", function () { apply(amtInput.value, false); });
      amtInput.addEventListener("change", function () { apply(amtInput.value, true); });

      bindId(update);
      update();
      return;
    }

    var input = document.getElementById("qty-input");
    if (!input) return;

    var updateQty = function () {
      qty = Math.max(1, Math.min(10, Number(input.value) || 1));
      input.value = qty;
      order.setAttribute("href", T.productWaLink(p, qty, idInput ? idInput.value : ""));
    };
    document.getElementById("qty-minus").addEventListener("click", function () { input.value = qty - 1; updateQty(); });
    document.getElementById("qty-plus").addEventListener("click", function () { input.value = qty + 1; updateQty(); });
    input.addEventListener("change", updateQty);
    input.addEventListener("input", updateQty);

    bindId(updateQty);
  }

  /* ---------- Render loop ---------- */
  function render() {
    if (forced === "loading") {
      renderSkeleton();
      setTimeout(function () { forced = null; render(); }, 3000);
      return;
    }
    if (forced === "error") { renderError(); return; }

    var id = T.param("id");
    if (!id) { renderNotFound(); return; }

    var p = findProduct(id);
    if (p) { renderProduct(p); return; }

    renderNotFound();
  }

  document.addEventListener("bb:langchange", render);
  document.addEventListener("bb:ready", render);
})();
