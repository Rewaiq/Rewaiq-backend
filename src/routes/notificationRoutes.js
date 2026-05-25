const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/read', protect, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/read/all', protect, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
