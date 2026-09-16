const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db.js");
const { requireAuth, signToken } = require("../middleware/auth.js");

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

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;