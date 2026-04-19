const pool = require('../config/db');

// GET USER PROFILE
const getProfile = async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, full_name, email, phone, role, coin_balance, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getProfile };