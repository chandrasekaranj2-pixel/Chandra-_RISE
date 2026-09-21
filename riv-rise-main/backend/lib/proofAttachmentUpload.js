// Multer middleware for the "Provide proof of introduction" attachment
// field (19 Sep 2026 feedback — Submit Proof of Startup-Retailer
// Introduction). Unlike supportingMaterialUpload.js (documents, up to 3
// files), this is a single screenshot of the email/WhatsApp/LinkedIn
// exchange proving the introduction happened — image types (plus PDF, for
// a forwarded email saved/printed as PDF). Memory storage, same reasoning
// as supportingMaterialUpload.js (no durable local disk on Render).
const multer = require("multer");

const MAX_FILE_SIZE_MB = 10;

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

const proofAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Only PNG, JPG, WEBP screenshots or a PDF are accepted."));
    }
    cb(null, true);
  },
}).single("proofAttachment");

// Same error-shape wrapper as handleSupportingMaterialUpload — see that
// file for why this is safe to apply even when the request turns out not
// to be multipart/form-data.
function handleProofAttachmentUpload(req, res, next) {
  proofAttachmentUpload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: `The proof file must be under ${MAX_FILE_SIZE_MB} MB.` });
      }
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: "Only one proof file can be attached." });
      }
    }
    return res.status(400).json({ error: err.message || "Could not process the uploaded file." });
  });
}

module.exports = { handleProofAttachmentUpload, MAX_FILE_SIZE_MB };
