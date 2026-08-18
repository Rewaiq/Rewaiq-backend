const express = require('express');

const router = express.Router();

const {
  startStream,
  heartbeatStream,
  endStream,
  getStreamHistory
} = require('../controllers/streamController');

const {
  protect
} = require('../middleware/auth');


// =========================================================
// STREAM ROUTES
// =========================================================


// Start streaming session
router.post(
  '/start',
  protect,
  startStream
);


// Streaming heartbeat
router.post(
  '/heartbeat',
  protect,
  heartbeatStream
);


// End streaming session
router.post(
  '/end',
  protect,
  endStream
);


// Stream history
router.get(
  '/history',
  protect,
  getStreamHistory
);


module.exports = router;
