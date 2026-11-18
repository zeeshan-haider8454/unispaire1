import { AppError } from './errors.js';

// Fixed-window limiter kept in memory. Counts requests per client IP and per key.
// Suitable for a single server process; use a shared store if the API runs on several instances.
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  // Drop expired windows so the map does not grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(max - entry.count, 0)));

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new AppError(429, message));
    }
    return next();
  };
}

// Authentication endpoints: 30 POST requests per IP every 15 minutes.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many attempts from this network. Please wait 15 minutes and try again.',
});
