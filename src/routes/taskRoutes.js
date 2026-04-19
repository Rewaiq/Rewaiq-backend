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

module.exports = router;