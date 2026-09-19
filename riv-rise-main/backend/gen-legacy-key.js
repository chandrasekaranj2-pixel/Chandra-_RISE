// One-time helper — generates a service_role JWT from your Supabase
// project's Legacy JWT secret. Run locally, never commit this file.
const crypto = require("crypto");

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: node gen-legacy-key.js "<legacy JWT secret>"');
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// "kid" must match the Legacy HS256 key's own ID from your Supabase
// project's JWT Keys page ("Previously used keys" row) — without it,
// Storage can't tell which of your project's signing keys to verify
// this token against and the check fails outright.
const header = { alg: "HS256", typ: "JWT", kid: "7BDA3DC1-BAAA-4BA0-8AE5-FE9DD271219C" };
const now = Math.floor(Date.now() / 1000);
const payload = { role: "service_role", iss: "supabase", iat: now, exp: now + 10 * 365 * 24 * 60 * 60 };

const headerEncoded = base64url(JSON.stringify(header));
const payloadEncoded = base64url(JSON.stringify(payload));
const signature = crypto.createHmac("sha256", secret)
  .update(`${headerEncoded}.${payloadEncoded}`).digest("base64")
  .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

console.log(`${headerEncoded}.${payloadEncoded}.${signature}`);
