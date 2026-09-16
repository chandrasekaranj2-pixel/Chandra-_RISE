const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired — please log in again." });
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

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}
module.exports = { requireAuth, requireAdmin, requireRole, signToken };