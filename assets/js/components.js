/* =========================================================
   BloxBazaar BD — components.js
   Shared card builders used by home, catalogue, and product.
   Media: real product photos, monogram tile as fallback.
   ========================================================= */

window.BB_COMP = (function () {
  "use strict";

  var T = window.BB;

  function toneClass(tone) {
    if (tone === "green") return " pc-tone-green";
    if (tone === "sand") return " pc-tone-sand";
    return "";
  }

  /* Category tint class (see base.css → Category tints) */
  function catClass(cat) {
    var known = { robux: 1, "blox-fruits": 1, mm2: 1, rivals: 1, "steal-a-brainrot": 1 };
    return cat && known[cat] ? " cat-" + cat : "";
  }

  function stockBadge(p) {
    if (p.stock === "in") {
      return '<span class="badge badge-in badge-dot">' + T.t("badge.inStock") + "</span>";
    }
    return '<span class="badge badge-out badge-dot">' + T.t("badge.outOfStock") + "</span>";
  }

  /* Percentage off when a struck-through listPrice is present. */
  function discountPct(p) {
    if (!p.listPrice || p.listPrice <= p.price) return 0;
    return Math.round((1 - p.price / p.listPrice) * 100);
  }

  function productCard(p) {
    var name = T.bg(p.name);
    var off = discountPct(p);
    return '<a class="product-card" href="product.html?id=' + encodeURIComponent(p.id) + '">' +
      '<span class="pc-media' + toneClass(p.tone) + '">' +
        (p.image
          ? '<img src="' + T.esc(p.image) + '" alt="' + T.esc(name) + '" loading="lazy" decoding="async">'
          : '<span class="pc-monogram" aria-hidden="true">' + T.esc(p.monogram) + "</span>") +
        (p.tag ? '<span class="pc-tag">' + T.esc(T.bg(p.tag)) + "</span>" : "") +
      "</span>" +
      '<span class="pc-body">' +
        '<span class="pc-cat cat-pill' + catClass(p.category) + '">' + T.esc(T.catLabel(p.category)) + "</span>" +
        '<span class="pc-name">' + T.esc(name) + "</span>" +
        '<span class="pc-foot">' +
          '<span class="pc-prices">' +
            '<span class="pc-price"><small>' + (p.priceFrom ? T.t("prod.fromBdt") : "BDT") + '</small>' + Number(p.price).toLocaleString("en-US") + "</span>" +
            (off > 0
              ? '<s class="pc-old">' + Number(p.listPrice).toLocaleString("en-US") + "</s>" +
                '<span class="pc-off">−' + off + "%</span>"
              : "") +
          "</span>" +
          stockBadge(p) +
        "</span>" +
      "</span>" +
    "</a>";
  }

  function guideCard(g) {
    return '<a class="guide-card' + catClass(g.id) + '" href="guide-' + g.id + '.html">' +
      '<span class="gc-top">' +
        '<span class="gc-name">' + T.esc(T.bg(g.name)) + "</span>" +
        '<span class="badge badge-info">' + T.t("badge.guide") + "</span>" +
      "</span>" +
      '<span class="gc-desc">' + T.esc(T.bg(g.tagline)) + "</span>" +
      '<span class="gc-link">' + T.t("cta.readGuide") + T.icon.arrowRight + "</span>" +
    "</a>";
  }

  return {
    productCard: productCard,
    guideCard: guideCard,
    stockBadge: stockBadge,
    toneClass: toneClass,
    catClass: catClass,
    discountPct: discountPct
  };
})();
