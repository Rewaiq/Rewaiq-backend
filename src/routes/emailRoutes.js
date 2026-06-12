const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const crypto = require('crypto');

// Unsubscribe endpoint
router.get('/unsubscribe', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid link');

  try {
    const result = await pool.query(
      `INSERT INTO email_unsubscribes (email, token)
       SELECT email, token FROM 
       (SELECT $1 as token) t
       JOIN waitlist w ON w.unsubscribe_token = $1
       ON CONFLICT (email) DO NOTHING
       RETURNING email`,
      [token]
    );
    res.send(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0A1628;color:#fff">
        <h2>You have been unsubscribed</h2>
        <p style="color:#8A9BB0">You will no longer receive emails from Rewaiq.</p>
        <a href="https://rewaiq.com.ng" style="color:#4a9eff">Visit Rewaiq</a>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error processing unsubscribe');
  }
});

module.exports = router;
