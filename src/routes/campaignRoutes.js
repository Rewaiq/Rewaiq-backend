const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/auth');
const https = require('https');

router.post('/submit', async (req, res) => {
  const {
    brand_name, task_title, task_description,
    target_url, contact_email, contact_phone,
    package_id, package_name, price,
    coins_per_completion, reach, paystack_reference
  } = req.body;

  try {
    const campaign = await pool.query(
      `INSERT INTO campaign_requests 
       (brand_name, task_title, task_description, target_url, 
        contact_email, contact_phone, package_id, package_name, 
        price, coins_per_completion, reach, paystack_reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
       RETURNING id`,
      [brand_name, task_title, task_description || '', target_url || '',
       contact_email, contact_phone || '', package_id || '', package_name || '',
       price || 0, coins_per_completion || 50, reach || '', paystack_reference || '']
    );

    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         SELECT id, 'New Brand Campaign', $1, 'info'
         FROM users WHERE role = 'admin' LIMIT 1`,
        [brand_name + ' submitted a campaign — ' + (package_name || '') + ' — Ref: ' + (paystack_reference || 'WhatsApp')]
      );
    } catch (e) {}

    res.status(201).json({ message: 'Campaign submitted successfully', campaign_id: campaign.rows[0].id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/all', protect, async (req, res) => {
  try {
    const campaigns = await pool.query(
      'SELECT * FROM campaign_requests ORDER BY created_at DESC'
    );
    res.json({ campaigns: campaigns.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/approve/:id', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM campaign_requests WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const c = result.rows[0];

    await pool.query(
      `INSERT INTO tasks (title, description, task_type, reward_coins, target_url, is_active)
       VALUES ($1, $2, 'campaign', $3, $4, true)`,
      [c.task_title, c.task_description || 'Complete this brand task', c.coins_per_completion || 50, c.target_url || '']
    );

    await pool.query(
      `UPDATE campaign_requests SET status = 'approved', approved_at = NOW() WHERE id = $1`, [id]
    );

    res.json({ message: 'Approved and task created' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/reject/:id', protect, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    await pool.query(
      `UPDATE campaign_requests SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
      [reason || 'Does not meet guidelines', id]
    );
    res.json({ message: 'Rejected' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
