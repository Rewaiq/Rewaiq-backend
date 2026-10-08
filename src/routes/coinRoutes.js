const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const https = require('https');
const { protect } = require('../middleware/auth');
const { logActivity, sendNotification } = require('../middleware/activityLogger');

const MIN_CASHOUT_COINS = 500; // 500 coins = N250
const COIN_RATE = 2; // 2 coins = N1

// Utility: Verify Bank Account via Paystack
const resolveBankAccount = (accountNumber, bankCode) => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ status: false });
        }
      });
    });

    req.on('error', () => resolve({ status: false }));
    req.end();
  });
};

// GET BALANCE
router.get('/balance', protect, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ coin_balance: result.rows[0]?.coin_balance || 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET BANKS LIST (Paystack with Fallback)
router.get('/banks', protect, async (req, res) => {
  try {
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/bank?country=nigeria&perPage=100',
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    };

    const result = await new Promise((resolve) => {
      https.request(options, (paystackRes) => {
        let data = '';
        paystackRes.on('data', (chunk) => (data += chunk));
        paystackRes.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ status: false });
          }
        });
      }).on('error', () => resolve({ status: false })).end();
    });

    if (result.status && result.data) {
      return res.json({ banks: result.data });
    }
    return res.json({ banks: NIGERIAN_BANKS });
  } catch (err) {
    return res.json({ banks: NIGERIAN_BANKS });
  }
});

// VERIFY ACCOUNT NUMBER DIRECTLY
router.post('/verify-account', protect, async (req, res) => {
  const { account_number, bank_code } = req.body;
  if (!account_number || !bank_code) {
    return res.status(400).json({ message: 'Account number and bank code required' });
  }

  try {
    const paystackRes = await resolveBankAccount(account_number, bank_code);

    if (paystackRes.status && paystackRes.data) {
      return res.json({
        verified: true,
        account_name: paystackRes.data.account_name,
        account_number: paystackRes.data.account_number,
      });
    }

    return res.status(400).json({
      verified: false,
      message: 'Account not found. Verify your account number and selected bank.',
    });
  } catch (err) {
    return res.status(500).json({ message: 'Verification failed', error: err.message });
  }
});

// SECURE ATOMIC CASHOUT
router.post('/cashout', protect, async (req, res) => {
  const { amount, bank_code, account_number, account_name, bank_name } = req.body;
  const coinsToDeduct = parseInt(amount, 10);

  // 1. Minimum check
  if (!coinsToDeduct || isNaN(coinsToDeduct) || coinsToDeduct < MIN_CASHOUT_COINS) {
    return res.status(400).json({
      message: `Minimum cashout is ${MIN_CASHOUT_COINS} coins (₦${MIN_CASHOUT_COINS / COIN_RATE})`,
    });
  }

  if (!bank_code || !account_number || !account_name) {
    return res.status(400).json({ message: 'Complete bank account details are required' });
  }

  const nairaAmount = Math.floor(coinsToDeduct / COIN_RATE);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Lock user row to eliminate double-spend race conditions
    const userResult = await client.query(
      'SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const currentBalance = parseInt(userResult.rows[0].coin_balance || 0, 10);

    if (currentBalance < coinsToDeduct) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Insufficient coin balance. You have ${currentBalance.toLocaleString()} coins.`,
      });
    }

    // 3. Deduct coins atomically
    await client.query(
      'UPDATE users SET coin_balance = coin_balance - $1, updated_at = NOW() WHERE id = $2',
      [coinsToDeduct, req.user.id]
    );

    // 4. Record ledger transaction
    const metadata = {
      naira_amount: nairaAmount,
      bank_name: bank_name || '',
      bank_code,
      account_number,
      account_name,
      requested_at: new Date().toISOString(),
    };

    const transaction = await client.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata, created_at)
       VALUES ($1, $2, 'cashout', 'pending', $3, NOW())
       RETURNING id`,
      [req.user.id, coinsToDeduct, JSON.stringify(metadata)]
    );

    // 5. User In-App Notification
    await client.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
       VALUES ($1, 'Cashout Request Submitted', $2, 'info', false, NOW())`,
      [
        req.user.id,
        `Your withdrawal of ₦${nairaAmount.toLocaleString()} (${coinsToDeduct} coins) is being processed. Dispatches complete within 24 hours.`,
      ]
    );

    await client.query('COMMIT');

    // 6. Security & Audit log
    if (logActivity) {
      logActivity(req.user.id, 'cashout_requested', {
        transaction_id: transaction.rows[0].id,
        naira: nairaAmount,
        coins: coinsToDeduct,
      });
    }

    return res.json({
      success: true,
      message: 'Cashout request submitted successfully',
      transaction_id: transaction.rows[0].id,
      naira_amount: nairaAmount,
      coins_deducted: coinsToDeduct,
      status: 'pending',
      note: 'Payment will be sent to your bank within 24 hours',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cashout transaction failed:', err);
    return res.status(500).json({ message: 'Server error processing cashout', error: err.message });
  } finally {
    client.release();
  }
});

// GET TRANSACTION HISTORY
router.get('/history', protect, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const transactions = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const stats = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type IN ('stream_earn','task_reward','referral_reward','welcome_bonus') AND status='completed' THEN amount ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN type='cashout' THEN amount ELSE 0 END), 0) as total_cashed_out,
        COUNT(CASE WHEN type='stream_earn' THEN 1 END) as total_streams
       FROM transactions WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      transactions: transactions.rows,
      stats: stats.rows[0],
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

const NIGERIAN_BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank', code: '011' },
  { name: 'First City Monument Bank', code: '214' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Heritage Bank', code: '030' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Moniepoint', code: '50515' },
  { name: 'Opay', code: '999992' },
  { name: 'Palmpay', code: '999991' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Union Bank', code: '032' },
  { name: 'United Bank for Africa', code: '033' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
  { name: 'Kuda Bank', code: '090267' },
  { name: 'Carbon', code: '565' },
];

module.exports = router;
