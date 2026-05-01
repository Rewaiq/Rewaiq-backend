const express = require('express');
const router = express.Router();
const { getReferralInfo, activateReferral } = require('../controllers/referralController');
const { protect } = require('../middleware/auth');

router.get('/', protect, getReferralInfo);
router.post('/activate', protect, activateReferral);

module.exports = router;