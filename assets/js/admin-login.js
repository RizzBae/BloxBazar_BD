/* =========================================================
   BloxBazaar BD — admin-login.js
   Admin sign-in.

   The form posts email + password to /api/v1/admin/session. The
   server verifies the scrypt hash, applies the sign-in lockout,
   and sets the HttpOnly session cookie; there is no password
   check in the browser. Without the backend the page shows a
   notice instead of a form.
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB;
  var API = window.BB_API;

  function backendAvailable() { return !!(API && API.mode && API.mode() === "api"); }

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
  var options = document.querySelector(".login-options");
  var privateNote = document.querySelector(".login-note");
  var backendNote = document.getElementById("backend-note");

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

  function showBackendRequired() {
    form.hidden = true;
    if (options) options.hidden = true;
    if (privateNote) privateNote.hidden = true;
    if (backendNote) backendNote.hidden = false;
    hideError();
  }

  /* Lockout countdown from the server's Retry-After. */
  function applyLock() {
    var remain = serverLockUntil > Date.now() ? serverLockUntil - Date.now() : 0;

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

    if (!backendAvailable()) { showBackendRequired(); return; }

    var emailOk = /.+@.+\..+/.test(emailInput.value.trim());
    var pwOk = pwInput.value.length > 0;

    emailField.classList.toggle("has-error", !emailOk);
    pwField.classList.toggle("has-error", !pwOk);

    if (!emailOk) { emailInput.focus(); return; }
    if (!pwOk) { pwInput.focus(); return; }

    submitBtn.disabled = true;
    var remember = !!(rememberInput && rememberInput.checked);

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
      if (err && err.status === 401) { showError(T.t("admin.invalidCredentials")); return; }
      showError(T.t("admin.signInNetwork"));
    });
  });

  /* Already signed in? Skip the form once the data layer knows the mode. */
  document.addEventListener("bb:ready", function () {
    if (!backendAvailable()) { showBackendRequired(); return; }
    API.admin.session().then(function () {
      location.replace(nextTarget());
    }).catch(function () { /* not signed in — show the form */ });
  });
})();
