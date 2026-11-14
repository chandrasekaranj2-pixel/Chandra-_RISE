// Small server-side validators shared by the admin create routes. The
// frontend enforces the same rules for fast feedback, but the server is the
// source of truth (a form can be bypassed).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmail = (v) => EMAIL_RE.test(String(v || "").trim());

// http(s) URL with a host that has a dot ("https://www.reliancetrends.com").
function isUrl(v) {
  try {
    const u = new URL(String(v || "").trim());
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

// requireFields([[value, "Label"], ...]) -> error string or null.
function missingFields(pairs) {
  const missing = pairs.filter(([v]) => blank(v)).map(([, label]) => label);
  return missing.length ? `Please fill in: ${missing.join(", ")}.` : null;
}

module.exports = { isEmail, isUrl, blank, missingFields };
