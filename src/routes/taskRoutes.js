const express = require('express');
const router = express.Router();

const {
  getAllTasks,
  getTask,
  completeTask,
  createTask,
  approveTask,
  getMyTasks
} = require('../controllers/taskController');

const { protect } = require('../middleware/auth');

// =========================================================
// SPECIFIC & COLLECTION ROUTES (MUST BE BEFORE /:id)
// =========================================================

// Get all active tasks
router.get('/', protect, getAllTasks);

// Get current user's completed/pending tasks
router.get('/my-tasks', protect, getMyTasks);

// Create task (Admin)
router.post('/create', protect, createTask);

// Format 1: POST /api/tasks/complete (task_id in body)
router.post('/complete', protect, completeTask);


// =========================================================
// PARAMETERIZED ROUTES (/:id)
// =========================================================

// Format 2: POST /api/tasks/:id/complete (task_id in URL params)
router.post('/:id/complete', protect, (req, res, next) => {
  if (!req.body.task_id) {
    req.body.task_id = req.params.id;
  }
  return completeTask(req, res, next);
});

// Admin approval: PUT /api/tasks/:completion_id/approve
router.put('/:completion_id/approve', protect, approveTask);

// Single task fetch
router.get('/:id', protect, getTask);

module.exports = router;
