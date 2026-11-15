const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db.js");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { requireAuth, signToken, JWT_SECRET } = require("../middleware/auth.js");

const router = Router();

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Sign in / sign up with Google. The existing email + password login above
// is unchanged. A new person signs in with Google, fills in a short profile
// (GTM partner or startup) and lands on their dashboard. The email always
// comes from Google's verified ID token, never from what the browser sends.
// Set ALLOW_SELF_SIGNUP=false to stop new people creating accounts this way.
// ---------------------------------------------------------------------------
let googleClient = null;
function getGoogleClient() {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (!googleClient) googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return googleClient;
}

const normalizeEmail = (e) => String(e || "").toLowerCase().trim();
const cleanText = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const selfSignupEnabled = () => process.env.ALLOW_SELF_SIGNUP !== "false";
const SUSPENDED_MSG = "This login has been suspended. Contact RIV.";

// Google accounts have no password; users.password_hash is NOT NULL, so store
// the hash of a random value nobody knows (password login can never match it).
const unusablePasswordHash = () => bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, company: u.company });
const respondWithSession = (res, user) => res.json({ token: signToken(user), user: publicUser(user) });

async function isSuspended(user) {
  if (user.role === "admin") return false;
  const table = user.role === "partner" ? "partners" : "startups";
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE user_id = $1 AND portal_login_status = 'Suspended' LIMIT 1`,
    [user.id]
  );
  return rows.length > 0;
}

// A suspended partner/startup with no login yet must not dodge the
// suspension by signing up fresh.
async function emailIsSuspended(email) {
  const { rows } = await pool.query(
    `SELECT 1 FROM partners WHERE lower(email) = $1 AND portal_login_status = 'Suspended'
     UNION ALL
     SELECT 1 FROM startups WHERE lower(email) = $1 AND portal_login_status = 'Suspended' LIMIT 1`,
    [email]
  );
  return rows.length > 0;
}

// RIV may already have entered this person (no login yet). Google just
// verified they own that email, so link to the existing record instead of
// creating a duplicate.
async function linkPreEnteredProfile(payload) {
  const email = normalizeEmail(payload.email);
  for (const { table, role } of [{ table: "partners", role: "partner" }, { table: "startups", role: "startup" }]) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table} WHERE lower(email) = $1 AND user_id IS NULL AND portal_login_status <> 'Suspended' ORDER BY id LIMIT 1`,
      [email]
    );
    const row = rows[0];
    if (!row) continue;
    const name = (role === "partner" ? row.full_name : row.founder_name || row.startup_name) || payload.name || email;
    const company = role === "partner" ? row.company : row.startup_name;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: userRows } = await client.query(
        `INSERT INTO users (email, password_hash, name, role, company, google_sub) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [email, unusablePasswordHash(), name, role, company, payload.sub]
      );
      await client.query(
        `UPDATE ${table} SET user_id = $2, portal_login_status = 'Provisioned', updated_at = now() WHERE id = $1 AND user_id IS NULL`,
        [row.id, userRows[0].id]
      );
      await client.query("COMMIT");
      return userRows[0];
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err.code === "23505") return null;
      throw err;
    } finally {
      client.release();
    }
  }
  return null;
}

// POST /api/auth/google { credential } -> session, or { needsSignup, signupToken } for a new person
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

    const email = normalizeEmail(payload.email);
    const { rows } = await pool.query("SELECT * FROM users WHERE lower(email) = $1", [email]);
    let user = rows[0] || (await linkPreEnteredProfile(payload));

    if (!user) {
      if (!selfSignupEnabled()) return res.status(403).json({ error: "There's no RISE Portal account for this email. Ask RIV to set one up." });
      if (await emailIsSuspended(email)) return res.status(403).json({ error: SUSPENDED_MSG });
      const signupToken = jwt.sign(
        { purpose: "signup", email, sub: payload.sub, name: payload.name || "" },
        JWT_SECRET,
        { expiresIn: "15m" }
      );
      return res.json({ needsSignup: true, signupToken, email, name: payload.name || "" });
    }

    // First Google login binds the user to that Google account (`sub` is
    // permanent, unlike email which can be re-assigned).
    if (user.google_sub && user.google_sub !== payload.sub) {
      return res.status(403).json({ error: "This portal account is linked to a different Google account." });
    }
    if (await isSuspended(user)) return res.status(403).json({ error: SUSPENDED_MSG });
    if (!user.google_sub) await pool.query("UPDATE users SET google_sub = $2 WHERE id = $1", [user.id, payload.sub]);
    respondWithSession(res, user);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/signup { signupToken, role, ... } — finishes self-signup.
router.post("/signup", async (req, res, next) => {
  try {
    if (!selfSignupEnabled()) return res.status(403).json({ error: "Sign-up is closed. Ask RIV to set up your login." });

    let claims;
    try {
      claims = jwt.verify(String(req.body?.signupToken || ""), JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Your sign-up session expired. Please sign in with Google again." });
    }
    if (claims.purpose !== "signup" || !claims.email || !claims.sub) {
      return res.status(401).json({ error: "Your sign-up session expired. Please sign in with Google again." });
    }
    if (await emailIsSuspended(claims.email)) return res.status(403).json({ error: SUSPENDED_MSG });

    const role = req.body?.role;
    if (role !== "partner" && role !== "startup") {
      return res.status(400).json({ error: "Choose whether you're a GTM partner or a startup." });
    }
    const phone = cleanText(req.body?.phone, 40) || null;
    let name;
    let company;
    if (role === "partner") {
      name = cleanText(req.body?.fullName);
      company = cleanText(req.body?.company) || null;
      if (!name) return res.status(400).json({ error: "Your name is required." });
    } else {
      name = cleanText(req.body?.founderName);
      company = cleanText(req.body?.startupName);
      if (!company) return res.status(400).json({ error: "Your startup's name is required." });
      if (!name) return res.status(400).json({ error: "The founder's name is required." });
    }

    const client = await pool.connect();
    let user;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, name, role, company, google_sub) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [claims.email, unusablePasswordHash(), name, role, company, claims.sub]
      );
      user = rows[0];
      if (role === "partner") {
        await client.query(
          `INSERT INTO partners (user_id, full_name, company, email, phone, portal_login_status) VALUES ($1,$2,$3,$4,$5,'Provisioned')`,
          [user.id, name, company, claims.email, phone]
        );
      } else {
        await client.query(
          `INSERT INTO startups (user_id, startup_name, founder_name, email, phone, portal_login_status) VALUES ($1,$2,$3,$4,$5,'Provisioned')`,
          [user.id, company, name, claims.email, phone]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (err.code === "23505") {
        return res.status(409).json({ error: "This email already has an account. Go back and sign in with Google." });
      }
      throw err;
    } finally {
      client.release();
    }
    respondWithSession(res, user);
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;