const express = require('express');

const router = express.Router();

const {
  uploadTrack,
  getAllTracks,
  getTrackById,
  getMyTracks,
  deleteTrack
} = require('../controllers/trackController');

const {
  protect
} = require('../middleware/auth');


// =========================================================
// TRACK ROUTES
// =========================================================

// Upload a track
router.post(
  '/upload',
  protect,
  uploadTrack
);


// Get all active tracks
router.get(
  '/',
  protect,
  getAllTracks
);


// Get artist's own tracks
router.get(
  '/mine',
  protect,
  getMyTracks
);


// Get ONE specific track
//
// IMPORTANT:
// This must come before DELETE /:id
// and gives the Stream page:
//
// GET /api/tracks/:id
//
router.get(
  '/:id',
  protect,
  getTrackById
);


// Delete/deactivate a track
router.delete(
  '/:id',
  protect,
  deleteTrack
);


module.exports = router;
