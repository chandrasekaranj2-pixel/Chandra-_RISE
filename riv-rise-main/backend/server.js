require("dotenv/config");
const { app, ensureSchema } = require("./app.js");

const PORT = process.env.PORT || 4100;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`RISE Portal backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });