const pool = require('../config/db');
const https = require('https');

// Helper to make Paystack API requests via https
const paystackRequest = (options, postData = null) => {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ status: false, message: 'Invalid response from Paystack' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ status: false, message: err.message });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

// INITIALIZE CASHOUT (Paystack Transfer Recipient + Atomic DB Update)
const initializeCashout = async (req, res) => {
  const { amount, bank_code, account_number, account_name, bank_name } = req.body;
  const coinsToDeduct = parseInt(amount, 10);
  const userId = req.user.id;

  // 1. Basic validation
  if (!coinsToDeduct || isNaN(coinsToDeduct) || !account_number || !bank_code) {
    return res.status(400).json({
      success: false,
      message: 'Account number, bank code, and amount are required',
    });
  }

  // 2. Enforce 500 coin minimum (500 coins = N250)
  if (coinsToDeduct < 500) {
    return res.status(400).json({
      success: false,
      message: 'Minimum cashout is 500 coins (₦250)',
    });
  }

  const nairaAmount = Math.floor(coinsToDeduct / 2);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 3. Lock user row to prevent race conditions / double spending
    const userResult = await client.query(
      'SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const currentBalance = parseInt(userResult.rows[0].coin_balance || 0, 10);

    if (currentBalance < coinsToDeduct) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Insufficient coin balance. You have ${currentBalance.toLocaleString()} coins.`,
      });
    }

    // 4. Create Transfer Recipient on Paystack
    const recipientPayload = JSON.stringify({
      type: 'nuban',
      name: account_name || 'Verified User',
      account_number,
      bank_code,
      currency: 'NGN',
    });

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/transferrecipient',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    const recipientRes = await paystackRequest(options, recipientPayload);

    // Even if Paystack recipient creation fails, handle cleanly without 500 crashing
    const recipientCode = recipientRes?.status ? recipientRes.data?.recipient_code : null;

    // 5. Deduct coins from user balance
    await client.query(
      'UPDATE users SET coin_balance = coin_balance - $1, updated_at = NOW() WHERE id = $2',
      [coinsToDeduct, userId]
    );

    // 6. Record transaction with complete payout metadata
    const metadata = {
      naira_amount: nairaAmount,
      bank_name: bank_name || '',
      bank_code,
      account_number,
      account_name: account_name || 'Verified User',
      recipient_code: recipientCode,
      requested_at: new Date().toISOString(),
    };

    const transaction = await client.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata, created_at)
       VALUES ($1, $2, 'cashout', 'pending', $3, NOW())
       RETURNING id`,
      [userId, coinsToDeduct, JSON.stringify(metadata)]
    );

    // 7. Add In-App User Notification
    try {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES ($1, 'Cashout Request Submitted', $2, 'info', false, NOW())`,
        [
          userId,
          `Your cashout of ₦${nairaAmount.toLocaleString()} (${coinsToDeduct} coins) has been queued for payout.`,
        ]
      );
    } catch (_) {}

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Cashout request submitted successfully',
      transaction_id: transaction.rows[0].id,
      naira_amount: nairaAmount,
      coins_deducted: coinsToDeduct,
      status: 'pending',
      note: 'Payment will be sent to your bank account within 24 hours',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cashout server error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error processing cashout',
      error: err.message,
    });
  } finally {
    client.release();
  }
};

// GET BANKS LIST
const getBanks = async (req, res) => {
  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: '/bank?country=nigeria&perPage=100',
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  };

  const response = await paystackRequest(options);

  if (response.status && response.data) {
    return res.json({ banks: response.data });
  }

  return res.json({ banks: [] });
};

// VERIFY ACCOUNT NUMBER (Supports both query params and body params)
const verifyAccount = async (req, res) => {
  const account_number = req.query.account_number || req.body.account_number;
  const bank_code = req.query.bank_code || req.body.bank_code;

  if (!account_number || !bank_code) {
    return res.status(400).json({ message: 'Account number and bank code required' });
  }

  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  };

  const response = await paystackRequest(options);

  if (response.status && response.data) {
    return res.json({
      verified: true,
      account_name: response.data.account_name,
      account_number: response.data.account_number,
    });
  }

  return res.status(400).json({
    verified: false,
    message: 'Could not resolve account. Please verify bank code and account number.',
  });
};

module.exports = {
  initializeCashout,
  cashout: initializeCashout, // Alias ensures both route names work
  getBanks,
  verify
