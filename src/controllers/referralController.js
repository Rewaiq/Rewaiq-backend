const pool = require('../config/db');

// GET MY REFERRAL INFO
const getReferralInfo = async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT referral_code, coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );

    const referrals = await pool.query(
      `SELECT r.*, u.full_name as referred_name, u.created_at as joined_at
       FROM referrals r JOIN users u ON r.referred_id = u.id
       WHERE r.referrer_id = $1`,
      [req.user.id]
    );

    res.json({
      referral_code: user.rows[0].referral_code,
      referral_link: `https://app.rewaiq.com.ng/signup?ref=${user.rows[0].referral_code}`,
      total_referrals: referrals.rows.length,
      referrals: referrals.rows
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ACTIVATE REFERRAL (when referred user completes first stream)
const activateReferral = async (req, res) => {
  try {
    const referral = await pool.query(
      `SELECT * FROM referrals WHERE referred_id = $1 AND status = 'pending'`,
      [req.user.id]
    );

    if (referral.rows.length === 0) return res.json({ message: 'No pending referral' });

    const { id, referrer_id, coins_awarded } = referral.rows[0];

    // Award coins to referrer
    await pool.query(
      'UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2',
      [coins_awarded, referrer_id]
    );

    // Update referral status
    await pool.query('UPDATE referrals SET status = $1 WHERE id = $2', ['completed', id]);

    // Record transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status) VALUES ($1, $2, 'referral_reward', 'completed')`,
      [referrer_id, coins_awarded]
    );

    res.json({ message: 'Referral activated', coins_awarded });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getReferralInfo, activateReferral };