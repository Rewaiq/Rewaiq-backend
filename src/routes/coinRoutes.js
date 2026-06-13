const express = require('express');
const router = express.Router();
const https = require('https');

const {
  getBalance,
  earnCoins,
  cashout,
  getHistory,
} = require('../controllers/coinController');

const { protect } = require('../middleware/auth');

/**
 * EXISTING ROUTES
 */
router.get('/balance', protect, getBalance);
router.post('/earn', protect, earnCoins);
router.post('/cashout', protect, cashout);
router.get('/history', protect, getHistory);

/**
 * NEW: VERIFY BANK ACCOUNT (Paystack)
 * Used by frontend before cashout submission
 */
router.post('/verify-account', protect, async (req, res) => {
  const { account_number, bank_code } = req.body;

  if (!account_number || !bank_code) {
    return res.status(400).json({
      verified: false,
      message: 'Account number and bank code are required',
    });
  }

  try {
    const result = await new Promise((resolve) => {
      const options = {
        hostname: 'api.paystack.co',
        port: 443,
        path: `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            resolve({ status: false });
          }
        });
      });

      req.on('error', () => {
        resolve({ status: false });
      });

      req.end();
    });

    if (result.status && result.data) {
      return res.json({
        verified: true,
        account_name: result.data.account_name,
        account_number,
        bank_code,
      });
    }

    return res.status(400).json({
      verified: false,
      message: 'Account not found or invalid bank details',
    });
  } catch (err) {
    console.error('Verify account error:', err.message);

    return res.status(500).json({
      verified: false,
      message: 'Verification failed',
    });
  }
});

module.exports = router;
