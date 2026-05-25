const pool = require('./db');

const notify = async (userId, title, message, type = 'info') => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, $2, $3, $4)`,
      [userId, title, message, type]
    );
  } catch (err) {
    console.error('Notification error:', err.message);
  }
};

module.exports = { notify };
