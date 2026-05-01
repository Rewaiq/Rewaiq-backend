const pool = require('../config/db');
const https = require('https');

// INITIALIZE CASHOUT (Paystack)
const initializeCashout = async (req, res) => {
  const { amount, bank_code, account_number, account_name } = req.body;

  try {
    // Check user balance
    const user = await pool.query('SELECT coin_balance FROM users WHERE id = $1', [req.user.id]);
    const coinBalance = user.rows[0].coin_balance;

    // Convert coins to naira (2 coins = ₦1)
    const nairaAmount = Math.floor(coinBalance / 2);

    if (coinBalance < amount) {
      return res.status(400).json({ message: 'Insufficient coin balance' });
    }

    if (nairaAmount < 500) {
      return res.status(400).json({ message: 'Minimum cashout is 1000 coins (₦500)' });
    }

    // Create transfer recipient on Paystack
    const recipientData = JSON.stringify({
      type: "nuban",
      name: account_name,
      account_number,
      bank_code,
      currency: "NGN"
    });

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/transferrecipient',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const recipientReq = https.request(options, (recipientRes) => {
      let data = '';
      recipientRes.on('data', chunk => data += chunk);
      recipientRes.on('end', async () => {
        const recipient = JSON.parse(data);
        if (!recipient.status) {
          return res.status(400).json({ message: 'Failed to create transfer recipient' });
        }

        // Deduct coins
        await pool.query(
          'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
          [amount, req.user.id]
        );

        // Record transaction
        const transaction = await pool.query(
          `INSERT INTO transactions (user_id, amount, type, status)
           VALUES ($1, $2, 'cashout', 'pending') RETURNING id`,
          [req.user.id, amount]
        );

        res.json({
          message: 'Cashout request submitted',
          transaction_id: transaction.rows[0].id,
          naira_amount: nairaAmount,
          coins_deducted: amount,
          status: 'pending'
        });
      });
    });

    recipientReq.write(recipientData);
    recipientReq.end();

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET BANKS LIST
const getBanks = async (req, res) => {
  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: '/bank?currency=NGN',
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
  };

  https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => res.json(JSON.parse(data)));
  }).end();
};

// VERIFY ACCOUNT NUMBER
const verifyAccount = async (req, res) => {
  const { account_number, bank_code } = req.query;
  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
  };

  https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => res.json(JSON.parse(data)));
  }).end();
};

module.exports = { initializeCashout, getBanks, verifyAccount };