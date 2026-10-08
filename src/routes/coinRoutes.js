const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');
const { cashout, getBanks, verifyAccount } = require('../controllers/paystackController');

// GET BALANCE
router.get('/balance', protect, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ coin_balance: result.rows[0]?.coin_balance || 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CASHOUT (Shares same secure controller as paystackRoutes)
router.post('/cashout', protect, cashout);
router.get('/banks', protect, getBanks);
router.get('/verify-account', protect, verifyAccount);
router.post('/verify-account', protect, verifyAccount);

// GET TRANSACTION HISTORY
router.get('/history', protect, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const transactions = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const stats = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type IN ('stream_earn','task_reward','referral_bonus','welcome_bonus') AND status='completed' THEN amount ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN type='cashout' THEN amount ELSE 0 END), 0) as total_cashed_out,
        COUNT(CASE WHEN type='stream_earn' THEN 1 END) as total_streams
       FROM transactions WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      transactions: transactions.rows,
      stats: stats.rows[0],
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
