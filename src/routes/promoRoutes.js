const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');

// Redeem promo code
router.post('/redeem', protect, async (req, res) => {
  const { code } = req.body;
  try {
    // Find promo
    const promo = await pool.query(
      `SELECT * FROM promo_codes WHERE code = $1 AND is_active = true`,
      [code.toUpperCase()]
    );

    if (promo.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired promo code' });
    }

    const p = promo.rows[0];

    // Check if already redeemed by this user
    const existing = await pool.query(
      `SELECT * FROM promo_redemptions WHERE user_id = $1 AND promo_code_id = $2`,
      [req.user.id, p.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You have already used this promo code' });
    }

    // Check max uses
    if (p.used_count >= p.max_uses) {
      return res.status(400).json({ message: 'This promo code has reached its limit' });
    }

    const expiresAt = new Date(Date.now() + p.duration_days * 24 * 60 * 60 * 1000);

    // Create redemption
    await pool.query(
      `INSERT INTO promo_redemptions (user_id, promo_code_id, expires_at, free_streams_remaining)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, p.id, expiresAt, p.free_streams]
    );

    // Update used count
    await pool.query(
      `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1`,
      [p.id]
    );

    res.json({
      message: 'Promo code activated',
      free_streams: p.free_streams,
      duration_days: p.duration_days,
      expires_at: expiresAt,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Check promo status
router.get('/status', protect, async (req, res) => {
  try {
    const redemption = await pool.query(
      `SELECT pr.*, pc.code, pc.free_streams 
       FROM promo_redemptions pr 
       JOIN promo_codes pc ON pr.promo_code_id = pc.id
       WHERE pr.user_id = $1 AND pr.expires_at > NOW() AND pr.free_streams_remaining > 0
       ORDER BY pr.redeemed_at DESC LIMIT 1`,
      [req.user.id]
    );

    if (redemption.rows.length === 0) {
      return res.json({ has_promo: false });
    }

    res.json({
      has_promo: true,
      free_streams_remaining: redemption.rows[0].free_streams_remaining,
      expires_at: redemption.rows[0].expires_at,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
