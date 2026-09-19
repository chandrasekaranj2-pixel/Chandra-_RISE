// Supporting Material file storage (18 Sep 2026 addendum) — files are kept
// in a private Supabase Storage bucket (business-sensitive pitch content,
// not meant to be publicly linkable), separate from the Postgres database
// connection used everywhere else in this app. Requires two env vars that
// don't exist yet in production and need adding: SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (service role, not anon — uploads/signing run
// server-side only, never exposed to the browser). See backend/.env.example.
const { createClient } = require("@supabase/supabase-js");

const BUCKET = process.env.SUPABASE_SUPPORTING_MATERIAL_BUCKET || "supporting-material";
// How long a generated download link stays valid — regenerated fresh on
// every request (see the download routes in portal.js/admin.js), so this
// just needs to comfortably outlast one click-through, not the file's life.
const SIGNED_URL_TTL_SECONDS = 60;

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supporting-material upload is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return client;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

// Uploads every file in `files` (multer's in-memory file objects) under
// introductions/<startupId>/<timestamp>-<index>-<sanitized name>, and
// returns the array to store in introductions.supporting_material.
async function uploadSupportingMaterial(files, { startupId }) {
  if (!files || !files.length) return [];
  const supabase = getClient();
  const timestamp = Date.now();

  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `introductions/${startupId}/${timestamp}-${i}-${sanitizeFilename(file.originalname)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) throw new Error(`Failed to upload "${file.originalname}": ${error.message}`);
    uploaded.push({ name: file.originalname, path, size: file.size, mime_type: file.mimetype });
  }
  return uploaded;
}

// Generates a short-lived signed URL for one stored file, for the download
// routes to redirect to. Never stored — regenerated per request.
async function getSignedUrl(path) {
  const supabase = getClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(`Failed to generate download link: ${error.message}`);
  return data.signedUrl;
}

module.exports = { uploadSupportingMaterial, getSignedUrl, BUCKET };
