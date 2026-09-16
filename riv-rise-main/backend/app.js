const express = require("express");
const cors = require("cors");

const { initSchema } = require("./db.js");
const authRoutes = require("./routes/auth.js");
const portalRoutes = require("./routes/portal.js");
const adminRoutes = require("./routes/admin.js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", portalRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

let schemaReady;
function ensureSchema() {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}module.exports = { app, ensureSchema };