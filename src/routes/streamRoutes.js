const express = require('express');
const router = express.Router();
const { startStream, endStream, getStreamHistory } = require('../controllers/streamController');
const { protect } = require('../middleware/auth');

router.post('/start', protect, startStream);
router.post('/end', protect, endStream);
router.get('/history', protect, getStreamHistory);

module.exports = router;