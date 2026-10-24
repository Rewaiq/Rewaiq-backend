const pool = require('../config/db');

// Use the database role rather than trusting a role claim supplied by a client.
const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!result.rows.length || result.rows[0].role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    next();
  } catch (err) {
    console.error('Admin role check failed:', err.message);
    res.status(500).json({ message: 'Unable to verify admin access' });
  }
};
module.exports = requireAdmin;
