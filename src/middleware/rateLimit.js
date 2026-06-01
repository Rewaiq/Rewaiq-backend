const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 500, // increased from 100
  message: { message: 'Too many requests — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // increased from 10
  message: { message: 'Too many auth attempts — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter };
