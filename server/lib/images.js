/* =========================================================
   BloxBazaar BD — server/lib/images.js
   Product image processing (PRD §7, §10): validate the real
   file type, re-encode with sharp (which strips EXIF/GPS and
   any embedded payloads), bound dimensions, store under a
   random key. The original filename is never trusted.
   ========================================================= */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { fieldError, httpError } = require("./problem");

const MAX_SIDE = 2400;
const MIN_SIDE = 64;

const FORMATS = {
  jpeg: { ext: "jpg", options: { quality: 82 } },
  png: { ext: "png", options: { compressionLevel: 9 } },
  webp: { ext: "webp", options: { quality: 82 } },
};

/* buffer → { key, url, width, height, bytes } or throws httpError(422). */
async function processUpload(buffer, uploadsDir) {
  let meta;
  try {
    meta = await sharp(buffer, { failOn: "error" }).metadata();
  } catch (err) {
    throw httpError(422, "Validation failed", "The file is not a readable image.", [
      fieldError("file", "Only JPEG, PNG, or WebP images are allowed."),
    ]);
  }

  const format = FORMATS[meta.format];
  if (!format) {
    throw httpError(422, "Validation failed", "Unsupported image format.", [
      fieldError("file", "Only JPEG, PNG, or WebP images are allowed."),
    ]);
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < MIN_SIDE || height < MIN_SIDE) {
    throw httpError(422, "Validation failed", "Image is too small.", [
      fieldError("file", "Images must be at least 64×64 pixels."),
    ]);
  }

  let pipeline = sharp(buffer, { failOn: "error" }).rotate(); /* honour EXIF orientation */
  if (Math.max(width, height) > MAX_SIDE) {
    pipeline = pipeline.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  }
  const out = await pipeline.toFormat(meta.format, format.options).toBuffer();
  const finalMeta = await sharp(out).metadata();

  const name = crypto.randomUUID() + "." + format.ext;
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, name), out);

  return {
    key: "uploads/" + name,
    url: "/uploads/" + name,
    width: finalMeta.width,
    height: finalMeta.height,
    bytes: out.length,
  };
}

module.exports = { processUpload, FORMATS, MAX_SIDE, MIN_SIDE };
