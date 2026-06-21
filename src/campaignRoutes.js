const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');
const https = require('https');

// Submit brand campaign request
router.post('/submit', async (req, res) => {
  const {
    brand_name, task_title, task_description,
    target_url, contact_email, contact_phone,
    package_id, package_name, price,
    coins_per_completion, reach,
    paystack_reference
  } = req.body;

  try {
    // Verify Paystack payment
    if (paystack_reference) {
      const verified = await new Promise((resolve) => {
        const options = {
          hostname: 'api.paystack.co',
          port: 443,
          path: '/transaction/verify/' + paystack_reference,
          method: 'GET',
          headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY }
        };
        https.request(options, (paystackRes) => {
          let data = '';
          paystackRes.on('data', chunk => data += chunk);
          paystackRes.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({ status: false }); }
          });
        }).on('error', () => resolve({ status: false })).end();
      });

      if (!verified.status || verified.data?.status !== 'success') {
        return res.status(400).json({ message: 'Payment verification failed' });
      }
    }

    // Save campaign request to database
    const campaign = await pool.query(
      `INSERT INTO campaign_requests 
       (brand_name, task_title, task_description, target_url, 
        contact_email, contact_phone, package_id, package_name, 
        price, coins_per_completion, reach, paystack_reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
       RETURNING id`,
      [brand_name, task_title, task_description, target_url,
       contact_email, contact_phone, package_id, package_name,
       price, coins_per_completion, reach, paystack_reference || null]
    );

    // Notify admin
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type)
       SELECT id, 'New Brand Campaign Request', $1, 'info'
       FROM users WHERE role = 'admin' LIMIT 1`,
      [`${brand_name} submitted a campaign request. Package: ${package_name}. Ref: ${paystack_reference || 'WhatsApp'}`]
    );

    res.status(201).json({
      message: 'Campaign request submitted. We will activate within 2 hours.',
      campaign_id: campaign.rows[0].id
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin — get all campaign requests
router.get('/all', protect, async (req, res) => {
  try {
    const campaigns = await pool.query(
      `SELECT * FROM campaign_requests ORDER BY created_at DESC`
    );
    res.json({ campaigns: campaigns.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin — approve campaign (creates task automatically)
router.post('/approve/:id', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await pool.query(
      'SELECT * FROM campaign_requests WHERE id = $1',
      [id]
    );
    if (campaign.rows.length === 0) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    const c = campaign.rows[0];

    // Create task from campaign
    await pool.query(
      `INSERT INTO tasks 
       (title, description, task_type, reward_coins, target_url, is_active, created_by)
       VALUES ($1, $2, 'campaign', $3, $4, true, 
       (SELECT id FROM users WHERE role = 'admin' LIMIT 1))`,
      [c.task_title, c.task_description || `Complete this task for ${c.brand_name}`,
       c.coins_per_completion || 50, c.target_url || '']
    );

    // Update campaign status
    await pool.query(
      `UPDATE campaign_requests SET status = 'approved', approved_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Campaign approved and task created' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin — reject campaign with reason
router.post('/reject/:id', protect, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    await pool.query(
      `UPDATE campaign_requests 
       SET status = 'rejected', rejection_reason = $1, rejected_at = NOW() 
       WHERE id = $2`,
      [reason || 'Does not meet campaign guidelines', id]
    );
    res.json({ message: 'Campaign rejected' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
