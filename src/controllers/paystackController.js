const pool = require('../config/db');
const https = require('https');

// Reusable HTTPS helper for Paystack API
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

// CASHOUT CONTROLLER (Atomic transaction + Safe Paystack Recipient fallback)
const cashout = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      amount,
      account_number,
      bank_code,
      bank_name,
      account_name,
    } = req.body;

    const userId = req.user.id;
    const coinsToDeduct = parseInt(amount, 10);

    // 1. Validate Input
    if (!coinsToDeduct || isNaN(coinsToDeduct) || !account_number || !bank_code) {
      return res.status(400).json({
        success: false,
        message: 'Account number, bank code, and amount are required',
      });
    }

    if (coinsToDeduct < 500) {
      return res.status(400).json({
        success: false,
        message: 'Minimum cashout is 500 coins (₦250)',
      });
    }

    await client.query('BEGIN');

    // 2. Lock user row to prevent race conditions / duplicate deductions
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

    // 3. Deduct coins atomically from balance
    await client.query(
      'UPDATE users SET coin_balance = coin_balance - $1, updated_at = NOW() WHERE id = $2',
      [coinsToDeduct, userId]
    );

    const nairaAmount = Math.floor(coinsToDeduct / 2);
    const finalAccountName = account_name || 'Verified User';

    // 4. Register Paystack Recipient in the background (Non-blocking)
    let recipientCode = null;
    if (process.env.PAYSTACK_SECRET_KEY) {
      try {
        const recipientPayload = JSON.stringify({
          type: 'nuban',
          name: finalAccountName,
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
        if (recipientRes && recipientRes.status && recipientRes.data) {
          recipientCode = recipientRes.data.recipient_code;
        }
      } catch (paystackErr) {
        console.error('Paystack recipient creation skipped:', paystackErr.message);
      }
    }

    // 5. Insert Transaction Entry
    const metadata = {
      naira_amount: nairaAmount,
      bank_name: bank_name || '',
      bank_code,
      account_number,
      account_name: finalAccountName,
      recipient_code: recipientCode,
      requested_at: new Date().toISOString(),
    };

    const transaction = await client.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata, created_at)
       VALUES ($1, $2, 'cashout', 'pending', $3, NOW())
       RETURNING id`,
      [userId, coinsToDeduct, JSON.stringify(metadata)]
    );

    // 6. Send In-App Notification to User
    try {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES ($1, 'Cashout Request Submitted', $2, 'info', false, NOW())`,
        [
          userId,
          `Your cashout of ₦${nairaAmount.toLocaleString()} (${coinsToDeduct} coins) has been received and is being processed.`,
        ]
      );
    } catch (_) {}

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Cashout request submitted successfully',
      data: {
        transaction_id: transaction.rows[0].id,
        account_name: finalAccountName,
        naira_amount: nairaAmount,
        coins_deducted: coinsToDeduct,
        status: 'pending',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('🚨 DETAILED CASHOUT ERROR:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error processing cashout',
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

// VERIFY ACCOUNT NUMBER
const verifyAccount = async (req, res) => {
  const account_number = req.query.account_number || req.body?.account_number;
  const bank_code = req.query.bank_code || req.body?.bank_code;

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
  cashout,
  initializeCashout: cashout,
  getBanks,
  verifyAccount,
};
