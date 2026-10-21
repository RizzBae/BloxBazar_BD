/* =========================================================
   BloxBazaar BD — catalogue.js
   Search, category filter, optional price range, result
   count, and designed empty / loading / error states.
   State preview: catalogue.html?state=loading|empty|error
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB, C = window.BB_COMP;

  var grid = document.getElementById("cat-grid");
  var stateBox = document.getElementById("cat-state");
  var metaEl = document.getElementById("results-meta");
  var qInput = document.getElementById("cat-q");
  var minInput = document.getElementById("cat-min");
  var maxInput = document.getElementById("cat-max");
  var clearBtn = document.getElementById("cat-clear");
  var chipsEl = document.getElementById("cat-chips");

  /* Filled from the data bundle when it is ready (bb:ready). */
  var publicProducts = [];

  var state = {
    q: T.param("q") || "",
    cat: T.param("category") || T.param("cat") || "all",
    min: null,
    max: null,
    forced: T.param("state") || null
  };

  if (state.q) qInput.value = state.q;

  /* ---------- Filtering ---------- */
  function matches(p) {
    if (state.cat !== "all" && p.category !== state.cat) return false;
    if (state.min != null && p.price < state.min) return false;
    if (state.max != null && p.price > state.max) return false;
    if (state.q) {
      var hay = [p.name.en, p.name.bn, p.sku, T.catLabel(p.category)].join(" ").toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function visibleProducts() { return publicProducts.filter(matches); }

  /* ---------- Chips ---------- */
  function renderChips() {
    var items = [{ id: "all", label: T.t("cat.all"), count: publicProducts.length }];
    BB_DATA.categories.forEach(function (c) {
      var n = publicProducts.filter(function (p) { return p.category === c.id; }).length;
      if (n > 0) items.push({ id: c.id, label: T.bg(c), count: n });
    });
    chipsEl.innerHTML = items.map(function (it) {
      var active = state.cat === it.id ? " is-active" : "";
      var cat = it.id === "all" ? "" : C.catClass(it.id);
      return '<button type="button" class="chip' + cat + active + '" data-cat="' + T.esc(it.id) + '" aria-pressed="' + (state.cat === it.id) + '">' +
        (cat ? '<span class="cat-dot' + cat + '"></span>' : "") +
        T.esc(it.label) + ' <span class="chip-count">' + (T.getLang() === "bn" ? T.toBnDigits(it.count) : it.count) + "</span></button>";
    }).join("");
    T.$$(".chip", chipsEl).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.cat = btn.getAttribute("data-cat");
        render();
      });
    });
  }

  /* ---------- Designed states ---------- */
  function skeletonGrid() {
    var out = "";
    for (var i = 0; i < 8; i++) out += '<div class="skeleton sk-card" aria-hidden="true"></div>';
    grid.innerHTML = out;
    stateBox.innerHTML = "";
    metaEl.textContent = "";
  }

  function showEmpty(forced) {
    grid.innerHTML = "";
    stateBox.innerHTML =
      '<div class="empty-state">' +
        '<div class="es-icon">' + T.icon.search + "</div>" +
        '<div class="es-title">' + T.t("cat.empty.title") + "</div>" +
        '<p class="es-desc">' + T.t("cat.empty.desc") + "</p>" +
        '<div class="es-actions">' +
          '<button class="btn btn-secondary" type="button" id="cat-empty-clear">' + T.t("cta.clearFilters") + "</button>" +
        "</div>" +
      "</div>";
    var b = document.getElementById("cat-empty-clear");
    if (b) b.addEventListener("click", function () { if (forced) clearForced(); resetFilters(); });
  }

  function showError() {
    grid.innerHTML = "";
    stateBox.innerHTML =
      '<div class="error-state">' +
        '<div class="es-icon">' + T.icon.alert + "</div>" +
        '<div class="es-title">' + T.t("cat.error.title") + "</div>" +
        '<p class="es-desc">' + T.t("cat.error.desc") + "</p>" +
        '<div class="es-actions">' +
          '<button class="btn btn-primary" type="button" id="cat-retry">' + T.t("cta.tryAgain") + "</button>" +
        "</div>" +
      "</div>";
    var b = document.getElementById("cat-retry");
    if (b) b.addEventListener("click", function () { clearForced(); render(); });
  }

  function clearForced() {
    state.forced = null;
    try {
      var url = new URL(location.href);
      url.searchParams.delete("state");
      history.replaceState(null, "", url.toString());
    } catch (e) { /* file:// fallback */ }
  }

  /* ---------- Render ---------- */
  function render() {
    renderChips();

    if (state.forced === "error") { showError(); return; }
    if (state.forced === "empty") { showEmpty(true); return; }
    if (state.forced === "loading") {
      skeletonGrid();
      setTimeout(function () { state.forced = null; render(); }, 3000);
      return;
    }

    var items = visibleProducts();
    stateBox.innerHTML = "";

    if (items.length === 0) { showEmpty(false); metaEl.textContent = ""; return; }

    grid.innerHTML = items.map(C.productCard).join("");
    var n = items.length;
    var labelKey = n === 1 ? "cat.showingOne" : "cat.showing";
    var nText = T.getLang() === "bn" ? T.toBnDigits(n) : n;
    metaEl.textContent = T.t(labelKey, { n: nText });
  }

  /* ---------- Filters wiring ---------- */
  function resetFilters() {
    state.q = ""; state.cat = "all"; state.min = null; state.max = null;
    qInput.value = ""; minInput.value = ""; maxInput.value = "";
    render();
  }

  var debounce;
  function onInput() {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      state.q = qInput.value.trim();
      state.min = minInput.value === "" ? null : Number(minInput.value);
      state.max = maxInput.value === "" ? null : Number(maxInput.value);
      render();
    }, 160);
  }

  qInput.addEventListener("input", onInput);
  minInput.addEventListener("input", onInput);
  maxInput.addEventListener("input", onInput);
  clearBtn.addEventListener("click", function () { resetFilters(); });
  document.addEventListener("bb:langchange", render);

  document.addEventListener("bb:ready", function () {
    /* Public catalogue = published + eligibility approved */
    publicProducts = (window.BB_DATA.products || []).filter(function (p) {
      return p.publication === "published" && p.eligibility === "approved";
    });
    if (state.cat !== "all" && !(window.BB_DATA.categories || []).some(function (c) { return c.id === state.cat; })) {
      state.cat = "all";
    }

    /* Brief skeleton pass so the loading state is part of the design */
    skeletonGrid();
    setTimeout(render, 450);
  });
})();
