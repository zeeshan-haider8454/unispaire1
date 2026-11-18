import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';

// Receipts are stored outside the source tree and never served as static files.
// They are returned only through an authenticated route.
const here = path.dirname(fileURLToPath(import.meta.url));
export const RECEIPT_DIR = process.env.RECEIPT_DIR || path.join(here, '..', '..', 'uploads', 'receipts');
fs.mkdirSync(RECEIPT_DIR, { recursive: true });

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
const MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: RECEIPT_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] ?? ''}`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(new AppError(400, 'Receipt must be a JPG, PNG, WebP image or a PDF.'));
    }
    return cb(null, true);
  },
});

// Accepts an optional "receipt" file field. JSON requests pass through unchanged.
export function receiptUpload(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'Receipt must be 5 MB or smaller.'));
    return next(err instanceof AppError ? err : new AppError(400, 'Could not read the uploaded receipt.'));
  });
}

// Removes a stored receipt file. Missing files are ignored.
export function deleteReceiptFile(fileName) {
  if (!fileName) return;
  fs.unlink(path.join(RECEIPT_DIR, path.basename(fileName)), () => {});
}

export function receiptPath(fileName) {
  return path.join(RECEIPT_DIR, path.basename(fileName));
}
