const pool = require('../config/db');

// GET COIN BALANCE
const getBalance = async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ coin_balance: user.rows[0].coin_balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// EARN COINS
const earnCoins = async (req, res) => {
  const { amount, type } = req.body;
  try {
    // Add coins to user balance
    const updated = await pool.query(
      `UPDATE users SET coin_balance = coin_balance + $1 
       WHERE id = $2 RETURNING coin_balance`,
      [amount, req.user.id]
    );

    // Record transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, $3, 'completed')`,
      [req.user.id, amount, type || 'earn']
    );

    res.json({
      message: `${amount} coins earned successfully`,
      new_balance: updated.rows[0].coin_balance
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// CASHOUT REQUEST
const cashout = async (req, res) => {
  const { amount, bank_name, account_number } = req.body;
  try {
    // Check balance
    const user = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );

    if (user.rows[0].coin_balance < amount) {
      return res.status(400).json({ message: 'Insufficient coin balance' });
    }

    // Deduct coins
    await pool.query(
      `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
      [amount, req.user.id]
    );

    // Record cashout transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, 'cashout', 'pending')`,
      [req.user.id, amount]
    );

    res.json({
      message: 'Cashout request submitted successfully',
      amount_requested: amount,
      status: 'pending',
      note: 'Your withdrawal will be processed within 24 hours'
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET TRANSACTION HISTORY
const getHistory = async (req, res) => {
  try {
    const transactions = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ transactions: transactions.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getBalance, earnCoins, cashout, getHistory };