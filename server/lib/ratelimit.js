/* =========================================================
   BloxBazaar BD — server/lib/ratelimit.js
   In-memory sliding-window rate limiting (PRD §8).

   Deliberately process-local: the PRD keeps v1 to one deployable
   instance and no Redis. If the app is ever scaled horizontally,
   move these counters to the platform's shared store.
   ========================================================= */

"use strict";

const { sendProblem } = require("./problem");

function createLimiter({ windowMs, max, keyFn, title, detail }) {
  const hits = new Map();

  /* Periodic pruning keeps memory bounded in long-running processes. */
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, arr] of hits) {
      const keep = arr.filter((t) => now - t < windowMs);
      if (keep.length) hits.set(key, keep);
      else hits.delete(key);
    }
  }, Math.min(windowMs, 60000));
  if (timer.unref) timer.unref();

  return function rateLimit(req, res, next) {
    if (!max) return next(); /* 0 disables the limiter (local dev) */
    const key = keyFn(req);
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return sendProblem(
        res,
        429,
        title || "Too many requests",
        detail || `Rate limit reached. Try again in ${retryAfter} seconds.`
      );
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

/* Sign-in lockout with escalating lock duration (PRD §7, §10). */
function createLockout({ maxFails, windowMs, baseLockMs, maxLockMs }) {
  const state = new Map(); /* key → { fails: number[], lockedUntil: number, level: number } */
  const cap = maxLockMs || baseLockMs * 8;

  function entry(key) {
    let e = state.get(key);
    if (!e) {
      e = { fails: [], lockedUntil: 0, level: 0 };
      state.set(key, e);
    }
    return e;
  }

  return {
    /* 0 = allowed; otherwise seconds to wait. */
    check(key) {
      const e = state.get(key);
      if (!e) return 0;
      const now = Date.now();
      if (e.lockedUntil > now) return Math.ceil((e.lockedUntil - now) / 1000);
      return 0;
    },
    /* Records a failure; returns seconds of lock if one just started. */
    fail(key) {
      const e = entry(key);
      const now = Date.now();
      e.fails = e.fails.filter((t) => now - t < windowMs);
      e.fails.push(now);
      if (e.fails.length >= maxFails) {
        const lockMs = Math.min(baseLockMs * Math.pow(2, e.level), cap);
        e.lockedUntil = now + lockMs;
        e.level += 1;
        e.fails = [];
        return Math.ceil(lockMs / 1000);
      }
      return 0;
    },
    success(key) {
      state.delete(key);
    },
  };
}

module.exports = { createLimiter, createLockout };
