const express = require('express');
const router = express.Router();
const { getTasksFeed, getContentFeed } = require('../controllers/feedController');
const { protect } = require('../middleware/auth');

router.get('/tasks', protect, getTasksFeed);
router.get('/content', protect, getContentFeed);

module.exports = router;