const express = require('express');
const router = express.Router();
const { cashout, getBanks, verifyAccount } = require('../controllers/paystackController');
const { protect } = require('../middleware/auth');

// Support both endpoint patterns used by frontend modals
router.post('/cashout', protect, cashout);
router.get('/banks', protect, getBanks);
router.get('/verify-account', protect, verifyAccount);
router.post('/verify-account', protect, verifyAccount);

module.exports = router;
