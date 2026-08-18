const express = require('express');

const router =
  express.Router();

const {
  startStream,
  heartbeatStream,
  endStream,
  getStreamHistory
} = require('../controllers/streamController');

const {
  protect
} = require('../middleware/auth');


// ============================================================
// STREAM ROUTES
// ============================================================


// ------------------------------------------------------------
// Start stream
// ------------------------------------------------------------

router.post(
  '/start',
  protect,
  startStream
);


// ------------------------------------------------------------
// Heartbeat
// ------------------------------------------------------------

router.post(
  '/heartbeat',
  protect,
  heartbeatStream
);


// ------------------------------------------------------------
// End stream
// ------------------------------------------------------------

router.post(
  '/end',
  protect,
  endStream
);


// ------------------------------------------------------------
// History
// ------------------------------------------------------------

router.get(
  '/history',
  protect,
  getStreamHistory
);


module.exports = router;
