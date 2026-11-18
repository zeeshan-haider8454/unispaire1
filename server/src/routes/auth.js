import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, signToken } from '../lib/auth.js';
import { nowIso } from '../lib/domain.js';
import { sendOtpEmail } from '../lib/mailer.js';
import { authRateLimit } from '../lib/rateLimit.js';

const router = Router();

// Every POST to an auth endpoint counts toward the per-IP limit (registration, login, OTP and reset).
router.use((req, res, next) => (req.method === 'POST' ? authRateLimit(req, res, next) : next()));

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const findUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);

// Creates a six-digit code for a purpose ('login' or 'reset'), emails it, and invalidates any earlier code.
// The code is saved only after it has been sent, so a failed send leaves no unusable code behind.
async function issueOtp(user, purpose = 'login') {
  const latest = db.prepare('SELECT created_at FROM otp_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id);
  if (latest) {
    const waitMs = OTP_COOLDOWN_MS - (Date.now() - Date.parse(latest.created_at));
    if (waitMs > 0) {
      throw new AppError(429, `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting a new code.`);
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await sendOtpEmail(user.email, code, purpose);

  db.prepare('UPDATE otp_codes SET invalidated = 1 WHERE user_id = ? AND invalidated = 0').run(user.id);
  db.prepare('INSERT INTO otp_codes (user_id, code_hash, expires_at, created_at, purpose) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, hashCode(code), new Date(Date.now() + OTP_TTL_MS).toISOString(), nowIso(), purpose);
}

// Checks a code for the given purpose. Throws AppError on failure. Marks the code used on success.
function checkOtp(user, code, purpose) {
  const otp = db.prepare('SELECT * FROM otp_codes WHERE user_id = ? AND invalidated = 0 ORDER BY id DESC LIMIT 1').get(user.id);
  if (!otp || otp.purpose !== purpose) throw new AppError(400, 'No active code. Request a new one.');

  if (Date.now() > Date.parse(otp.expires_at)) {
    db.prepare('UPDATE otp_codes SET invalidated = 1 WHERE id = ?').run(otp.id);
    throw new AppError(400, 'This code has expired. Request a new one.');
  }

  if (hashCode(code) !== otp.code_hash) {
    const attempts = otp.attempts + 1;
    const invalidated = attempts >= OTP_MAX_ATTEMPTS ? 1 : 0;
    db.prepare('UPDATE otp_codes SET attempts = ?, invalidated = ? WHERE id = ?').run(attempts, invalidated, otp.id);
    if (invalidated) throw new AppError(400, 'Too many incorrect attempts. Request a new code.');
    throw new AppError(400, `Incorrect code. ${OTP_MAX_ATTEMPTS - attempts} attempt(s) left.`);
  }

  db.prepare('UPDATE otp_codes SET invalidated = 1 WHERE id = ?').run(otp.id);
}

router.post('/register', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const role = req.body?.role;

  if (!name) throw new AppError(400, 'Name is required.');
  if (!EMAIL_RE.test(email)) throw new AppError(400, 'Enter a valid email address.');
  if (password.length < MIN_PASSWORD_LENGTH) throw new AppError(400, 'Password must contain at least 8 characters.');
  // The administrator role is never offered through public signup.
  if (!['student', 'president'].includes(role)) {
    throw new AppError(400, 'Choose Society President / Organizer or Student / Volunteer.');
  }
  if (findUserByEmail(email)) throw new AppError(409, 'An account with this email already exists.');

  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 10), role);
  await issueOtp(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid), 'login');

  res.status(201).json({ message: 'Account created. Enter the six-digit code sent to your email.', email });
});

// Step 1 of login: checks the password and sends a code.
router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const user = findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new AppError(401, 'Invalid email or password.');
  }
  await issueOtp(user, 'login');
  res.json({ message: 'A six-digit code was sent to your email.', email });
});

// Step 2 of login: checks the code and returns a session token.
router.post('/verify-otp', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code ?? '').trim();
  const user = findUserByEmail(email);
  if (!user) throw new AppError(400, 'Invalid code.');

  checkOtp(user, code, 'login');
  res.json({ token: signToken(user), user: publicUser(user) });
});

// Password reset, step 1: emails a reset code. The response is the same whether or not the account exists,
// so the form cannot be used to discover registered emails.
router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const user = EMAIL_RE.test(email) ? findUserByEmail(email) : null;
  if (user) await issueOtp(user, 'reset');
  res.json({ message: 'If an account exists for this email, a six-digit reset code has been sent.', email });
});

// Password reset, step 2: checks the reset code and sets the new password.
router.post('/reset-password', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code ?? '').trim();
  const password = String(req.body?.password ?? '');
  const user = findUserByEmail(email);
  if (!user) throw new AppError(400, 'Invalid code.');

  if (password.length < MIN_PASSWORD_LENGTH) throw new AppError(400, 'Password must contain at least 8 characters.');
  checkOtp(user, code, 'reset');

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  // Retire any other outstanding codes for this account.
  db.prepare('UPDATE otp_codes SET invalidated = 1 WHERE user_id = ? AND invalidated = 0').run(user.id);
  res.json({ message: 'Your password has been reset. You can log in with the new password.' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
