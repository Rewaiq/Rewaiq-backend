const express = require('express');
const router = express.Router();
const {
  getDashboardStats, getAllUsers, getPendingCompletions,
  approveCompletion, rejectCompletion, getPendingCashouts,
  approveCashout, createTask, deactivateTask
} = require('../controllers/adminController');
const { protect } = require('../middleware/auth');

router.get('/stats', protect, getDashboardStats);
router.get('/users', protect, getAllUsers);
router.get('/completions/pending', protect, getPendingCompletions);
router.patch('/completions/:id/approve', protect, approveCompletion);
router.patch('/completions/:id/reject', protect, rejectCompletion);
router.get('/cashouts/pending', protect, getPendingCashouts);
router.patch('/cashouts/:id/approve', protect, approveCashout);
router.post('/tasks/create', protect, createTask);
router.patch('/tasks/:id/deactivate', protect, deactivateTask);

router.patch('/tracks/:id/approve', protect, async (req, res) => {
  try {
    const pool = require('../config/db');
    await pool.query('UPDATE tracks SET is_active = true WHERE id = $1', [req.params.id]);
    res.json({ message: 'Track approved' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
