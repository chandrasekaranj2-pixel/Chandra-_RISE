// Supporting Material file storage (18 Sep 2026 addendum, rewritten 19 Sep
// 2026) — files are kept in a private Supabase Storage bucket
// (business-sensitive pitch content, not meant to be publicly linkable),
// separate from the Postgres database connection used everywhere else in
// this app.
//
// Originally built on @supabase/supabase-js's storage client using a
// service_role key. That hit a Supabase-side gap: this project's Supabase
// key is issued in the newer sb_secret_... format, and Storage's own
// signature verification doesn't yet handle that format correctly
// end-to-end ("Invalid Compact JWS" using the key as-is; "signature
// verification failed" even after hand-reconstructing a legacy-format
// service_role JWT from the project's Legacy JWT secret) — a known
// in-progress gap on Supabase's platform as of Sep 2026, not something
// fixable from our side of that integration.
//
// Switched instead to Supabase Storage's S3-compatible API, which uses
// dedicated Access Key ID / Secret Access Key credentials (Project
// Settings → Storage → S3 Connection) — a completely separate auth
// mechanism from the JWT/API-key system above, unaffected by that gap.
// These keys bypass RLS and are server-only, same trust level as the old
// service_role key. Needs four env vars (see backend/.env.example):
// SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID,
// SUPABASE_S3_SECRET_ACCESS_KEY.
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl: s3GetSignedUrl } = require("@aws-sdk/s3-request-presigner");

const BUCKET = process.env.SUPABASE_SUPPORTING_MATERIAL_BUCKET || "supporting-material";
// How long a generated download link stays valid — regenerated fresh on
// every request (see the download routes in portal.js/admin.js), so this
// just needs to comfortably outlast one click-through, not the file's life.
const SIGNED_URL_TTL_SECONDS = 60;

let client = null;
function getClient() {
  if (client) return client;
  const { SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY } = process.env;
  if (!SUPABASE_S3_ENDPOINT || !SUPABASE_S3_REGION || !SUPABASE_S3_ACCESS_KEY_ID || !SUPABASE_S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "Supporting-material upload is not configured: set SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID and SUPABASE_S3_SECRET_ACCESS_KEY."
    );
  }
  client = new S3Client({
    endpoint: SUPABASE_S3_ENDPOINT,
    region: SUPABASE_S3_REGION,
    credentials: {
      accessKeyId: SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: SUPABASE_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
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
  const s3 = getClient();
  const timestamp = Date.now();

  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `introductions/${startupId}/${timestamp}-${i}-${sanitizeFilename(file.originalname)}`;
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: path,
        Body: file.buffer,
        ContentType: file.mimetype,
      }));
    } catch (err) {
      throw new Error(`Failed to upload "${file.originalname}": ${err.message}`);
    }
    uploaded.push({ name: file.originalname, path, size: file.size, mime_type: file.mimetype });
  }
  return uploaded;
}

// Generates a short-lived signed URL for one stored file, for the download
// routes to redirect to. Never stored — regenerated per request.
async function getSignedUrl(path) {
  const s3 = getClient();
  try {
    return await s3GetSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: path }),
      { expiresIn: SIGNED_URL_TTL_SECONDS }
    );
  } catch (err) {
    throw new Error(`Failed to generate download link: ${err.message}`);
  }
}

module.exports = { uploadSupportingMaterial, getSignedUrl, BUCKET };
