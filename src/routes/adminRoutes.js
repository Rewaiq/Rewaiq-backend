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

// Approve track
router.patch('/tracks/:id/approve', protect, async (req, res) => {
  try {
    const pool = require('../config/db');
    const { notify } = require('../config/notifications');
    
    // Get track with artist info
    const track = await pool.query(
      `SELECT t.*, u.id as artist_user_id 
       FROM tracks t JOIN users u ON t.artist_id = u.id 
       WHERE t.id = $1`, [req.params.id]
    );
    
    // Approve track
    await pool.query('UPDATE tracks SET is_active = true WHERE id = $1', [req.params.id]);
    
    // Notify artist
    if (track.rows[0]) {
      await notify(
        track.rows[0].artist_user_id,
        'Track Approved',
        `Your track "${track.rows[0].title}" is now live on the Stream Feed. Users are streaming it and earning coins.`,
        'success'
      );
    }
    
    res.json({ message: 'Track approved and artist notified' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Pause campaign
router.patch('/tracks/:id/pause', protect, async (req, res) => {
  try {
    const pool = require('../config/db');
    const { notify } = require('../config/notifications');
    
    const track = await pool.query(
      `SELECT t.*, u.id as artist_user_id 
       FROM tracks t JOIN users u ON t.artist_id = u.id 
       WHERE t.id = $1`, [req.params.id]
    );
    
    await pool.query('UPDATE tracks SET is_active = false WHERE id = $1', [req.params.id]);
    
    if (track.rows[0]) {
      await notify(
        track.rows[0].artist_user_id,
        'Campaign Paused',
        `Your campaign for "${track.rows[0].title}" has been paused. Contact info@rewaiq.com.ng for more information.`,
        'info'
      );
    }
    
    res.json({ message: 'Campaign paused' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Resume campaign
router.patch('/tracks/:id/resume', protect, async (req, res) => {
  try {
    const pool = require('../config/db');
    await pool.query('UPDATE tracks SET is_active = true WHERE id = $1', [req.params.id]);
    res.json({ message: 'Campaign resumed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
module.exports = router;
