/* =========================================================
   BloxBazaar BD — site.js
   Shared chrome (header/footer), language control, helpers,
   WhatsApp link building, toasts, state-preview banners.
   ========================================================= */

window.BB = (function () {
  "use strict";

  /* ---------- Lang state ---------- */
  var lang = "en";
  try { lang = localStorage.getItem("bb_lang") || "en"; } catch (e) { /* file:// */ }
  if (lang !== "bn" && lang !== "en") lang = "en";

  /* ---------- Tiny helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function param(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  /* Bilingual value: object {en,bn} or plain string */
  function bg(v) {
    if (v == null) return "";
    if (typeof v === "object") return v[lang] || v.en || "";
    return String(v);
  }

  function t(key, vars) {
    var dict = (window.BB_STRINGS && (window.BB_STRINGS[lang] || window.BB_STRINGS.en)) || {};
    var s = dict[key] != null ? dict[key] : ((window.BB_STRINGS && window.BB_STRINGS.en[key]) || key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtBDT(n) {
    return "BDT " + Number(n || 0).toLocaleString("en-US");
  }

  var bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  function toBnDigits(s) {
    return String(s).replace(/\d/g, function (d) { return bnDigits[Number(d)]; });
  }

  var monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthsBn = ["জানু", "ফেব", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্ট", "অক্টো", "নভে", "ডিসে"];

  /* iso: "2026-10-12" -> "12 Oct 2026" / "১২ অক্টো ২০২৬" */
  function fmtDate(iso) {
    if (!iso) return "";
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    var d = Number(p[2]), m = Number(p[1]) - 1, y = p[0];
    if (lang === "bn") return toBnDigits(d) + " " + monthsBn[m] + " " + toBnDigits(y);
    return d + " " + monthsEn[m] + " " + y;
  }

  function catLabel(id) {
    var cats = (window.BB_DATA && BB_DATA.categories) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return bg(cats[i]);
    return id;
  }

  function currentPage() {
    var name = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    return name || "index.html";
  }

  /* ---------- Icons (minimal inline SVG) ---------- */
  var I = {
    search: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
    whatsapp: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>',
    chevron: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    menu: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>',
    checkCircle: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
    alert: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>',
    shield: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.5 3 7.8 7.5 9.5 4.5-1.7 7.5-5 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4.5"/></svg>',
    archive: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"/><path d="M10 11v6m4-6v6"/></svg>',
    restore: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.3"/><path d="M3 4v5h5"/></svg>',
    edit: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14m-7-7h14"/></svg>',
    arrowLeft: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg>',
    arrowRight: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>',
    external: '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    eye: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    eyeOff: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.5 5.7A9.8 9.8 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17 17 0 0 1-3 3.9M6.4 6.4A16.6 16.6 0 0 0 2 12s3.5 6.5 10 6.5c1.8 0 3.4-.5 4.7-1.2"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/></svg>',
    image: '<svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-4.5-4.5L7 21"/></svg>',
    inbox: '<svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5.5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5l2.5-7.5Z"/></svg>',
    clock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    mail: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>'
  };

  /* ---------- WhatsApp links ---------- */
  function waLink(message) {
    var num = ((window.BB_DATA && BB_DATA.whatsappNumber) || "").replace(/[^\d]/g, "");
    var base = num ? "https://wa.me/" + num : "https://wa.me/";
    return message ? base + "?text=" + encodeURIComponent(message) : base;
  }

  /* Custom order-message templates (admin panel → Shop settings).
     Empty values fall back to the built-in localized messages
     (`wa.order` / `wa.orderRobux` in i18n.js).
     Placeholders — product: {brand} {name} {sku} {qty} {price}
     {robloxId} {robloxIdLine} {url}; Robux: {brand} {name} {amount}
     {price} {robloxId} {robloxIdLine} {url}.
     {robloxIdLine} is a ready-made " Roblox ID: name." fragment that
     is empty when the visitor did not enter a username. */
  function customTemplate(kind) {
    var tpls = (window.BB_DATA && BB_DATA.whatsappTemplates) || {};
    var v = tpls[kind];
    return typeof v === "string" ? v.trim() : "";
  }

  function fillTemplate(tpl, vars) {
    Object.keys(vars).forEach(function (k) {
      tpl = tpl.split("{" + k + "}").join(String(vars[k]));
    });
    return tpl;
  }

  function sanitizeRbxId(rbxId) {
    return String(rbxId || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
  }

  function brandName() {
    return (window.BB_DATA && BB_DATA.brand) || "BloxBazaar BD";
  }

  function productWaLink(product, qty, rbxId) {
    var id = sanitizeRbxId(rbxId);
    var url = location.href.split("#")[0];
    var price = Number(product.price || 0).toLocaleString("en-US");
    var custom = customTemplate("product");
    if (custom) {
      return waLink(fillTemplate(custom, {
        brand: brandName(),
        name: bg(product.name),
        sku: product.sku,
        qty: qty,
        price: price,
        robloxId: id,
        robloxIdLine: id ? " Roblox ID: " + id + "." : "",
        url: url
      }));
    }
    return waLink(t("wa.order", {
      name: bg(product.name),
      sku: product.sku,
      qty: qty,
      idLine: id ? t("wa.idLine", { id: id }) : "",
      price: price,
      url: url
    }));
  }

  /* ---------- Robux custom amount ---------- */
  function robuxPrice(amount) {
    var rules = (window.BB_DATA && BB_DATA.robuxRules) || { tiers: [{ from: 0, rate: 1 }] };
    var a = Number(amount) || 0;
    var rate = rules.tiers[rules.tiers.length - 1].rate;
    for (var i = 0; i < rules.tiers.length; i++) {
      if (a >= rules.tiers[i].from) { rate = rules.tiers[i].rate; break; }
    }
    return Math.round(a * rate);
  }

  function robuxWaLink(product, amount, price, rbxId) {
    var id = sanitizeRbxId(rbxId);
    var url = location.href.split("#")[0];
    var amountText = Number(amount).toLocaleString("en-US");
    var priceText = Number(price).toLocaleString("en-US");
    var custom = customTemplate("robux");
    if (custom) {
      return waLink(fillTemplate(custom, {
        brand: brandName(),
        name: bg(product.name),
        amount: amountText,
        price: priceText,
        robloxId: id,
        robloxIdLine: id ? " Roblox ID: " + id + "." : "",
        url: url
      }));
    }
    return waLink(t("wa.orderRobux", {
      name: bg(product.name),
      amount: amountText,
      price: priceText,
      idLine: id ? t("wa.idLine", { id: id }) : "",
      url: url
    }));
  }

  function supportWaLink() { return waLink(t("wa.support")); }

  /* ---------- Language ---------- */
  function applyI18n(root) {
    $$("[data-i18n]", root).forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    $$("[data-i18n-ph]", root).forEach(function (el) { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
    $$("[data-i18n-aria]", root).forEach(function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
  }

  function setLang(next) {
    lang = next === "bn" ? "bn" : "en";
    try { localStorage.setItem("bb_lang", lang); } catch (e) { /* ignore */ }
    document.documentElement.setAttribute("lang", lang);
    applyI18n(document);
    $$(".lang-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
    document.dispatchEvent(new CustomEvent("bb:langchange"));
  }

  function getLang() { return lang; }

  /* ---------- Header / footer chrome ---------- */
  function navItem(href, key, page) {
    var active = currentPage() === href ? " is-active" : "";
    return '<a class="nav-link' + active + '" href="' + href + '" data-nav="' + page + '" data-i18n="' + key + '">' + t(key) + "</a>";
  }

  function renderHeader() {
    var host = $("#site-header");
    if (!host) return;
    var page = currentPage();
    var guideKeys = Object.keys(window.BB_GUIDES || {});
    var guideLinks = guideKeys.map(function (id) {
      var g = BB_GUIDES[id];
      var active = page === "guide-" + id + ".html" ? ' class="dd-link is-active"' : ' class="dd-link"';
      return "<a" + active + ' href="guide-' + id + '.html">' + esc(bg(g.name)) + "</a>";
    }).join("");

    var guidesActive = page.indexOf("guide-") === 0 ? " is-active" : "";

    host.innerHTML =
      '<a class="skip-link" href="#main" data-i18n="skip">' + t("skip") + "</a>" +
      '<header class="site-header">' +
        '<div class="container header-inner">' +
          '<a class="wordmark" href="index.html"><picture>' +
            '<source media="(max-width: 480px)" srcset="assets/img/website%20logo/mark_only.svg">' +
            '<img src="assets/img/website%20logo/logo_primary.svg" alt="BloxBazaar BD — Home">' +
          "</picture></a>" +
          '<nav class="main-nav" aria-label="Main navigation">' +
            navItem("catalogue.html", "nav.catalogue", "catalogue") +
            '<div class="nav-dropdown">' +
              '<button type="button" class="dd-btn' + guidesActive + '" aria-expanded="false" aria-haspopup="true">' +
                '<span data-i18n="nav.guides">' + t("nav.guides") + "</span>" + I.chevron +
              "</button>" +
              '<div class="dd-menu" hidden>' + guideLinks +
                '<div class="dd-sep"></div><a class="dd-link" href="how-it-works.html#faq"><span data-i18n="nav.faq">' + t("nav.faq") + "</span></a>" +
              "</div>" +
            "</div>" +
            navItem("how-it-works.html", "nav.faq", "faq") +
            navItem("contact.html", "nav.support", "support") +
          "</nav>" +
          '<div class="header-actions">' +
            '<div class="lang-toggle" role="group" aria-label="Language / ভাষা">' +
              '<button type="button" class="lang-btn" data-lang="en" aria-pressed="false">EN</button>' +
              '<button type="button" class="lang-btn" data-lang="bn" aria-pressed="false">বাংলা</button>' +
            "</div>" +
            '<button type="button" class="nav-toggle" aria-expanded="false" aria-controls="mobile-nav" data-i18n-aria="nav.menu">' +
              '<span class="nav-toggle-icon">' + I.menu + "</span>" +
            "</button>" +
          "</div>" +
        "</div>" +
        '<div class="mobile-nav" id="mobile-nav" hidden>' +
          '<nav class="container" aria-label="Mobile navigation">' +
            '<a class="mnav-link" href="catalogue.html" data-i18n="nav.catalogue">' + t("nav.catalogue") + "</a>" +
            '<div class="mnav-label" data-i18n="nav.guides">' + t("nav.guides") + "</div>" +
            guideKeys.map(function (id) {
              var g = BB_GUIDES[id];
              return '<a class="mnav-link mnav-sub" href="guide-' + id + '.html">' + esc(bg(g.name)) + "</a>";
            }).join("") +
            '<a class="mnav-link" href="how-it-works.html" data-i18n="nav.faq">' + t("nav.faq") + "</a>" +
            '<a class="mnav-link" href="contact.html" data-i18n="nav.support">' + t("nav.support") + "</a>" +
          "</nav>" +
        "</div>" +
      "</header>";

    /* Language buttons */
    $$(".lang-btn", host).forEach(function (b) {
      b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); });
    });

    /* Guides dropdown */
    var dd = $(".nav-dropdown", host);
    if (dd) {
      var btn = $(".dd-btn", dd), menu = $(".dd-menu", dd);
      btn.addEventListener("click", function () {
        var open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        btn.classList.toggle("is-open", open);
      });
      document.addEventListener("click", function (e) {
        if (!dd.contains(e.target) && !menu.hidden) {
          menu.hidden = true;
          btn.setAttribute("aria-expanded", "false");
          btn.classList.remove("is-open");
        }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !menu.hidden) {
          menu.hidden = true;
          btn.setAttribute("aria-expanded", "false");
          btn.classList.remove("is-open");
          btn.focus();
        }
      });
    }

    /* Mobile nav */
    var toggle = $(".nav-toggle", host), mnav = $("#mobile-nav", host);
    if (toggle && mnav) {
      toggle.addEventListener("click", function () {
        var open = mnav.hidden;
        mnav.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.classList.toggle("is-open", open);
        $(".nav-toggle-icon", toggle).innerHTML = open ? I.close : I.menu;
      });
    }
  }

  function renderFooter() {
    var host = $("#site-footer");
    if (!host) return;
    var guideKeys = Object.keys(window.BB_GUIDES || {});
    host.innerHTML =
      '<footer class="site-footer">' +
        '<div class="container">' +
          '<div class="f-cols">' +
            '<div class="f-brand">' +
              '<img class="f-logo" src="assets/img/website%20logo/logo_primary.svg" alt="BloxBazaar BD" loading="lazy" decoding="async">' +
              '<p class="f-text" data-i18n="f.about">' + t("f.about") + "</p>" +
              '<p class="f-text f-unofficial" data-i18n="f.unofficial">' + t("f.unofficial") + "</p>" +
            "</div>" +
            '<div class="f-col">' +
              '<h4 data-i18n="f.shop">' + t("f.shop") + "</h4>" +
              '<ul class="f-links">' +
                '<li><a href="catalogue.html" data-i18n="f.cat">' + t("f.cat") + "</a></li>" +
                '<li><a href="how-it-works.html" data-i18n="f.how">' + t("f.how") + "</a></li>" +
                '<li><a href="contact.html" data-i18n="f.contact">' + t("f.contact") + "</a></li>" +
              "</ul>" +
            "</div>" +
            '<div class="f-col">' +
              '<h4 data-i18n="f.guides">' + t("f.guides") + "</h4>" +
              '<ul class="f-links">' +
                guideKeys.map(function (id) {
                  return '<li><a href="guide-' + id + '.html">' + esc(bg(BB_GUIDES[id].name)) + "</a></li>";
                }).join("") +
              "</ul>" +
            "</div>" +
            '<div class="f-col">' +
              '<h4 data-i18n="f.policies">' + t("f.policies") + "</h4>" +
              '<ul class="f-links">' +
                '<li><a href="contact.html#privacy" data-i18n="f.privacy">' + t("f.privacy") + "</a></li>" +
                '<li><a href="contact.html#terms" data-i18n="f.terms">' + t("f.terms") + "</a></li>" +
                '<li><a href="contact.html#unofficial" data-i18n="f.contact">' + t("f.contact") + "</a></li>" +
              "</ul>" +
            "</div>" +
          "</div>" +
          '<div class="f-bottom">' +
            '<span data-i18n="f.rights">' + t("f.rights") + "</span>" +
            '<span data-i18n="f.placeholder">' + t("f.placeholder") + "</span>" +
          "</div>" +
        "</div>" +
      "</footer>";
  }

  /* ---------- Toast ---------- */
  function toast(message) {
    var wrap = $(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      wrap.setAttribute("role", "status");
      wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(wrap);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = '<span class="toast-icon">' + I.checkCircle + "</span><span>" + esc(message) + "</span>";
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-leaving");
      setTimeout(function () { el.remove(); }, 250);
    }, 3400);
  }

  /* ---------- Admin session (design-stage gate) ----------
     Client-side only: it keeps the admin tools out of casual view,
     but it is NOT real security — anyone with developer tools can
     bypass it. Enforce auth on the server before going live (§11).
     Sessions live in sessionStorage ("keep me signed in" uses
     localStorage). Five wrong passwords → 60-second lockout. */
  var SESSION_KEY = "bb_admin_session";
  var ATTEMPT_KEY = "bb_admin_try";

  function sha256Hex(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return null;
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var hex = "";
      for (var i = 0; i < bytes.length; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
      return hex;
    });
  }

  function readAdminSession() {
    var raw = null;
    try { raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); }
    catch (e) { return null; }
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (s && s.exp && s.exp > Date.now()) return s;
    } catch (e) { /* corrupt session — treat as signed out */ }
    return null;
  }

  function adminSessionActive() { return !!readAdminSession(); }

  function adminSignOut() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function failedAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || "null") || { n: 0, until: 0 }; }
    catch (e) { return { n: 0, until: 0 }; }
  }

  function adminLockRemaining() {
    var s = failedAttempts();
    return s.until > Date.now() ? s.until - Date.now() : 0;
  }

  function noteFailedAttempt() {
    var s = failedAttempts();
    if (!(s.until > Date.now())) s.until = 0;
    s.n = (s.n || 0) + 1;
    if (s.n >= 5) { s.until = Date.now() + 60000; s.n = 0; }
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function clearAttempts() {
    try { localStorage.removeItem(ATTEMPT_KEY); } catch (e) { /* ignore */ }
  }

  function adminSignIn(password, remember) {
    var cfg = (window.BB_DATA && BB_DATA.admin) || {};
    var target = String(cfg.passwordHash || "").toLowerCase();
    var lock = adminLockRemaining();
    if (lock > 0) return Promise.reject(new Error("locked:" + lock));
    if (!target) return Promise.reject(new Error("not-configured"));
    if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error("insecure-context"));
    return sha256Hex(password).then(function (hex) {
      if (hex !== target) {
        noteFailedAttempt();
        var rest = adminLockRemaining();
        throw new Error(rest > 0 ? "locked:" + rest : "bad-password");
      }
      var hours = Number(cfg.sessionHours) > 0 ? Number(cfg.sessionHours) : 12;
      var session = { exp: Date.now() + hours * 3600 * 1000, at: new Date().toISOString() };
      adminSignOut();
      try {
        (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
      } catch (e) { /* ignore */ }
      clearAttempts();
      return session;
    });
  }

  /* ---------- State-preview banner (design review aid) ---------- */
  function mountStateNote() {
    var st = param("state");
    var drawer = param("drawer");
    var label = null;
    if (drawer === "add") label = "Add product drawer";
    else if (drawer === "edit") label = "Edit product drawer";
    else if (st) label = st.charAt(0).toUpperCase() + st.slice(1);
    if (!label) return;
    var main = $("#main") || document.body;
    var div = document.createElement("div");
    div.className = "state-preview";
    div.innerHTML = I.info + "<span>" + esc(t("state.note", { name: label })) + "</span>";
    main.insertBefore(div, main.firstChild);
  }

  /* ---------- Chrome init ---------- */
  function initChrome() {
    renderHeader();
    renderFooter();
    setLang(lang); /* applies lang, aria-pressed, and translations */
    mountStateNote();
  }

  /* ---------- Boot ----------
     Load the data layer first (live API when the backend serves the
     page, static bundle otherwise), then build the chrome. Page
     scripts render on the "bb:ready" event instead of DOMContentLoaded
     so they always see the final catalogue. */
  function boot() {
    var loading = (window.BB_API && window.BB_API.load)
      ? window.BB_API.load()
      : Promise.resolve({ source: "static" });

    loading.then(function (result) {
      if (result && result.source === "api") window.BB_DATA_SOURCE = "api";
    }).catch(function () {
      /* BB_API.load() never rejects — it falls back to static. */
    }).then(function () {
      initChrome();
      document.dispatchEvent(new CustomEvent("bb:ready"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return {
    $: $, $$: $$, param: param, t: t, bg: bg, esc: esc,
    fmtBDT: fmtBDT, fmtDate: fmtDate, toBnDigits: toBnDigits, catLabel: catLabel,
    icon: I, applyI18n: applyI18n, setLang: setLang, getLang: getLang,
    waLink: waLink, productWaLink: productWaLink, supportWaLink: supportWaLink,
    robuxPrice: robuxPrice, robuxWaLink: robuxWaLink,
    adminSessionActive: adminSessionActive, adminSignIn: adminSignIn,
    adminSignOut: adminSignOut, adminLockRemaining: adminLockRemaining,
    toast: toast, currentPage: currentPage, initChrome: initChrome
  };
})();
