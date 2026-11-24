const { Router } = require("express");
const crypto = require("crypto");
const { pool } = require("../db.js");
const { requireAuth, createSession } = require("../middleware/auth.js");
const { getSettings } = require("../lib/settings.js");
const email = require("../lib/email.js");

const router = Router();

// 20 Nov 2026 CS batch — both the "never had access" and "deactivated"
// cases now show the exact same wording (confirmed decision), pointing
// people at the shared RIV inbox instead of a generic "contact your RIV
// owner." One constant, reused for both, so there's a single source of
// truth for the exact text.
const NO_ACCESS_MESSAGE = "Please write to contact@retailinnovation.ventures to get yourself set up.";
const DEACTIVATED_MESSAGE = NO_ACCESS_MESSAGE;

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

// 24 Nov 2026 CS batch — POST /login (email + password) removed entirely.
// Password sign-in had already been hidden from the login screen for every
// role since 20 Nov 2026 (code-request is the only reachable mode) — this
// route, and the "Reset password" admin control that set a password for
// it, had nothing left that could ever call them. Passwordless (one-time
// email code) and Google sign-in (POST /google, below) are the two login
// paths now.

// 24 Nov 2026 CS batch — session-security Phase 1, shared by request-code
// and verify-code below. `locked_until` is the real 15-minute lock after
// 5 wrong verify attempts: checked in BOTH routes, not just verify-code,
// because the old per-code attempts counter resets on every new code —
// without this, someone locked out could just hit "Resend code" and keep
// guessing immediately.
function lockoutMessage(user) {
  if (!user.locked_until || new Date(user.locked_until) <= new Date()) return null;
  const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
  return `Too many incorrect attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

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

    const lockout = lockoutMessage(user);
    if (lockout) return res.status(429).json({ error: lockout });

    // 24 Nov 2026 CS batch — resend cooldown + hourly cap, both read off
    // login_codes.created_at (a row already exists per code sent) — no new
    // table needed. Checked before generating a new code. As of Phase 3,
    // both limits (and the OTP validity below) come from app_settings
    // instead of being hard-coded, so admin can tune them without a deploy.
    const settings = await getSettings();
    const { rows: recentRows } = await pool.query(
      "SELECT created_at FROM login_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [user.id]
    );
    if (recentRows[0] && Date.now() - new Date(recentRows[0].created_at).getTime() < settings.resend_cooldown_seconds * 1000) {
      return res.status(429).json({ error: `Please wait ${settings.resend_cooldown_seconds} seconds before requesting another code.` });
    }
    const { rows: hourRows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM login_codes WHERE user_id = $1 AND created_at > now() - interval '1 hour'",
      [user.id]
    );
    if (hourRows[0].n >= settings.resend_hourly_cap) {
      return res.status(429).json({ error: "Too many codes requested. Please try again in an hour." });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await pool.query(
      "INSERT INTO login_codes (user_id, code_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)",
      [user.id, codeHash, settings.otp_validity_minutes]
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

    const lockout = lockoutMessage(user);
    if (lockout) return res.status(429).json({ error: lockout });

    const settings = await getSettings();
    const { rows: codeRows } = await pool.query(
      `SELECT * FROM login_codes WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, settings.max_code_attempts]
    );
    const codeRow = codeRows[0];
    if (!codeRow) return res.status(401).json({ error: invalidMessage });

    const suppliedHash = crypto.createHash("sha256").update(String(code).trim()).digest("hex");
    const matches =
      suppliedHash.length === codeRow.code_hash.length &&
      crypto.timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(codeRow.code_hash));

    if (!matches) {
      // 24 Nov 2026 CS batch — the 15-minute lock itself: the moment this
      // code's attempts counter actually reaches 5 (not just "this was
      // attempt #5 but a race already pushed it past 5 first"), stamp
      // users.locked_until so request-code/verify-code both refuse for
      // the next 15 minutes regardless of which code is used next.
      const { rows: updatedRows } = await pool.query(
        "UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts",
        [codeRow.id]
      );
      if (updatedRows[0]?.attempts >= settings.max_code_attempts) {
        await pool.query(
          "UPDATE users SET locked_until = now() + ($2 || ' minutes')::interval WHERE id = $1",
          [user.id, settings.lockout_minutes]
        );
      }
      return res.status(401).json({ error: invalidMessage });
    }
    if (!(await isAccountActive(user))) return res.status(403).json({ error: DEACTIVATED_MESSAGE });

    await pool.query("UPDATE login_codes SET used_at = now() WHERE id = $1", [codeRow.id]);

    const token = await createSession(user);
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

    const token = await createSession(user);
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