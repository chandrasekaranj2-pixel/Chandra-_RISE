const { Router } = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const { pool } = require("../db.js");
const { requireAuth, signToken } = require("../middleware/auth.js");
const { sendLoginLink } = require("../lib/email.js");

const router = Router();

// Passwordless sign-in for the RISE Portal.
//
// RISE is invite-only: RIV admin creates a partner/startup (which creates the
// `users` row on "Enable login"). Every method below only ever LOOKS UP an
// existing user by verified email — none of them can create an account, so a
// random Google account or random email address can't get in.
//
//   POST /api/auth/google           { credential }  Google ID token -> session
//   POST /api/auth/login-link       { email }       emails a one-time link
//   POST /api/auth/login-link/verify { token }      link token -> session
//   POST /api/auth/login            { email, password }  legacy, can be turned
//                                    off with ALLOW_PASSWORD_LOGIN=false

const LINK_TTL_MINUTES = 15;
const LINK_COOLDOWN_SECONDS = 60;
const NO_ACCOUNT_MESSAGE =
  "There's no RISE Portal account for this email. Ask RIV to enable your login, or try the email you were invited with.";

let googleClient = null;
function getGoogleClient() {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (!googleClient) googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return googleClient;
}

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company };
}

function respondWithSession(res, user) {
  res.json({ token: signToken(user), user: publicUser(user) });
}

// A partner/startup RIV has suspended must not be able to sign in by any
// method. Admins have no partner/startup row, so they're never suspended.
async function isSuspended(user) {
  if (user.role === "admin") return false;
  const table = user.role === "partner" ? "partners" : "startups";
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE user_id = $1 AND portal_login_status = 'Suspended' LIMIT 1`,
    [user.id]
  );
  return rows.length > 0;
}

async function findUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE lower(email) = $1", [email]);
  return rows[0] || null;
}

// ---------- Google ----------
router.post("/google", async (req, res, next) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: "Missing Google credential." });

    const client = getGoogleClient();
    if (!client) return res.status(503).json({ error: "Google sign-in isn't configured on the server." });

    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: "Google sign-in couldn't be verified. Please try again." });
    }
    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ error: "That Google account's email isn't verified." });
    }

    const user = await findUserByEmail(normalizeEmail(payload.email));
    if (!user) return res.status(403).json({ error: NO_ACCOUNT_MESSAGE });

    // First Google login binds this user to that Google account (`sub` is
    // Google's permanent id, unlike email which can be re-assigned).
    if (user.google_sub && user.google_sub !== payload.sub) {
      return res.status(403).json({ error: "This portal account is linked to a different Google account." });
    }
    if (await isSuspended(user)) {
      return res.status(403).json({ error: "This login has been suspended. Contact RIV." });
    }
    if (!user.google_sub) {
      await pool.query("UPDATE users SET google_sub = $2 WHERE id = $1", [user.id, payload.sub]);
    }
    respondWithSession(res, user);
  } catch (err) {
    next(err);
  }
});

// ---------- Email sign-in link ----------
// Always answers the same way whether or not the email has an account, so
// this can't be used to find out who's registered.
router.post("/login-link", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Enter a valid email address." });

    const generic = { ok: true, message: "If that email has a RISE Portal account, a sign-in link is on its way." };

    const user = await findUserByEmail(email);
    if (!user || (await isSuspended(user))) return res.json(generic);

    const appUrl = process.env.APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
    if (!appUrl) {
      // Never build the link from the request's Origin/Host header: that would
      // let anyone get a valid sign-in link for someone else pointed at their
      // own site.
      console.error("APP_URL is not set — can't send a sign-in link.");
      return res.json(generic);
    }

    const { rows: recent } = await pool.query(
      `SELECT 1 FROM login_tokens WHERE user_id = $1 AND created_at > now() - ($2 || ' seconds')::interval LIMIT 1`,
      [user.id, String(LINK_COOLDOWN_SECONDS)]
    );
    if (recent.length) return res.json(generic);

    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [hashToken(token), user.id, String(LINK_TTL_MINUTES)]
    );
    pool.query("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'").catch(() => {});

    const link = `${appUrl.replace(/\/$/, "")}/?login_token=${token}`;
    try {
      const result = await sendLoginLink({ to: user.email, name: user.name, link, ttlMinutes: LINK_TTL_MINUTES });
      if (result?.skipped && process.env.NODE_ENV !== "production") {
        console.log(`[dev] Sign-in link for ${user.email}: ${link}`);
      }
    } catch (err) {
      console.error("Sign-in link email failed:", err.message);
    }
    res.json(generic);
  } catch (err) {
    next(err);
  }
});

// The emailed link opens the frontend (not this API), and the frontend POSTs
// the token here. Using a POST means email-security scanners that pre-fetch
// links can't accidentally use up the one-time token.
router.post("/login-link/verify", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "");
    if (!token) return res.status(400).json({ error: "Missing sign-in token." });

    // Single atomic statement: only one request can ever flip used_at.
    const { rows } = await pool.query(
      `UPDATE login_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [hashToken(token)]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: "This sign-in link has expired or was already used. Request a new one." });
    }

    const { rows: userRows } = await pool.query("SELECT * FROM users WHERE id = $1", [rows[0].user_id]);
    const user = userRows[0];
    if (!user) return res.status(401).json({ error: "This account no longer exists." });
    if (await isSuspended(user)) return res.status(403).json({ error: "This login has been suspended. Contact RIV." });

    respondWithSession(res, user);
  } catch (err) {
    next(err);
  }
});

// ---------- Legacy password login (kept for the transition) ----------
router.post("/login", async (req, res, next) => {
  try {
    if (process.env.ALLOW_PASSWORD_LOGIN === "false") {
      return res.status(403).json({ error: "Password sign-in is turned off. Use Google or an email link." });
    }
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const user = await findUserByEmail(normalizeEmail(email));
    // password_hash is NULL for accounts that only use Google / email links.
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (await isSuspended(user)) return res.status(403).json({ error: "This login has been suspended. Contact RIV." });

    respondWithSession(res, user);
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
