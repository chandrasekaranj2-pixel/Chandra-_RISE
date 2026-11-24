// 24 Nov 2026 CS batch — session-security Phase 3. The single source of
// truth for every "should be a setting, not hard-coded" number from the
// earlier audit: OTP validity, wrong-code attempt cap, resend
// cooldown/hourly cap, lockout minutes, idle timeout, session lifetime, and
// the concurrent-device cap. Backed by the single-row app_settings table
// (db.js). requireAuth in middleware/auth.js calls getSettings() on every
// authenticated request, so this caches the row in memory for a few
// seconds rather than hitting Postgres that often — a saved change takes
// at most CACHE_MS to take effect everywhere, never longer.
const { pool } = require("../db.js");

const CACHE_MS = 5000;
let cached = null;
let cachedAt = 0;

const DEFAULTS = {
  otp_validity_minutes: 10,
  max_code_attempts: 5,
  resend_cooldown_seconds: 60,
  resend_hourly_cap: 5,
  lockout_minutes: 15,
  idle_timeout_hours: 8,
  session_lifetime_days: 7,
  concurrent_session_limit: 3,
};

async function getSettings() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    const { rows } = await pool.query("SELECT * FROM app_settings WHERE id = 1");
    cached = rows[0] ? { ...DEFAULTS, ...rows[0] } : { ...DEFAULTS };
  } catch (e) {
    // Table not there yet, or a transient DB hiccup — fall back to the
    // same numbers Phase 1/2 had hard-coded rather than breaking auth.
    cached = { ...DEFAULTS };
  }
  cachedAt = Date.now();
  return cached;
}

// Bounds are generous but not infinite — this is an admin-only screen, but
// a typo (e.g. "0" minutes idle timeout) shouldn't be able to lock every
// user out or disable the whole limit silently.
const FIELD_BOUNDS = {
  otp_validity_minutes: [1, 60],
  max_code_attempts: [3, 20],
  resend_cooldown_seconds: [10, 600],
  resend_hourly_cap: [1, 50],
  lockout_minutes: [1, 1440],
  idle_timeout_hours: [1, 168],
  session_lifetime_days: [1, 90],
  concurrent_session_limit: [1, 20],
};

function validateSettingsInput(body) {
  const errors = [];
  const clean = {};
  for (const key of Object.keys(FIELD_BOUNDS)) {
    if (body[key] === undefined || body[key] === null || body[key] === "") continue;
    const n = Number(body[key]);
    const [min, max] = FIELD_BOUNDS[key];
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${key.replace(/_/g, " ")} must be a whole number between ${min} and ${max}.`);
      continue;
    }
    clean[key] = n;
  }
  return { clean, errors };
}

async function updateSettings(body, updatedBy) {
  const { clean, errors } = validateSettingsInput(body);
  if (errors.length) return { errors };
  if (!Object.keys(clean).length) return { errors: ["No valid settings were provided."] };

  const setClauses = Object.keys(clean).map((key, i) => `${key} = $${i + 2}`);
  const values = Object.keys(clean).map((key) => clean[key]);
  const { rows } = await pool.query(
    `UPDATE app_settings SET ${setClauses.join(", ")}, updated_at = now(), updated_by = $1 WHERE id = 1 RETURNING *`,
    [updatedBy || null, ...values]
  );
  cached = null; // force the next getSettings() to re-read rather than wait out CACHE_MS
  return { settings: rows[0] };
}

module.exports = { getSettings, updateSettings, DEFAULTS, FIELD_BOUNDS };
