const https = require('https');
const pool = require('../config/db');

/**
 * VERIFY BANK ACCOUNT (Paystack)
 */
const verifyAccount = async (account_number, bank_code) => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          resolve({ status: false });
        }
      });
    });

    req.on('error', () => {
      resolve({ status: false });
    });

    req.end();
  });
};

/**
 * CASHOUT CONTROLLER
 */
const cashout = async (req, res) => {
  try {
    const {
      amount,
      account_number,
      bank_code,
      bank_name
    } = req.body;

    const userId = req.user.id;

    /**
     * 1. CHECK REQUIRED FIELDS
     */
    if (!amount || !account_number || !bank_code) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    /**
     * 2. CHECK MINIMUM CASHOUT
     *
     * 500 coins = ₦250
     */
    if (parseInt(amount) < 500) {
      return res.status(400).json({
        success: false,
        message: 'Minimum cashout is 500 coins (N250)',
      });
    }

    /**
     * 3. VERIFY ACCOUNT FIRST
     */
    const verification = await verifyAccount(
      account_number,
      bank_code
    );

    /**
     * IF VERIFICATION FAILS
     * Save pending request for manual processing
     */
    if (!verification.status || !verification.data) {
      await pool.query(
        `INSERT INTO transactions
        (user_id, amount, type, status, metadata)
        VALUES ($1, $2, 'cashout', 'pending', $3)`,
        [
          userId,
          amount,
          JSON.stringify({
            naira_amount: Math.floor(amount / 2),
            bank_name,
            bank_code,
            account_number,
            account_name: null,
            note: 'Account verification failed — manual processing required',
          }),
        ]
      );

      return res.json({
        success: true,
        message:
          'Cashout submitted. Will be reviewed and processed manually within 24 hours.',
        status: 'pending',
      });
    }

    /**
     * 4. ACCOUNT VERIFIED
     */
    const accountName =
      verification.data?.account_name || 'Verified Account';

    /**
     * 5. CHECK USER BALANCE
     */
    const user = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [userId]
    );

    if (!user.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.rows[0].coin_balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
      });
    }

    /**
     * 6. DEDUCT COINS
     * Only after account verification succeeds
     */
    await pool.query(
      'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
      [amount, userId]
    );

    /**
     * 7. CREATE CASHOUT RECORD
     */
    const result = await pool.query(
      `INSERT INTO transactions
      (user_id, amount, type, status, metadata)
      VALUES ($1, $2, 'cashout', 'processing', $3)
      RETURNING id`,
      [
        userId,
        amount,
        JSON.stringify({
          naira_amount: Math.floor(amount / 2),
          bank_name,
          bank_code,
          account_number,
          account_name: accountName,
          verified: true,
        }),
      ]
    );

    /**
     * 8. RESPONSE
     */
    return res.json({
      success: true,
      message: 'Cashout request is being processed',
      data: {
        transaction_id: result.rows[0].id,
        account_name: accountName,
        status: 'processing',
      },
    });

  } catch (err) {
    console.error('Cashout error:', err.message);

    return res.status(500).json({
      success: false,
      message: 'Server error processing cashout',
    });
  }
};

module.exports = {
  cashout,
};
