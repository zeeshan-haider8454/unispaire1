import nodemailer from 'nodemailer';
import { AppError } from './errors.js';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `UniSphere <${SMTP_USER}>` : undefined);

export const smtpConfigured = Boolean(SMTP_USER && SMTP_PASS);

const MESSAGES = {
  login: {
    subject: 'Your UniSphere verification code',
    body: 'Your UniSphere verification code is {code}.\n\nIt expires in 10 minutes. If you did not try to sign in, you can ignore this email.',
  },
  reset: {
    subject: 'Reset your UniSphere password',
    body: 'Your UniSphere password reset code is {code}.\n\nIt expires in 10 minutes. If you did not ask to reset your password, you can ignore this email and your password will not change.',
  },
};

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

// Emails a six-digit code. purpose is 'login' or 'reset'.
// Without SMTP settings, the code is printed to the console instead.
export async function sendOtpEmail(to, code, purpose = 'login') {
  const message = MESSAGES[purpose];
  if (!smtpConfigured) {
    console.log(`\n[UniSphere ${purpose.toUpperCase()} OTP] ${to} -> ${code}   (valid for 10 minutes; SMTP not configured)\n`);
    return;
  }
  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to,
      subject: message.subject,
      text: message.body.replace('{code}', code),
    });
    // Logs the sender, recipient and SMTP result only. The code is never logged here.
    console.log(`[UniSphere mail] ${purpose} code sent from ${SMTP_FROM} to ${to} (smtp response: ${info.response})`);
  } catch (err) {
    // Log the reason on the server only. The code itself is never logged on this path.
    console.error(`SMTP send to ${to} failed: ${err.message}`);
    throw new AppError(502, 'We could not send the verification email. Please try again shortly.');
  }
}
