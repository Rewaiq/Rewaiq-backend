const express = require('express');
const router = express.Router();
const {
  createTask,
  getAllTasks,
  getTask,
  completeTask,
  approveTask,
  getMyTasks
} = require('../controllers/taskController');
const { protect } = require('../middleware/auth');

router.post('/create', protect, createTask);
router.get('/', protect, getAllTasks);
router.get('/mine', protect, getMyTasks);
router.get('/:id', protect, getTask);
router.post('/complete', protect, completeTask);
router.patch('/approve/:completion_id', protect, approveTask);

// Get single task
router.get('/:id', protect, async (req, res) => {
  try {
    const pool = require('../config/db');
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
      return res.status(404).json({ message: 'Task not found or inactive' });
    }

    // Check if already submitted
    const existing = await pool.query(
      `SELECT * FROM task_completions 
       WHERE task_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You have already submitted this task' });
    }

    // Create completion
    await pool.query(
      `INSERT INTO task_completions (task_id, user_id, proof_url, status)
       VALUES ($1, $2, $3, 'pending')`,
      [id, req.user.id, proof_url || '']
    );

    res.status(201).json({ message: 'Task submitted for review' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
