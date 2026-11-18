import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { AppError } from './errors.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set; using a development fallback. Set it before deploying.');
}

export function signToken(user) {
  return jwt.sign({ sub: user.id }, SECRET, { expiresIn: '12h' });
}

// Returns the user for a valid token, or null. Throws if the token is invalid or expired.
export function userFromToken(token) {
  if (!token) return null;
  const payload = jwt.verify(token, SECRET);
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(payload.sub) ?? null;
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function optionalAuth(req, res, next) {
  try {
    req.user = userFromToken(bearer(req));
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  let user = null;
  try {
    user = userFromToken(bearer(req));
  } catch {
    user = null;
  }
  if (!user) return next(new AppError(401, 'Please log in to continue.'));
  req.user = user;
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'You do not have permission to do this.'));
    }
    return next();
  };
}
