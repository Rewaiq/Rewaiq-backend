const express = require('express');

const router =
  express.Router();

const {
  startStream,
  heartbeatStream,
  endStream,
  getStreamHistory,
} = require('../controllers/streamController');

const {
  protect,
} = require('../middleware/auth');


/*
 * Start streaming
 */
router.post(
  '/start',
  protect,
  startStream
);


/*
 * Verified heartbeat
 */
router.post(
  '/heartbeat',
  protect,
  heartbeatStream
);


/*
 * Complete/end stream
 */
router.post(
  '/end',
  protect,
  endStream
);


/*
 * Stream history
 */
router.get(
  '/history',
  protect,
  getStreamHistory
);


module.exports =
  router;
