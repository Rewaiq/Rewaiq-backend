const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendOTP, sendWelcome } = require('../config/email');

const generateReferralCode = () => {
  return 'RWQ' + crypto.randomBytes(4).toString('hex').toUpperCase();
};

// REGISTER
const register = async (req, res) => {
  const { full_name, email, password, phone, referral_code, role } = req.body;
  try {
    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const myReferralCode = generateReferralCode();

    let referredBy = null;
    if (referral_code) {
      const referrer = await pool.query('SELECT id FROM users WHERE referral_code = $1', [referral_code]);
      if (referrer.rows.length > 0) referredBy = referrer.rows[0].id;
    }

   const newUser = await pool.query(
  `INSERT INTO users (full_name, email, password, phone, referral_code, referred_by, role)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   RETURNING id, full_name, email, role`,
  [full_name, email, hashedPassword, phone, myReferralCode, referredBy, role || 'user']
);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      'INSERT INTO otp_codes (email, otp, expires_at) VALUES ($1, $2, $3)',
      [email, otp, expiresAt]
    );

    // Send OTP email — wrapped so it doesn't crash registration
    try {
      await sendOTP(email, otp, full_name);
    } catch (emailErr) {
      console.error('OTP email failed:', emailErr.message);
    }

    res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      user_id: newUser.rows[0].id,
      email
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// VERIFY OTP
const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const otpRecord = await pool.query(
      `SELECT * FROM otp_codes 
       WHERE email = $1 AND otp = $2 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    if (otpRecord.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    await pool.query('UPDATE otp_codes SET used = true WHERE id = $1', [otpRecord.rows[0].id]);
    await pool.query('UPDATE users SET is_email_verified = true WHERE email = $1', [email]);

    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const userData = user.rows[0];

    if (userData.referred_by) {
      await pool.query(
        `INSERT INTO referrals (referrer_id, referred_id, coins_awarded, status)
         VALUES ($1, $2, 100, 'pending')`,
        [userData.referred_by, userData.id]
      );
    }

    // Send welcome email — wrapped so it doesn't crash verification
    try {
      await sendWelcome(email, userData.full_name);
    } catch (emailErr) {
      console.error('Welcome email failed:', emailErr.message);
    }

    const token = jwt.sign({ id: userData.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Email verified successfully',
      user: {
        id: userData.id,
        full_name: userData.full_name,
        email: userData.email,
        role: userData.role,
        coin_balance: userData.coin_balance,
        referral_code: userData.referral_code
      },
      token
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// RESEND OTP
const resendOTP = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    if (user.rows[0].is_email_verified) return res.status(400).json({ message: 'Email already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query('INSERT INTO otp_codes (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);

    try {
      await sendOTP(email, otp, user.rows[0].full_name);
    } catch (emailErr) {
      console.error('Resend OTP email failed:', emailErr.message);
    }

    res.json({ message: 'OTP resent successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// LOGIN
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (user.rows.length === 0) {
      try {
        await pool.query(
          `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)`,
          [email, req.ip, false]
        );
      } catch (e) {}
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    if (!isMatch) {
      try {
        await pool.query(
          `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)`,
          [email, req.ip, false]
        );
      } catch (e) {}
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.rows[0].is_email_verified) {
      return res.status(400).json({ message: 'Please verify your email first' });
    }

    try {
      await pool.query(
        `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)`,
        [email, req.ip, true]
      );
    } catch (e) {}

    const token = jwt.sign({ id: user.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      user: {
        id: user.rows[0].id,
        full_name: user.rows[0].full_name,
        email: user.rows[0].email,
        role: user.rows[0].role,
        coin_balance: user.rows[0].coin_balance,
        referral_code: user.rows[0].referral_code
      },
      token
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GOOGLE AUTH SUCCESS
const googleAuthSuccess = async (req, res) => {
  try {
    const token = jwt.sign(
      { id: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.redirect(`https://app.rewaiq.com.ng/auth/success?token=${token}`);
  } catch (err) {
    res.redirect('https://app.rewaiq.com.ng/auth/error');
  }
};

// FORGOT PASSWORD
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3',
      [resetToken, expires, email]
    );

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query(
      'INSERT INTO otp_codes (email, otp, expires_at) VALUES ($1, $2, $3)',
      [email, otp, new Date(Date.now() + 10 * 60 * 1000)]
    );

    try {
      await sendOTP(email, otp, user.rows[0].full_name);
    } catch (emailErr) {
      console.error('Password reset email failed:', emailErr.message);
    }

    res.json({ message: 'Password reset OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// RESET PASSWORD
const resetPassword = async (req, res) => {
  const { email, otp, new_password } = req.body;
  try {
    const otpRecord = await pool.query(
      `SELECT * FROM otp_codes 
       WHERE email = $1 AND otp = $2 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    if (otpRecord.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    await pool.query('UPDATE otp_codes SET used = true WHERE id = $1', [otpRecord.rows[0].id]);

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE email = $2',
      [hashedPassword, email]
    );

    res.json({ message: 'Password reset successful. Please login.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  register, verifyOTP, resendOTP, login,
  googleAuthSuccess, forgotPassword, resetPassword
};
