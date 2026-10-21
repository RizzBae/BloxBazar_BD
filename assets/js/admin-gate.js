/* =========================================================
   BloxBazaar BD — admin-gate.js
   Runs in the <head> of admin.html so the dashboard never flashes
   before the server session check completes.

   Served by the backend, admin.js confirms the session over the
   API and only then reveals the page. Opened from anywhere else
   there is no server, so the page goes straight to the sign-in
   screen — there is no client-side password check.
   ========================================================= */

(function () {
  "use strict";

  if (/^https?:$/.test(location.protocol)) return;

  location.replace("admin-login.html");
})();
