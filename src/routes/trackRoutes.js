const express = require('express');
const router = express.Router();
const { uploadTrack, getAllTracks, getMyTracks, deleteTrack } = require('../controllers/trackController');
const { protect } = require('../middleware/auth');

router.post('/upload', protect, uploadTrack);
router.get('/', protect, getAllTracks);
router.get('/mine', protect, getMyTracks);
router.delete('/:id', protect, deleteTrack);

router.get('/mine', protect, async (req, res) => {
  try {
    const pool = require('../config/db');
    const tracks = await pool.query(
      `SELECT * FROM tracks WHERE artist_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ tracks: tracks.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
