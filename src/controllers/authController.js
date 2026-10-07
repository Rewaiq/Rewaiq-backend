const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendOTP, sendWelcome } = require('../config/email');

const REFERRAL_REWARD_COINS = 100;
const WELCOME_BONUS_COINS = 10;
const MAX_ACCOUNTS_PER_IP = 3;

const generateReferralCode = () => {
  return 'RWQ' + crypto.randomBytes(4).toString('hex').toUpperCase();
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

// =========================================================
// REGISTER
// =========================================================

const register = async (req, res) => {
  const {
    full_name,
    email,
    password,
    phone,
    referral_code,
    role
  } = req.body;

  const clientIp = getClientIp(req);
  const normalizedEmail = (email || '').toLowerCase().trim();
  const trimmedName = (full_name || '').trim();

  try {
    if (!normalizedEmail || !password || !trimmedName) {
      return res.status(400).json({
        message: 'Full name, email, and password are required'
      });
    }

    // 1. Check if email is already registered
    const userExists = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({
        message: 'Email already registered'
      });
    }

    // 2. Prevent account farming: check accounts created from this IP in the last 24h
    const ipCheck = await pool.query(
      `SELECT COUNT(*) 
       FROM users 
       WHERE registration_ip = $1 
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [clientIp]
    );

    if (parseInt(ipCheck.rows[0]?.count || 0, 10) >= MAX_ACCOUNTS_PER_IP) {
      return res.status(429).json({
        message: 'Registration limit reached for this network. Please try again tomorrow.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const myReferralCode = generateReferralCode();

    // 3. Resolve referrer (case-insensitive and trimmed)
    let referredBy = null;
    let referrerRecord = null;

    if (referral_code && typeof referral_code === 'string') {
      const cleanRefCode = referral_code.trim().toUpperCase();

      const referrer = await pool.query(
        `SELECT id, registration_ip, referral_code 
         FROM users 
         WHERE UPPER(referral_code) = $1`,
        [cleanRefCode]
      );

      if (referrer.rows.length > 0) {
        referrerRecord = referrer.rows[0];

        // Disallow self-referral via IP match
        if (referrerRecord.registration_ip && referrerRecord.registration_ip === clientIp) {
          return res.status(400).json({
            message: 'You cannot use a referral code from the same device or network.'
          });
        }

        referredBy = referrerRecord.id;
      }
    }

    // 4. Create user
    const newUser = await pool.query(
      `INSERT INTO users
        (full_name, email, password, phone, referral_code, referred_by, role, registration_ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, full_name, email, role`,
      [
        trimmedName,
        normalizedEmail,
        hashedPassword,
        phone || null,
        myReferralCode,
        referredBy,
        role || 'user',
        clientIp
      ]
    );

    const newUserId = newUser.rows[0].id;

    // 5. Welcome bonus
    await pool.query(
      `INSERT INTO transactions
        (user_id, amount, type, status, metadata)
       VALUES ($1, $2, 'welcome_bonus', 'completed', $3)`,
      [
        newUserId,
        WELCOME_BONUS_COINS,
        JSON.stringify({ note: 'Initial signup welcome bonus' })
      ]
    );

    await pool.query(
      'UPDATE users SET coin_balance = COALESCE(coin_balance, 0) + $1 WHERE id = $2',
      [WELCOME_BONUS_COINS, newUserId]
    );

    // 6. Generate and store OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_codes
        (email, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [normalizedEmail, otp, expiresAt]
    );

    // 7. Send OTP Email
    try {
      await sendOTP(normalizedEmail, otp, trimmedName);
    } catch (emailErr) {
      console.error('OTP email failed:', emailErr.message);
    }

    return res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      user_id: newUserId,
      email: normalizedEmail,
      welcome_bonus: WELCOME_BONUS_COINS
    });

  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// VERIFY OTP (CREDITS REFERRAL BONUS & WALLET)
// =========================================================

const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Validate OTP
    const otpRecord = await client.query(
      `SELECT * FROM otp_codes
       WHERE LOWER(email) = $1
         AND otp = $2
         AND used = false
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedEmail, (otp || '').trim()]
    );

    if (otpRecord.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    await client.query(
      'UPDATE otp_codes SET used = true WHERE id = $1',
      [otpRecord.rows[0].id]
    );

    // 2. Mark email verified
    const userUpdateResult = await client.query(
      `UPDATE users 
       SET is_email_verified = true 
       WHERE LOWER(email) = $1
       RETURNING id, full_name, email, role, coin_balance, referral_code, referred_by`,
      [normalizedEmail]
    );

    if (userUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userUpdateResult.rows[0];

    // 3. Process referral reward if user was referred
    if (userData.referred_by) {
      // Check if this referral relationship was already credited
      const existingRef = await client.query(
        `SELECT id FROM referrals WHERE referred_id = $1 LIMIT 1`,
        [userData.id]
      );

      if (existingRef.rows.length === 0) {
        // Record referral entry
        await client.query(
          `INSERT INTO referrals
            (referrer_id, referred_id, coins_awarded, status, created_at)
           VALUES ($1, $2, $3, 'completed', NOW())`,
          [
            userData.referred_by,
            userData.id,
            REFERRAL_REWARD_COINS
          ]
        );

        // Credit referrer wallet & increment referral count
        await client.query(
          `UPDATE users 
           SET coin_balance = COALESCE(coin_balance, 0) + $1,
               referral_count = COALESCE(referral_count, 0) + 1
           WHERE id = $2`,
          [REFERRAL_REWARD_COINS, userData.referred_by]
        );

        // Record referrer's transaction log
        await client.query(
          `INSERT INTO transactions
            (user_id, amount, type, status, metadata, created_at)
           VALUES ($1, $2, 'referral_bonus', 'completed', $3, NOW())`,
          [
            userData.referred_by,
            REFERRAL_REWARD_COINS,
            JSON.stringify({
              referred_user_id: userData.id,
              referred_name: userData.full_name
            })
          ]
        );
      }
    }

    await client.query('COMMIT');

    // 4. Send Welcome email outside transaction
    try {
      await sendWelcome(normalizedEmail, userData.full_name);
    } catch (emailErr) {
      console.error('Welcome email failed:', emailErr.message);
    }

    const token = jwt.sign(
      { id: userData.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
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
    await client.query('ROLLBACK');
    console.error('Verify OTP error:', err);
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  } finally {
    client.release();
  }
};


// =========================================================
// RESEND OTP
// =========================================================

const resendOTP = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  try {
    const user = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (user.rows[0].is_email_verified) {
      return res.status(400).json({
        message: 'Email already verified'
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_codes
        (email, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [normalizedEmail, otp, expiresAt]
    );

    try {
      await sendOTP(normalizedEmail, otp, user.rows[0].full_name);
    } catch (emailErr) {
      console.error('Resend OTP email failed:', emailErr.message);
    }

    return res.json({
      message: 'OTP resent successfully'
    });

  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// LOGIN
// =========================================================

const login = async (req, res) => {
  const { email, password } = req.body;
  const clientIp = getClientIp(req);
  const normalizedEmail = (email || '').toLowerCase().trim();

  // Check if IP is blocked
  const blocked = await pool.query(
    `SELECT * FROM blocked_ips
     WHERE ip_address = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [clientIp]
  );

  if (blocked.rows.length > 0) {
    return res.status(403).json({
      message: 'Too many failed login attempts. Try again later.'
    });
  }

  try {
    const user = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (user.rows.length === 0) {
      await recordFailedAttempt(normalizedEmail, clientIp);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.rows[0].password);

    if (!isMatch) {
      await recordFailedAttempt(normalizedEmail, clientIp);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.rows[0].is_email_verified) {
      return res.status(400).json({
        message: 'Please verify your email first'
      });
    }

    // Record successful login
    try {
      await pool.query(
        `INSERT INTO login_attempts (email, ip_address, success)
         VALUES ($1, $2, true)`,
        [normalizedEmail, clientIp]
      );

      // Track last login IP
      await pool.query(
        `UPDATE users SET last_login_ip = $1, updated_at = NOW() WHERE id = $2`,
        [clientIp, user.rows[0].id]
      );
    } catch (e) {
      console.error(e);
    }

    const token = jwt.sign(
      { id: user.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
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
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};

async function recordFailedAttempt(email, ip) {
  try {
    await pool.query(
      `INSERT INTO login_attempts (email, ip_address, success)
       VALUES ($1, $2, false)`,
      [email, ip]
    );

    const failedAttempts = await pool.query(
      `SELECT COUNT(*)
       FROM login_attempts
       WHERE ip_address = $1
         AND success = false
         AND created_at > NOW() - INTERVAL '1 hour'`,
      [ip]
    );

    if (parseInt(failedAttempts.rows[0]?.count || 0, 10) >= 10) {
      await pool.query(
        `INSERT INTO blocked_ips (ip_address, reason, expires_at)
         VALUES ($1, 'Too many failed login attempts', NOW() + INTERVAL '24 hours')
         ON CONFLICT (ip_address)
         DO UPDATE SET expires_at = NOW() + INTERVAL '24 hours'`,
        [ip]
      );
    }
  } catch (e) {
    console.error('Error logging failed attempt:', e);
  }
}


// =========================================================
// GOOGLE AUTH SUCCESS
// =========================================================

const googleAuthSuccess = async (req, res) => {
  try {
    const token = jwt.sign(
      { id: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.redirect(
      `https://app.rewaiq.com.ng/auth/success?token=${token}`
    );
  } catch (err) {
    res.redirect(
      'https://app.rewaiq.com.ng/auth/error'
    );
  }
};


// =========================================================
// FORGOT & RESET PASSWORD
// =========================================================

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  try {
    const user = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        message: 'Email not found'
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET reset_token = $1,
           reset_token_expires = $2
       WHERE id = $3`,
      [resetToken, expires, user.rows[0].id]
    );

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      `INSERT INTO otp_codes (email, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [normalizedEmail, otp, new Date(Date.now() + 10 * 60 * 1000)]
    );

    try {
      await sendOTP(normalizedEmail, otp, user.rows[0].full_name);
    } catch (emailErr) {
      console.error('Password reset email failed:', emailErr.message);
    }

    return res.json({
      message: 'Password reset OTP sent to your email'
    });

  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};

const resetPassword = async (req, res) => {
  const { email, otp, new_password } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  try {
    const otpRecord = await pool.query(
      `SELECT * FROM otp_codes
       WHERE LOWER(email) = $1
         AND otp = $2
         AND used = false
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedEmail, (otp || '').trim()]
    );

    if (otpRecord.rows.length === 0) {
      return res.status(400).json({
        message: 'Invalid or expired OTP'
      });
    }

    await pool.query(
      'UPDATE otp_codes SET used = true WHERE id = $1',
      [otpRecord.rows[0].id]
    );

    const hashedPassword = await bcrypt.hash(new_password, 10);

    await pool.query(
      `UPDATE users
       SET password = $1,
           reset_token = NULL,
           reset_token_expires = NULL
       WHERE LOWER(email) = $2`,
      [hashedPassword, normalizedEmail]
    );

    return res.json({
      message: 'Password reset successful. Please login.'
    });

  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


module.exports = {
  register,
  verifyOTP,
  resendOTP,
  login,
  googleAuthSuccess,
  forgotPassword,
  resetPassword
};
