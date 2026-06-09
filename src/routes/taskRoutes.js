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

module.exports = router;
