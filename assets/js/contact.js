/* =========================================================
   BloxBazaar BD — contact.js
   Wires the WhatsApp support link and fills the contact cards
   with the shop settings from the backend. Rows stay hidden
   until the owner has configured a value.
   ========================================================= */

(function () {
  "use strict";

  function fill() {
    var D = window.BB_DATA || {};

    var number = String(D.whatsappNumber || "").replace(/[^\d]/g, "");
    var wa = document.getElementById("contact-wa");
    if (wa) {
      if (number) {
        wa.textContent = "+" + number;
        wa.hidden = false;
      } else {
        wa.hidden = true;
      }
    }

    var email = String(D.supportEmail || "").trim();
    var emailRow = document.getElementById("contact-email-row");
    var emailLink = document.getElementById("contact-email");
    if (emailRow && emailLink) {
      if (email) {
        emailLink.textContent = email;
        emailLink.setAttribute("href", "mailto:" + email);
        emailRow.hidden = false;
      } else {
        emailRow.hidden = true;
      }
    }

    var hoursMap = D.supportHours || {};
    var lang = (window.BB && BB.getLang && BB.getLang()) || "en";
    var hours = String(hoursMap[lang] || hoursMap.en || "").trim();
    var hoursRow = document.getElementById("contact-hours-row");
    var hoursText = document.getElementById("contact-hours");
    var hoursDesc = document.getElementById("contact-hours-desc");
    if (hoursRow && hoursText) {
      if (hours) {
        hoursText.textContent = hours;
        hoursRow.hidden = false;
        if (hoursDesc) hoursDesc.hidden = false;
      } else {
        hoursRow.hidden = true;
        if (hoursDesc) hoursDesc.hidden = true;
      }
    }
  }

  function wire() {
    var link = document.getElementById("wa-support");
    if (link) link.setAttribute("href", window.BB.supportWaLink());
    fill();
  }

  document.addEventListener("bb:langchange", wire);
  document.addEventListener("bb:ready", wire);
})();
