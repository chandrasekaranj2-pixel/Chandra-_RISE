const { Router } = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../db.js");
const { requireAuth, signToken } = require("../middleware/auth.js");
const email = require("../lib/email.js");

const router = Router();

const NO_ACCESS_MESSAGE = "You don't have access to RISE. Contact your RIV owner to get set up.";
const DEACTIVATED_MESSAGE = "Your RISE access has been deactivated. Contact your RIV owner.";

// Admins have no partner/startup row to check, so they're always active.
// A partner/startup is blocked the moment RIV admin marks their record
// Inactive or Suspended — the "offboarding safety net" every login method
// (password, code, and later Google/Microsoft) shares (CEO doc, Nov 2026).
async function isAccountActive(user) {
  if (user.role !== "partner" && user.role !== "startup") return true;
  const table = user.role === "partner" ? "partners" : "startups";
  const { rows } = await pool.query(`SELECT status, portal_login_status FROM ${table} WHERE user_id = $1`, [user.id]);
  const row = rows[0];
  if (!row) return true; // no linked record — shouldn't happen, don't block defensively
  return row.status !== "Inactive" && row.portal_login_status !== "Suspended";
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (!(await isAccountActive(user))) return res.status(403).json({ error: DEACTIVATED_MESSAGE });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/request-code — passwordless sign-in, step 1 (CEO request, Nov
// 2026): email a one-time code to anyone who already has a RISE account.
// Invite-only, same as every login method here: an email with no matching
// users row (or one RIV admin deactivated) gets the same message and no
// code at all — nothing is ever created on the fly.
router.post("/request-code", async (req, res, next) => {
  try {
    const { email: rawEmail } = req.body || {};
    if (!rawEmail) return res.status(400).json({ error: "Email is required." });
    const normalizedEmail = String(rawEmail).toLowerCase().trim();

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    const user = rows[0];
    if (!user) return res.status(403).json({ error: NO_ACCESS_MESSAGE });
    if (!(await isAccountActive(user))) return res.status(403).json({ error: NO_ACCESS_MESSAGE });

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await pool.query(
      "INSERT INTO login_codes (user_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')",
      [user.id, codeHash]
    );

    await email.safely("Login-code", () =>
      email.sendEmail({
        to: user.email,
        ...email.buildLoginCode({ name: user.name, code }),
        replyTo: email.adminNotifyEmail(),
        type: "login-code",
      })
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/verify-code — passwordless sign-in, step 2: the code the user
// typed back in. Single-use, 10-minute expiry, capped attempts so it can't
// be brute-forced.
router.post("/verify-code", async (req, res, next) => {
  try {
    const { email: rawEmail, code } = req.body || {};
    if (!rawEmail || !code) return res.status(400).json({ error: "Email and code are required." });
    const normalizedEmail = String(rawEmail).toLowerCase().trim();

    const { rows: userRows } = await pool.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    const user = userRows[0];
    const invalidMessage = "This code is incorrect or has expired. Request a new one.";
    if (!user) return res.status(401).json({ error: invalidMessage });

    const { rows: codeRows } = await pool.query(
      `SELECT * FROM login_codes WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < 5
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const codeRow = codeRows[0];
    if (!codeRow) return res.status(401).json({ error: invalidMessage });

    const suppliedHash = crypto.createHash("sha256").update(String(code).trim()).digest("hex");
    const matches =
      suppliedHash.length === codeRow.code_hash.length &&
      crypto.timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(codeRow.code_hash));

    if (!matches) {
      await pool.query("UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1", [codeRow.id]);
      return res.status(401).json({ error: invalidMessage });
    }
    if (!(await isAccountActive(user))) return res.status(403).json({ error: DEACTIVATED_MESSAGE });

    await pool.query("UPDATE login_codes SET used_at = now() WHERE id = $1", [codeRow.id]);

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/google — "Sign in with Google" (CEO request, Nov 2026).
// RIV decides who's a partner/startup by creating their record first (same
// as today), so this is a second way in for someone already on file, never
// an open self-signup: an email with no matching users row is rejected,
// not auto-created.
router.post("/google", async (req, res, next) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: "Missing Google credential." });
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "Google sign-in isn't configured on this server yet." });
    }

    // Verify the ID token with Google directly — no extra library needed,
    // Node 18's built-in fetch is enough for this one call.
    let payload;
    try {
      const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!verifyRes.ok) return res.status(401).json({ error: "Google sign-in failed — please try again." });
      payload = await verifyRes.json();
    } catch {
      return res.status(401).json({ error: "Google sign-in failed — please try again." });
    }

    if (payload.aud !== process.env.GOOGLE_CLIENT_ID || (payload.email_verified !== "true" && payload.email_verified !== true)) {
      return res.status(401).json({ error: "Google sign-in failed — please try again." });
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [String(payload.email).toLowerCase().trim()]);
    const user = rows[0];
    if (!user) {
      return res.status(403).json({ error: "This Google account isn't linked to a RISE record. Contact your RIV owner to get set up." });
    }
    if (!(await isAccountActive(user))) return res.status(403).json({ error: DEACTIVATED_MESSAGE });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;