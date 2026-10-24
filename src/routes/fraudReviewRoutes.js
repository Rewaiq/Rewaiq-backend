const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  scanDuplicatePhones,
  listFraudFlags,
  reviewFraudFlag
} = require('../controllers/fraudReviewController');

router.use(protect, requireAdmin);
router.get('/', listFraudFlags);
router.post('/scan-duplicate-phones', scanDuplicatePhones);
router.patch('/:id/review', reviewFraudFlag);

module.exports = router;
