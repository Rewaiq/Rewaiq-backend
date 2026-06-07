const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');
const https = require('https');

// Activate campaign after payment
router.post('/activate-campaign', protect, async (req, res) => {
  const { reference, track_id, coins, streams, coins_per_stream } = req.body;
  try {
    // Verify payment with Paystack
    const verified = await new Promise((resolve) => {
      const options = {
        hostname: 'api.paystack.co',
        port: 443,
        path: `/transaction/verify/${reference}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      };
      https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ status: false }); } });
      }).on('error', () => resolve({ status: false })).end();
    });

    if (!verified.status || verified.data?.status !== 'success') {
      return res.status(400).json({ message: 'Payment verification failed' });
    }

    // Activate track and update campaign settings
    if (track_id) {
      await pool.query(
        `UPDATE tracks SET is_active = true, campaign_coins = $1, target_streams = $2 WHERE id = $3 AND artist_id = $4`,
        [coins_per_stream, streams, track_id, req.user.id]
      );
    }

    // Record payment transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata)
       VALUES ($1, $2, 'campaign_payment', 'completed', $3)`,
      [req.user.id, coins, JSON.stringify({ reference, track_id, streams, coins_per_stream })]
    );

    // Notify admin
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type)
       SELECT id, 'New Campaign Payment', $1, 'success'
       FROM users WHERE role = 'admin' LIMIT 1`,
      [`Artist paid for campaign — Ref: ${reference}, Track ID: ${track_id}`]
    );

    res.json({ message: 'Campaign activated successfully', verified: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
