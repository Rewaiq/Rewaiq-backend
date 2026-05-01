const express = require('express');
const router = express.Router();
const { initializeCashout, getBanks, verifyAccount } = require('../controllers/paystackController');
const { protect } = require('../middleware/auth');

router.post('/cashout', protect, initializeCashout);
router.get('/banks', protect, getBanks);
router.get('/verify-account', protect, verifyAccount);

module.exports = router;