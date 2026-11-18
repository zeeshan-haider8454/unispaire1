import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';

// Society logos live outside the source tree and are served only through an authenticated route.
const here = path.dirname(fileURLToPath(import.meta.url));
export const LOGO_DIR = process.env.LOGO_DIR || path.join(here, '..', '..', 'uploads', 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_BYTES = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: LOGO_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] ?? ''}`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(new AppError(400, 'Logo must be a JPG, PNG or WebP image.'));
    return cb(null, true);
  },
});

// Accepts one "logo" file field.
export function logoUpload(req, res, next) {
  upload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'Logo must be 2 MB or smaller.'));
    return next(err instanceof AppError ? err : new AppError(400, 'Could not read the uploaded logo.'));
  });
}

export function deleteLogoFile(fileName) {
  if (!fileName) return;
  fs.unlink(path.join(LOGO_DIR, path.basename(fileName)), () => {});
}

export function logoPath(fileName) {
  return path.join(LOGO_DIR, path.basename(fileName));
}
