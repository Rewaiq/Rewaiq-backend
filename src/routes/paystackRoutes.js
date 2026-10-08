const express = require('express');
const router = express.Router();
const { getBanks, verifyAccount } = require('../controllers/paystackController');
const { protect } = require('../middleware/auth');

router.get('/banks', protect, getBanks);
router.get('/verify-account', protect, verifyAccount);

module.exports = router;
