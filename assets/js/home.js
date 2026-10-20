/* =========================================================
   BloxBazaar BD — home.js
   Renders the featured-items grid (eligible, in-stock,
   published items only) and the game-guide cards.
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB, C = window.BB_COMP;

  function render() {
    var featured = document.getElementById("featured-grid");
    if (featured) {
      var items = BB_DATA.products.filter(function (p) {
        return p.publication === "published" && p.eligibility === "approved" && p.featured;
      });
      featured.innerHTML = items.map(C.productCard).join("");
    }

    var games = document.getElementById("games-grid");
    if (games) {
      // Game tiles use the category's own cover art when set; otherwise they
      // fall back to the first product image in that category.
      var img = {};
      BB_DATA.products.forEach(function (p) {
        if (p.image && !img[p.category]) img[p.category] = p.image;
      });
      games.innerHTML = BB_DATA.categories.map(function (c) {
        var n = BB_DATA.products.filter(function (p) {
          return p.category === c.id && p.publication === "published" && p.eligibility === "approved";
        }).length;
        var src = c.image || img[c.id];
        var count = T.getLang() === "bn" ? T.toBnDigits(n) : n;
        return '<a class="game-tile' + C.catClass(c.id) + '" href="catalogue.html?category=' + encodeURIComponent(c.id) + '">' +
          (src ? '<span class="gt-img"><img src="' + T.esc(src) + '" alt="" loading="lazy" decoding="async"></span>' : "") +
          '<span class="gt-body">' +
            '<span class="gt-name">' + T.esc(T.bg(c)) + "</span>" +
            '<span class="gt-count">' + T.t("home.gamesItems", { n: count }) + "</span>" +
          "</span>" +
        "</a>";
      }).join("");
    }

    var guides = document.getElementById("guides-grid");
    if (guides) {
      guides.innerHTML = Object.keys(BB_GUIDES).map(function (id) {
        return C.guideCard(BB_GUIDES[id]);
      }).join("");
    }
  }

  document.addEventListener("bb:langchange", render);
  document.addEventListener("bb:ready", render);
})();
