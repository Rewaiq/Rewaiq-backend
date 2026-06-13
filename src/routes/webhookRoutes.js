const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Paystack Webhook
 * MUST use raw body for signature verification
 */
router.post(
  '/paystack',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // 1. Validate signature
      const secret =
        process.env.PAYSTACK_WEBHOOK_SECRET ||
        process.env.PAYSTACK_SECRET_KEY;

      const hash = crypto
        .createHmac('sha512', secret)
        .update(req.body)
        .digest('hex');

      if (hash !== req.headers['x-paystack-signature']) {
        return res.status(401).send('Invalid signature');
      }

      // 2. Parse event safely
      let event;
      try {
        event = JSON.parse(req.body.toString());
      } catch (err) {
        console.error('Invalid JSON from Paystack');
        return res.status(400).send('Bad Request');
      }

      // 3. Only handle successful charges
      if (event.event !== 'charge.success') {
        return res.sendStatus(200);
      }

      const { reference, metadata, amount } = event.data;

      if (!reference) return res.sendStatus(200);

      /**
       * 4. Prevent duplicate processing (VERY IMPORTANT)
       */
      const existing = await pool.query(
        `SELECT id FROM transactions WHERE metadata->>'reference' = $1 LIMIT 1`,
        [reference]
      );

      if (existing.rows.length > 0) {
        return res.sendStatus(200);
      }

      /**
       * 5. Process different payment types
       */
      if (metadata?.type === 'artist_campaign' && metadata?.track_id) {
        // Activate campaign
        await pool.query(
          `UPDATE tracks 
           SET is_active = true,
               campaign_coins = $1,
               target_streams = $2
           WHERE id = $3`,
          [
            metadata.coins_per_stream || 10,
            metadata.streams || 500,
            metadata.track_id,
          ]
        );

        // Save transaction
        await pool.query(
          `INSERT INTO transactions
           (user_id, amount, type, status, metadata)
           VALUES ($1, $2, 'campaign_payment', 'completed', $3)`,
          [
            metadata.user_id || null,
            amount / 100,
            JSON.stringify({ ...metadata, reference }),
          ]
        );

        // Notify user (safe fallback if user_id missing)
        if (metadata.user_id) {
          await pool.query(
            `INSERT INTO notifications (user_id, title, message, type)
             VALUES ($1, $2, $3, 'success')`,
            [
              metadata.user_id,
              'Campaign Activated 🚀',
              'Your campaign is now live on Rewaiq!',
            ]
          );
        }

      } else if (metadata?.type === 'brand_campaign') {
        await pool.query(
          `INSERT INTO transactions
           (user_id, amount, type, status, metadata)
           VALUES ($1, $2, 'brand_payment', 'completed', $3)`,
          [
            metadata.user_id || 1,
            amount / 100,
            JSON.stringify({ ...metadata, reference }),
          ]
        );

        // Notify admin safely
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type)
           SELECT id, $1, $2, 'success'
           FROM users 
           WHERE role = 'admin'
           LIMIT 1`,
          [
            'Brand Payment Received 💰',
            `Brand campaign payment: ₦${amount / 100}. Ref: ${reference}`,
          ]
        );
      }

      return res.sendStatus(200);
    } catch (err) {
      console.error('Webhook error:', err.message);
      // ALWAYS return 200 to prevent Paystack retries flooding your server
      return res.sendStatus(200);
    }
  }
);

module.exports = router;
