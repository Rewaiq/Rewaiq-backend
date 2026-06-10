const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');
const {
  createTask, getAllTasks, getMyTasks
} = require('../controllers/taskController');

// Create task (admin)
router.post('/create', protect, createTask);

// Get all tasks
router.get('/', protect, getAllTasks);

// Get my completed tasks
router.get('/mine', protect, getMyTasks);

// Get single task — must be before /:id/complete
router.get('/:id', protect, async (req, res) => {
  try {
    const task = await pool.query(
      `SELECT t.*,
        CASE WHEN tc.user_id IS NOT NULL THEN true ELSE false END as completed
       FROM tasks t
       LEFT JOIN task_completions tc
         ON t.id = tc.task_id AND tc.user_id = $1 AND tc.status = 'approved'
       WHERE t.id = $2`,
      [req.user.id, req.params.id]
    );
    if (task.rows.length === 0) return res.status(404).json({ message: 'Task not found' });
    res.json({ task: task.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Complete task with proof
router.post('/:id/complete', protect, async (req, res) => {
  const { id } = req.params;
  const { proof_url } = req.body;
  try {
    // Check task exists and is active
    const task = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND is_active = true',
      [id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found or not active' });
    }

    // Check if already submitted
    const existing = await pool.query(
      `SELECT * FROM task_completions WHERE task_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You have already submitted this task' });
    }

    // Insert completion
    await pool.query(
      `INSERT INTO task_completions (task_id, user_id, proof_url, status, completed_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [id, req.user.id, proof_url || '']
    );

    // Notify admin
    try {
      const user = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         SELECT id, 'New Task Submission', $1, 'info'
         FROM users WHERE role = 'admin' LIMIT 1`,
        [`${user.rows[0]?.full_name} submitted proof for task ID ${id}`]
      );
    } catch (e) {}

    res.status(201).json({ message: 'Task submitted for review successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
