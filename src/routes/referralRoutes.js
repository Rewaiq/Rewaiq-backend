const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as total_referrals 
       FROM referrals WHERE referrer_id = $1`,
      [req.user.id]
    );
    const user = await pool.query(
      'SELECT referral_code FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({
      total_referrals: parseInt(result.rows[0].total_referrals),
      referral_code: user.rows[0]?.referral_code,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
