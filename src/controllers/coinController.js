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

    const req = https
      .request(options, (res) => {
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
      })
      .on('error', () => {
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
    const userId = req.user.id;
    const { amount, account_number, bank_code } = req.body;

    if (!amount || !account_number || !bank_code) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    /**
     * 1. VERIFY ACCOUNT BEFORE ANYTHING
     */
    const verification = await verifyAccount(account_number, bank_code);

    if (!verification.status || !verification.data) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bank account. Please check details and try again.',
      });
    }

    const account_name = verification.data.account_name;

    /**
     * 2. CHECK USER BALANCE
     */
    const user = await pool.query(
      'SELECT coins FROM users WHERE id = $1',
      [userId]
    );

    if (!user.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.rows[0].coins < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
      });
    }

    /**
     * 3. DEDUCT COINS FIRST (SAFE TRANSACTION FLOW)
     */
    await pool.query(
      'UPDATE users SET coins = coins - $1 WHERE id = $2',
      [amount, userId]
    );

    /**
     * 4. SAVE CASHOUT REQUEST (PENDING STATE)
     */
    const cashoutResult = await pool.query(
      `INSERT INTO transactions 
       (user_id, amount, type, status, metadata)
       VALUES ($1, $2, 'cashout', 'pending', $3)
       RETURNING id`,
      [
        userId,
        amount,
        JSON.stringify({
          account_number,
          bank_code,
          account_name,
        }),
      ]
    );

    /**
     * 5. RESPONSE
     */
    return res.status(200).json({
      success: true,
      message: 'Cashout request submitted successfully',
      data: {
        transaction_id: cashoutResult.rows[0].id,
        account_name,
        status: 'pending',
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
