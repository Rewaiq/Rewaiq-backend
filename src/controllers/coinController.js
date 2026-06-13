const pool = require('../config/db');
const https = require('https');

// GET BALANCE
const getBalance = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ coin_balance: result.rows[0]?.coin_balance || 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// EARN COINS
const earnCoins = async (req, res) => {
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
};

// CASHOUT REQUEST
const cashout = async (req, res) => {
  const { amount, bank_code, account_number, account_name, bank_name } = req.body;

  try {
    const user = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );

    const coinBalance = Number(user.rows[0]?.coin_balance || 0);

    if (!amount || amount < 200) {
  return res.status(400).json({ message: 'Minimum cashout is 200 coins (N100)' });
}

    if (coinBalance < amount) {
      return res.status(400).json({
        message: 'Insufficient coin balance'
      });
    }

    if (!bank_code || !account_number || !account_name) {
      return res.status(400).json({
        message: 'Bank details required'
      });
    }

    const naira = Math.floor(amount / 2);
    const nairaAmountKobo = naira * 100;

    // Step 1 — Create recipient
    const recipientRes = await paystackRequest('POST', '/transferrecipient', {
      type: 'nuban',
      name: account_name,
      account_number,
      bank_code,
      currency: 'NGN'
    });

    if (!recipientRes.status) {
      return await manualCashout(
        req,
        res,
        amount,
        bank_code,
        account_number,
        account_name,
        bank_name
      );
    }

    const recipientCode = recipientRes.data.recipient_code;

    // Step 2 — Transfer
    const transferRes = await paystackRequest('POST', '/transfer', {
      source: 'balance',
      amount: nairaAmountKobo,
      recipient: recipientCode,
      reason: `Rewaiq cashout - ${amount} coins`,
    });

    await pool.query(
      'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
      [amount, req.user.id]
    );

    const status = transferRes.status ? 'processing' : 'pending';

    const transaction = await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata)
       VALUES ($1, $2, 'cashout', $3, $4) RETURNING id`,
      [
        req.user.id,
        amount,
        status,
        JSON.stringify({
          naira_amount: naira,
          bank_name: bank_name || '',
          bank_code,
          account_number,
          account_name,
          paystack_reference: transferRes.data?.reference || null,
          recipient_code: recipientCode
        })
      ]
    );

    // Notify admin
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         SELECT id, 'New Cashout Request', $1, 'info'
         FROM users WHERE role = 'admin' LIMIT 1`,
        [`${account_name} requested ₦${naira.toLocaleString()} NGN`]
      );
    } catch (e) {}

    res.json({
      message: transferRes.status
        ? 'Cashout initiated via Paystack'
        : 'Cashout request submitted for manual processing',
      transaction_id: transaction.rows[0].id,
      naira_amount: naira,
      coins_deducted: amount,
      status
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PAYSTACK REQUEST
const paystackRequest = (method, path, body = null) => {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) })
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', chunk => responseData += chunk);

      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve({ status: false });
        }
      });
    });

    req.on('error', () => resolve({ status: false }));

    if (data) req.write(data);
    req.end();
  });
};

// MANUAL CASHOUT
const manualCashout = async (
  req,
  res,
  amount,
  bank_code,
  account_number,
  account_name,
  bank_name
) => {
  await pool.query(
    'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
    [amount, req.user.id]
  );

  const naira = Math.floor(amount / 2);

  const transaction = await pool.query(
    `INSERT INTO transactions (user_id, amount, type, status, metadata)
     VALUES ($1, $2, 'cashout', 'pending', $3) RETURNING id`,
    [
      req.user.id,
      amount,
      JSON.stringify({
        naira_amount: naira,
        bank_name,
        bank_code,
        account_number,
        account_name
      })
    ]
  );

  return res.json({
    message: 'Cashout request submitted. Processing within 24-48 hours.',
    transaction_id: transaction.rows[0].id,
    naira_amount: naira,
    coins_deducted: amount,
    status: 'pending'
  });
};

// GET HISTORY
const getHistory = async (req, res) => {
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
};

module.exports = {
  getBalance,
  earnCoins,
  cashout,
  getHistory
};
