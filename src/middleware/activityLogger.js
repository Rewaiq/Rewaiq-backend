const pool = require('../config/db');

const logActivity = async (userId, action, details = {}, ip = null) => {
  try {
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, details, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [userId, action, JSON.stringify(details), ip]
    );
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
};

module.exports = { logActivity };
