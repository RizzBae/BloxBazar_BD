/* =========================================================
   BloxBazaar BD — guides.js
   Renders a game guide from BB_GUIDES into #guide-root.
   Informational only: no prices, no order actions.
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB;

  var root = document.getElementById("guide-root");
  var gameId = root ? root.getAttribute("data-game") : null;

  function crumbHtml(label) {
    return '<a href="index.html">' + T.t("nav.home") + "</a>" +
      '<span class="sep" aria-hidden="true">/</span><span>' + T.t("nav.guides") + "</span>" +
      '<span class="sep" aria-hidden="true">/</span><span>' + T.esc(label) + "</span>";
  }

  function wayCard(w) {
    var link = "";
    if (w.link) {
      link = '<a class="way-link" href="' + T.esc(w.link) + '"' + (w.internal ? "" : ' target="_blank" rel="noopener"') + ">" +
        '<span>' + T.esc(T.bg(w.linkLabel)) + "</span>" + (w.internal ? T.icon.arrowRight : T.icon.external) +
      "</a>";
    }
    return '<div class="way-card">' +
      '<div class="way-title">' + T.esc(T.bg(w.title)) + "</div>" +
      '<p class="way-desc">' + T.esc(T.bg(w.desc)) + "</p>" + link +
    "</div>";
  }

  function linkCard(l) {
    return '<a class="link-card" href="' + T.esc(l.url) + '" target="_blank" rel="noopener">' +
      '<span class="lc-top"><span class="lc-title">' + T.esc(T.bg(l.label)) + "</span>" + T.icon.external + "</span>" +
      '<span class="lc-desc">' + T.esc(T.bg(l.note)) + "</span>" +
    "</a>";
  }

  function render() {
    if (!root) return;
    var g = window.BB_GUIDES[gameId];
    if (!g) return;

    var name = T.bg(g.name);
    document.title = name + " — " + T.t("guides.eyebrow") + " — BloxBazaar BD";

    var crumb = document.getElementById("guide-breadcrumb");
    if (crumb) crumb.innerHTML = crumbHtml(name);

    var ways = g.ways.map(wayCard).join("");
    var safety = g.safety.map(function (s) {
      return "<li>" + T.icon.alert + "<span>" + T.esc(T.bg(s)) + "</span></li>";
    }).join("");
    var links = g.links.map(linkCard).join("");

    var others = Object.keys(BB_GUIDES).filter(function (id) { return id !== g.id; });
    var more = others.map(function (id) {
      var og = BB_GUIDES[id];
      return '<a class="more-link" href="guide-' + T.esc(id) + '.html">' +
        "<span>" + T.esc(T.bg(og.name)) + "</span>" + T.icon.arrowRight +
      "</a>";
    }).join("");

    root.innerHTML =
      '<header class="guide-hero">' +
        '<div class="guide-monogram ' + (g.tone ? "tone-" + g.tone : "") + '" aria-hidden="true">' + T.esc(g.monogram) + "</div>" +
        '<div class="guide-hero-main">' +
          '<div class="guide-hero-meta">' +
            '<span class="badge badge-info">' + T.t("guides.informational") + "</span>" +
          "</div>" +
          '<h1 class="guide-hero-title">' + T.esc(name) + "</h1>" +
          '<p class="guide-hero-sub">' + T.esc(T.bg(g.tagline)) + "</p>" +
        "</div>" +
        '<div class="guide-hero-meta">' +
          '<span class="badge">' + T.t("guides.updated") + " · " + T.fmtDate(g.updated) + "</span>" +
        "</div>" +
      "</header>" +

      '<p class="guide-intro">' + T.esc(T.bg(g.intro)) + "</p>" +

      '<section class="guide-section"><h2>' + T.t("guides.ways") + '</h2><div class="ways">' + ways + "</div></section>" +

      '<section class="guide-section"><h2>' + T.t("guides.safety") + '</h2><ul class="safety-list">' + safety + "</ul></section>" +

      '<section class="guide-section"><h2>' + T.t("guides.links") + '</h2><div class="link-cards">' + links + "</div></section>" +

      '<section class="guide-section">' +
        '<div class="notice notice-unofficial">' + T.icon.shield + "<span>" + T.t("guides.disclaimer") + "</span></div>" +
      "</section>" +

      '<section class="guide-section">' +
        '<div class="notice notice-accent">' + T.icon.info +
          "<span><strong>" + T.t("guides.notSure") + "</strong> " + T.t("guides.notSureDesc") +
          ' <a href="contact.html">' + T.t("cta.askSupport") + "</a></span>" +
        "</div>" +
      "</section>" +

      '<section class="guide-section"><h2>' + T.t("guides.more") + '</h2><div class="guide-more">' + more + "</div></section>";
  }

  document.addEventListener("bb:langchange", render);
  document.addEventListener("bb:ready", render);
})();
