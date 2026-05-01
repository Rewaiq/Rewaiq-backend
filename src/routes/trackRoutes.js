const express = require('express');
const router = express.Router();
const { uploadTrack, getAllTracks, getMyTracks, deleteTrack } = require('../controllers/trackController');
const { protect } = require('../middleware/auth');

router.post('/upload', protect, uploadTrack);
router.get('/', protect, getAllTracks);
router.get('/mine', protect, getMyTracks);
router.delete('/:id', protect, deleteTrack);

module.exports = router;