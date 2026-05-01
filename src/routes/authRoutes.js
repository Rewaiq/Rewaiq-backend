const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const {
  register, verifyOTP, resendOTP, login,
  googleAuthSuccess, forgotPassword, resetPassword
} = require('../controllers/authController');

// Email auth
router.post('/register', register);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/login', login);

// Password reset
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Google OAuth
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/api/auth/google/error' }),
  googleAuthSuccess
);
router.get('/google/error', (req, res) => {
  res.status(401).json({ message: 'Google authentication failed' });
});

module.exports = router;