/* =========================================================
   BloxBazaar BD — contact.js
   Wires the WhatsApp support link (localized message).
   ========================================================= */

(function () {
  "use strict";

  function wire() {
    var link = document.getElementById("wa-support");
    if (link) link.setAttribute("href", window.BB.supportWaLink());
  }

  document.addEventListener("bb:langchange", wire);
  document.addEventListener("bb:ready", wire);
})();
