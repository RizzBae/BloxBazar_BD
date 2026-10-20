/* =========================================================
   BloxBazaar BD — admin-login.js
   Owner sign-in.

   Backend mode: posts email + password to /api/v1/admin/session;
   the server checks the scrypt hash, applies the sign-in lockout
   (5 wrong tries → escalating lockout), and sets the HttpOnly
   session cookie. The client shows the server's rate-limit state.

   Static mode (file:// design preview): the original SHA-256
   gate from config.js with a browser-only session — a static
   site cannot enforce real security.

   Preview: admin-login.html?state=error shows the error state.
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB;
  var API = window.BB_API;

  function apiMode() { return !!(API && API.mode && API.mode() === "api"); }

  var form = document.getElementById("login-form");
  var emailField = document.getElementById("f-email");
  var pwField = document.getElementById("f-password");
  var emailInput = document.getElementById("login-email");
  var pwInput = document.getElementById("login-password");
  var errorBanner = document.getElementById("login-error");
  var errorText = errorBanner.querySelector("span");
  var pwToggle = document.getElementById("pw-toggle");
  var rememberInput = document.getElementById("login-remember");
  var submitBtn = form.querySelector('button[type="submit"]');

  var demoError = T.param("state") === "error";
  if (demoError) errorBanner.classList.add("is-visible");

  var lockTimer = null;
  var serverLockUntil = 0;

  function showError(message) {
    errorText.textContent = message;
    errorBanner.classList.add("is-visible");
  }
  function hideError() { errorBanner.classList.remove("is-visible"); }

  function nextTarget() {
    var next = (T.param("next") || "").replace(/^\/+/, "");
    return next.indexOf("admin.html") === 0 ? next : "admin.html";
  }

  /* Lockout countdown: server-issued (Retry-After) in backend mode,
     the browser-only counter in the static demo. */
  function applyLock() {
    var remain = 0;
    if (serverLockUntil > Date.now()) remain = serverLockUntil - Date.now();
    else if (!apiMode()) remain = T.adminLockRemaining();

    if (remain <= 0) {
      if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
      submitBtn.disabled = false;
      submitBtn.textContent = T.t("admin.signIn");
      return false;
    }
    var secs = Math.ceil(remain / 1000);
    submitBtn.disabled = true;
    submitBtn.textContent = T.t("admin.lockedBtn", { s: secs });
    showError(T.t("admin.locked", { s: secs }));
    if (!lockTimer) {
      lockTimer = setInterval(function () { applyLock(); }, 1000);
    }
    return true;
  }
  applyLock();

  /* Password visibility */
  pwToggle.addEventListener("click", function () {
    var show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    pwToggle.innerHTML = show ? T.icon.eyeOff : T.icon.eye;
    pwToggle.setAttribute("aria-pressed", String(show));
    pwToggle.setAttribute("aria-label", T.t(show ? "admin.hidePassword" : "admin.showPassword"));
  });

  /* Live validation feedback */
  emailInput.addEventListener("input", function () { emailField.classList.remove("has-error"); });
  pwInput.addEventListener("input", function () { pwField.classList.remove("has-error"); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitBtn.disabled) return;
    hideError();

    var emailOk = /.+@.+\..+/.test(emailInput.value.trim());
    var pwOk = pwInput.value.length > 0;

    emailField.classList.toggle("has-error", !emailOk);
    pwField.classList.toggle("has-error", !pwOk);

    if (!emailOk) { emailInput.focus(); return; }
    if (!pwOk) { pwInput.focus(); return; }

    /* Designed error state — stays on the page for review */
    if (demoError) { showError(T.t("admin.demoError")); return; }

    submitBtn.disabled = true;
    var remember = !!(rememberInput && rememberInput.checked);

    /* ---------- Backend mode: real server auth ---------- */
    if (apiMode()) {
      API.admin.signIn(emailInput.value.trim(), pwInput.value, remember).then(function () {
        location.href = nextTarget();
      }).catch(function (err) {
        submitBtn.disabled = false;
        pwInput.select();
        if (err && err.status === 429) {
          var secs = Number(err.retryAfter || 0);
          serverLockUntil = Date.now() + (secs > 0 ? secs * 1000 : 15 * 60 * 1000);
          applyLock();
          return;
        }
        if (err && err.status === 401) { showError(T.t("admin.demoError")); return; }
        showError(T.t("admin.signInNetwork"));
      });
      return;
    }

    /* ---------- Static demo: browser-only gate ---------- */
    T.adminSignIn(pwInput.value, remember).then(function () {
      location.href = nextTarget();
    }).catch(function (err) {
      submitBtn.disabled = false;
      pwInput.select();
      var msg = String((err && err.message) || "");
      if (msg.indexOf("locked:") === 0) { applyLock(); return; }
      if (msg === "insecure-context") { showError(T.t("admin.insecure")); return; }
      if (msg === "not-configured") { showError(T.t("admin.notConfigured")); return; }
      showError(T.t("admin.demoError"));
    });
  });

  /* Already signed in? Skip the form once the data layer knows the mode. */
  document.addEventListener("bb:ready", function () {
    if (apiMode()) {
      API.admin.session().then(function () {
        location.replace(nextTarget());
      }).catch(function () { /* not signed in — show the form */ });
      return;
    }
    if (T.adminSessionActive()) { location.replace(nextTarget()); return; }
    applyLock();
  });
})();
