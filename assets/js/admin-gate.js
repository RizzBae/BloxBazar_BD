/* =========================================================
   BloxBazaar BD — admin-gate.js
   The pre-render gate for admin.html (kept in the <head> so the
   dashboard never flashes).

   Served by the backend (http/https): the server already gates
   /admin.html with a session check and redirects to sign-in.
   admin.js then confirms the session over the API and only adds
   the "bb-admin-auth" class (which reveals the page) once it is
   confirmed — so nothing is trusted client-side.

   Opened from file:// (design preview): there is no server, so
   the original browser-only session check applies.
   ========================================================= */

(function () {
  "use strict";

  if (/^https?:$/.test(location.protocol)) {
    /* Backend or static hosting — admin.js handles the session
       check and page reveal; see admin.js (both modes). */
    return;
  }

  try {
    var raw = sessionStorage.getItem("bb_admin_session") || localStorage.getItem("bb_admin_session");
    var s = raw ? JSON.parse(raw) : null;
    if (s && s.exp && s.exp > Date.now()) {
      document.documentElement.className += " bb-admin-auth";
      return;
    }
  } catch (e) { /* ignore */ }

  var next = location.pathname.split("/").pop() + location.search;
  location.replace("admin-login.html?next=" + encodeURIComponent(next));
})();
