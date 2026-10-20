/* =========================================================
   BloxBazaar BD — server/lib/problem.js
   RFC 9457 problem+json responses (PRD §8, source S8).
   Stack traces and database details never reach the client.
   ========================================================= */

"use strict";

function sendProblem(res, status, title, detail, errors) {
  const body = { type: "about:blank", title, status };
  if (detail) body.detail = detail;
  if (errors && errors.length) body.errors = errors;
  res.status(status).type("application/problem+json").json(body);
}

/* Field-level error helper: { field, message } (PRD §8.2). */
function fieldError(field, message) {
  return { field, message };
}

/* Error carrying a problem+json status for the central handler. */
function httpError(status, title, detail, errors) {
  const err = new Error(detail || title);
  err.status = status;
  err.problemTitle = title;
  if (errors && errors.length) err.fieldErrors = errors;
  return err;
}

module.exports = { sendProblem, fieldError, httpError };
