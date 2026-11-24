const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool } = require("../db.js");
const { getSettings } = require("../lib/settings.js");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret";

// 24 Nov 2026 CS batch — session-security Phase 2 made login create a real
// row in `sessions` instead of just a stateless signed JWT, which is what
// makes idle timeout, a concurrent-device cap, and a real "force sign-out"
// button possible at all. Phase 3 moved the three numbers below (session
// lifetime, idle timeout, concurrent-device cap) out of this file and into
// the admin-editable app_settings table (backend/lib/settings.js) — nothing
// here is hard-coded any more; getSettings() is read fresh (with a short
// cache) wherever one of these numbers is needed.

function signToken(user, jti, sessionLifetimeDays) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company, jti },
    JWT_SECRET,
    { expiresIn: `${sessionLifetimeDays}d` }
  );
}

// requireAuth is now async: a valid-looking JWT is no longer enough on its
// own — its `jti` has to match a live, non-revoked, non-expired row in
// `sessions`, and that row has to have been seen inside the idle window.
// That's what lets an admin's "force sign-out" (or marking someone
// Inactive) actually kill an already-issued token rather than just hoping
// it expires on its own in a week.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Session expired — please log in again." });
  }

  // A token signed before this change carries no jti at all — treat it the
  // same as an expired session so it's forced through a clean re-login,
  // which creates a real sessions row.
  if (!payload.jti) {
    return res.status(401).json({ error: "Session expired — please log in again." });
  }

  try {
    const { rows } = await pool.query("SELECT * FROM sessions WHERE jti = $1", [payload.jti]);
    const session = rows[0];
    if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: "Session expired or signed out — please log in again." });
    }

    const settings = await getSettings();
    const idleMs = Date.now() - new Date(session.last_seen_at).getTime();
    if (idleMs > settings.idle_timeout_hours * 60 * 60 * 1000) {
      await pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [session.id]);
      return res.status(401).json({ error: "You were signed out after a period of inactivity — please log in again." });
    }

    // Fire-and-forget — a slow/failed heartbeat update shouldn't block the
    // request it's riding along with.
    pool.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [session.id]).catch(() => {});

    req.user = payload;
    req.sessionId = session.id;
    next();
  } catch (e) {
    next(e);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access only." });
  next();
}

// requireRole("partner") — only the roles listed are let through; pass
// "admin" explicitly too if admins should also have access to a route.
function requireRole(...roles) {
  return function (req, res, next) {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: `Requires one of: ${roles.join(", ")}.` });
    }
    next();
  };
}

// createSession(user) replaces every old `signToken(user)` call site in
// routes/auth.js. It (1) enforces the concurrent-device cap by auto-signing
// the oldest session out the moment a login beyond the cap would happen
// (confirmed decision — no blocking, no "log out somewhere else first" dead
// end), then (2) inserts the new session row, then (3) signs and returns
// the token. Both numbers come from app_settings, so an admin change to
// either takes effect on the very next login, no deploy needed.
async function createSession(user) {
  const settings = await getSettings();
  const { rows: activeRows } = await pool.query(
    `SELECT id FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_seen_at ASC`,
    [user.id]
  );
  if (activeRows.length >= settings.concurrent_session_limit) {
    const evictCount = activeRows.length - settings.concurrent_session_limit + 1;
    const toEvict = activeRows.slice(0, evictCount).map((r) => r.id);
    await pool.query("UPDATE sessions SET revoked_at = now() WHERE id = ANY($1::int[])", [toEvict]);
  }

  const jti = crypto.randomUUID();
  await pool.query(
    `INSERT INTO sessions (user_id, jti, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [user.id, jti, settings.session_lifetime_days]
  );
  return signToken(user, jti, settings.session_lifetime_days);
}

// forceSignOutUser(userId) — revokes every active session for a user. Wired
// into a manual admin "Force sign-out" button, and called automatically the
// moment a partner/startup's status flips to Inactive (confirmed decision).
async function forceSignOutUser(userId) {
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
}

module.exports = { requireAuth, requireAdmin, requireRole, signToken, createSession, forceSignOutUser };
