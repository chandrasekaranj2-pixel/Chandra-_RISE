// Multer middleware for the Supporting Material upload field (18 Sep 2026
// addendum). Memory storage, not disk — files pass straight through to
// Supabase Storage (see supportingMaterialStorage.js) and the backend may
// run as a Netlify Function / Render service, neither of which has durable
// local disk anyway.
const multer = require("multer");

// 10 MB per file, up to 3 files — confirmed 18 Sep 2026.
const MAX_FILE_SIZE_MB = 10;
const MAX_FILES = 3;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

const supportingMaterialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Only PDF, PPT/PPTX, and DOC/DOCX files are accepted."));
    }
    cb(null, true);
  },
}).array("supportingMaterial", MAX_FILES);

// Wraps multer so its errors (wrong type, too large, too many files) come
// back as the same { error: "..." } JSON shape as every other route here,
// instead of multer's default plain-text/stack-trace response. When the
// request is NOT multipart/form-data (e.g. the partner-initiated JSON
// introduction flow sharing this same POST /introductions route), multer
// recognizes that and calls next() immediately without touching req.body —
// so this middleware is safe to apply unconditionally to a route that
// sometimes receives files and sometimes doesn't.
function handleSupportingMaterialUpload(req, res, next) {
  supportingMaterialUpload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: `Each file must be under ${MAX_FILE_SIZE_MB} MB.` });
      }
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: `You can attach up to ${MAX_FILES} files.` });
      }
    }
    return res.status(400).json({ error: err.message || "Could not process the uploaded files." });
  });
}

module.exports = { handleSupportingMaterialUpload, MAX_FILE_SIZE_MB, MAX_FILES };
