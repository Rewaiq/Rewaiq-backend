const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');

router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body);

  if (event.event === 'charge.success') {
    const { reference, metadata, amount } = event.data;
    
    try {
      if (metadata?.type === 'artist_campaign' && metadata?.track_id) {
        await pool.query(
          `UPDATE tracks SET is_active = true, 
           campaign_coins = $1, target_streams = $2 
           WHERE id = $3`,
          [metadata.coins_per_stream || 10, metadata.streams || 500, metadata.track_id]
        );
        
        // Notify artist
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type)
           VALUES ($1, 'Campaign Activated', 'Your campaign is now live on Rewaiq!', 'success')`,
          [metadata.user_id]
        );
      }
    } catch (err) {
      console.error('Webhook processing error:', err.message);
    }
  }

  res.sendStatus(200);
});

module.exports = router;
