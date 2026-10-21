/* =========================================================
   BloxBazaar BD — admin-forgot.js
   Self-service password reset with a recovery code.

   The admin enters their email, the 12-character recovery code
   saved from Settings, and a new password. The server verifies
   the code, revokes every session, and returns a fresh recovery
   code — shown once on this page.

   Lost the code? The CLI (npm run admin:reset) is the server-side
   fallback; the form only works when the backend is reachable.
   ========================================================= */

(function () {
  "use strict";

  var T = window.BB;
  var API = window.BB_API;

  var form = document.getElementById("recover-form");
  var emailField = document.getElementById("f-recover-email");
  var codeField = document.getElementById("f-recover-code");
  var pwField = document.getElementById("f-recover-password");
  var confirmField = document.getElementById("f-recover-confirm");
  var emailInput = document.getElementById("recover-email");
  var codeInput = document.getElementById("recover-code");
  var pwInput = document.getElementById("recover-password");
  var confirmInput = document.getElementById("recover-confirm");
  var pwToggle = document.getElementById("recover-pw-toggle");
  var submitBtn = document.getElementById("recover-submit");
  var errorBanner = document.getElementById("forgot-error");
  var errorText = errorBanner.querySelector("span");
  var successPanel = document.getElementById("recover-success");
  var successCode = document.getElementById("recover-new-code");
  var copyBtn = document.getElementById("copy-recover-code");
  var cliNote = document.getElementById("cli-note");
  var backendNote = document.getElementById("backend-note");
  var headSub = document.querySelector(".login-sub");
  var footBack = document.querySelector(".login-back");

  function apiMode() { return !!(API && API.mode && API.mode() === "api"); }

  function showError(message) {
    errorText.textContent = message;
    errorBanner.classList.add("is-visible");
  }
  function hideError() { errorBanner.classList.remove("is-visible"); }

  function clearErrors() {
    [emailField, codeField, pwField, confirmField].forEach(function (field) {
      field.classList.remove("has-error");
    });
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /* Password visibility */
  pwToggle.addEventListener("click", function () {
    var show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    pwToggle.innerHTML = show ? T.icon.eyeOff : T.icon.eye;
    pwToggle.setAttribute("aria-pressed", String(show));
    pwToggle.setAttribute("aria-label", T.t(show ? "admin.hidePassword" : "admin.showPassword"));
  });

  [emailInput, codeInput, pwInput, confirmInput].forEach(function (input) {
    input.addEventListener("input", function () {
      input.closest(".field").classList.remove("has-error");
    });
  });

  function copyCode() {
    var text = successCode.textContent;
    var done = function () {
      copyBtn.textContent = T.t("admin.codeCopied");
      setTimeout(function () { copyBtn.textContent = T.t("admin.copyCode"); }, 2000);
    };
    var fallback = function () {
      try {
        var range = document.createRange();
        range.selectNodeContents(successCode);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("copy");
        done();
      } catch (e) { /* selection is still available for manual copy */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }
  copyBtn.addEventListener("click", copyCode);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitBtn.disabled) return;
    hideError();
    clearErrors();

    var email = emailInput.value.trim();
    var code = normalizeCode(codeInput.value);
    var password = pwInput.value;
    var confirm = confirmInput.value;

    var emailOk = /.+@.+\..+/.test(email);
    var codeOk = code.length === 12;
    var pwOk = password.length >= 10;
    var confirmOk = password === confirm && confirm.length > 0;

    emailField.classList.toggle("has-error", !emailOk);
    codeField.classList.toggle("has-error", !codeOk);
    pwField.classList.toggle("has-error", !pwOk);
    confirmField.classList.toggle("has-error", !confirmOk);

    if (!emailOk) { emailInput.focus(); return; }
    if (!codeOk) { codeInput.focus(); codeInput.select(); return; }
    if (!pwOk) { pwInput.focus(); return; }
    if (!confirmOk) { confirmInput.focus(); return; }

    submitBtn.disabled = true;
    API.admin.recoverPassword({
      email: email,
      recoveryCode: code,
      password: password,
    }).then(function (res) {
      submitBtn.disabled = false;
      form.hidden = true;
      cliNote.hidden = true;
      backendNote.hidden = true;
      if (headSub) headSub.hidden = true;
      if (footBack) footBack.hidden = true;
      if (res && res.recoveryCode) {
        successCode.textContent = res.recoveryCode;
      }
      successPanel.hidden = false;
      copyBtn.focus();
    }).catch(function (err) {
      submitBtn.disabled = false;
      pwInput.value = "";
      confirmInput.value = "";
      if (err && err.problem && err.problem.detail) {
        showError(err.problem.detail);
      } else {
        showError(T.t("admin.recoverFailed"));
      }
      if (err && err.status === 401) {
        codeInput.focus();
        codeInput.select();
      } else {
        pwInput.focus();
      }
    });
  });

  document.addEventListener("bb:ready", function () {
    if (!apiMode()) {
      backendNote.hidden = false;
      cliNote.hidden = false;
      form.hidden = true;
      return;
    }
    /* The recovery form is the whole point of this page; the CLI note
       stays as a fallback if the code has been lost. */
    cliNote.hidden = false;
  });
})();
