const express = require('express');
const router = express.Router();
const { getBalance, earnCoins, cashout, getHistory } = require('../controllers/coinController');
const { protect } = require('../middleware/auth');

router.get('/balance', protect, getBalance);
router.post('/earn', protect, earnCoins);
router.post('/cashout', protect, cashout);
router.get('/history', protect, getHistory);

module.exports = router;
