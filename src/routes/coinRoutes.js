const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const https = require('https');
const { protect } = require('../middleware/auth');

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

// EARN COINS
router.post('/earn', protect, async (req, res) => {
  const { amount, type = 'task_reward' } = req.body;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const earned = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE user_id = $1 
       AND type IN ('stream_earn', 'task_reward', 'referral_reward')
       AND status = 'completed'
       AND created_at >= $2`,
      [req.user.id, today]
    );

    const todayTotal = parseInt(earned.rows[0].total);
    const DAILY_CAP = 500;

    if (todayTotal >= DAILY_CAP) {
      return res.status(429).json({
        message: `Daily earning limit reached (${DAILY_CAP} coins). Come back tomorrow!`,
        coins_earned_today: todayTotal,
        daily_cap: DAILY_CAP
      });
    }

    const remaining = DAILY_CAP - todayTotal;
    const actualAmount = Math.min(amount, remaining);

    await pool.query(
      'UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2',
      [actualAmount, req.user.id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, $3, 'completed')`,
      [req.user.id, actualAmount, type]
    );

    const newBalance = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );

    res.json({
      message: `Earned ${actualAmount} coins`,
      coins_earned: actualAmount,
      coin_balance: newBalance.rows[0].coin_balance,
      coins_earned_today: todayTotal + actualAmount,
      daily_cap: DAILY_CAP
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// VERIFY BANK ACCOUNT
router.post('/verify-account', protect, async (req, res) => {
  const { account_number, bank_code } = req.body;
  try {
    if (!account_number || !bank_code) {
      return res.status(400).json({ message: 'Account number and bank code required' });
    }

    const result = await new Promise((resolve) => {
      const options = {
        hostname: 'api.paystack.co',
        port: 443,
        path: `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
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

    if (result.status) {
      res.json({
        verified: true,
        account_name: result.data.account_name,
        account_number: result.data.account_number,
      });
    } else {
      res.status(400).json({ verified: false, message: 'Account not found. Check your account number and bank.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Verification failed', error: err.message });
  }
});

// GET BANKS LIST
router.get('/banks', protect, async (req, res) => {
  try {
    const result = await new Promise((resolve) => {
      const options = {
        hostname: 'api.paystack.co',
        port: 443,
        path: '/bank?country=nigeria&perPage=100',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
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

    if (result.status) {
      res.json({ banks: result.data });
    } else {
      // Return hardcoded list as fallback
      res.json({ banks: NIGERIAN_BANKS });
    }
  } catch (err) {
    res.json({ banks: NIGERIAN_BANKS });
  }
});

// CASHOUT REQUEST — MANUAL PROCESSING
router.post('/cashout', protect, async (req, res) => {
  const { amount, bank_code, account_number, account_name, bank_name } = req.body;
  try {
    const user = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    const coinBalance = parseInt(user.rows[0]?.coin_balance || 0);

    const MIN_CASHOUT_COINS = 500;

if (!amount || parseInt(amount) < MIN_CASHOUT_COINS) {
  return res.status(400).json({ message: `Minimum cashout is ${MIN_CASHOUT_COINS} coins` });
}
    if (coinBalance < parseInt(amount)) {
      return res.status(400).json({ message: 'Insufficient coin balance' });
    }
    if (!bank_code || !account_number || !account_name) {
      return res.status(400).json({ message: 'Bank details required' });
    }

    const nairaAmount = Math.floor(parseInt(amount) / 2);

    // Deduct coins
    await pool.query(
      'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
      [parseInt(amount), req.user.id]
    );

    // Record transaction
    const transaction = await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata)
       VALUES ($1, $2, 'cashout', 'pending', $3) RETURNING id`,
      [req.user.id, parseInt(amount), JSON.stringify({
        naira_amount: nairaAmount,
        bank_name: bank_name || '',
        bank_code,
        account_number,
        account_name,
      })]
    );

    // Notify admin
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         SELECT id, 'New Cashout Request', $1, 'info'
         FROM users WHERE role = 'admin' LIMIT 1`,
        [`${account_name} requests N${nairaAmount.toLocaleString()} — ${bank_name} — ${account_number}`]
      );
    } catch (e) {}

    // Notify user
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES ($1, 'Cashout Request Received', $2, 'info')`,
        [req.user.id, `Your cashout of N${nairaAmount.toLocaleString()} NGN is being processed. You will receive payment within 24 hours.`]
      );
    } catch (e) {}

    res.json({
      message: 'Cashout request submitted successfully',
      transaction_id: transaction.rows[0].id,
      naira_amount: nairaAmount,
      coins_deducted: parseInt(amount),
      status: 'pending',
      note: 'Payment will be sent to your bank within 24 hours'
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
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
        COALESCE(SUM(CASE WHEN type IN ('stream_earn','task_reward','referral_reward') AND status='completed' THEN amount ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN type='cashout' THEN amount ELSE 0 END), 0) as total_cashed_out,
        COUNT(CASE WHEN type='stream_earn' THEN 1 END) as total_streams
       FROM transactions WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      transactions: transactions.rows,
      stats: stats.rows[0]
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Nigerian banks fallback list
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
