const pool = require('../config/db');

// DASHBOARD STATS
const getDashboardStats = async (req, res) => {
  try {
    const [users, tasks, completions, cashouts, streams, tracks] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM tasks WHERE is_active = true'),
      pool.query(`SELECT COUNT(*) FROM task_completions WHERE status = 'pending'`),
      pool.query(`SELECT COUNT(*), COALESCE(SUM(amount),0) as total_amount FROM transactions WHERE type = 'cashout' AND status = 'pending'`),
      pool.query(`SELECT COUNT(*) FROM stream_sessions WHERE status = 'completed'`),
      pool.query(`SELECT COUNT(*) FROM tracks WHERE is_active = false`),
    ]);
    res.json({
      stats: {
        total_users: parseInt(users.rows[0].count),
        active_tasks: parseInt(tasks.rows[0].count),
        pending_approvals: parseInt(completions.rows[0].count),
        pending_cashouts: parseInt(cashouts.rows[0].count),
        pending_cashout_amount: cashouts.rows[0].total_amount || 0,
        total_streams: parseInt(streams.rows[0].count),
        pending_tracks: parseInt(tracks.rows[0].count),
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET ALL USERS
const getAllUsers = async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const users = await pool.query(
      `SELECT id, full_name, email, phone, role, coin_balance, is_email_verified, created_at
       FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET PENDING COMPLETIONS
const getPendingCompletions = async (req, res) => {
  try {
    const completions = await pool.query(
      `SELECT tc.*, u.full_name, u.email, t.title, t.reward_coins, t.task_type
       FROM task_completions tc
       JOIN users u ON tc.user_id = u.id
       JOIN tasks t ON tc.task_id = t.id
       WHERE tc.status = 'pending'
       ORDER BY tc.completed_at ASC`
    );
    res.json({ completions: completions.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// APPROVE COMPLETION
const approveCompletion = async (req, res) => {
  const { id } = req.params;
  try {
    const completion = await pool.query(
      `SELECT tc.*, t.reward_coins, t.title FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id WHERE tc.id = $1`, [id]
    );
    if (completion.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (completion.rows[0].status === 'approved') return res.status(400).json({ message: 'Already approved' });

    const { user_id, reward_coins, title } = completion.rows[0];
    await pool.query(`UPDATE task_completions SET status = 'approved' WHERE id = $1`, [id]);
    await pool.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [reward_coins, user_id]);
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status) VALUES ($1, $2, 'task_reward', 'completed')`,
      [user_id, reward_coins]
    );

    // Notify user
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'success')`,
        [user_id, 'Task Approved!', `Your submission for "${title}" was approved. ${reward_coins} coins added to your wallet.`]
      );
    } catch (e) {}

    res.json({ message: `Approved — ${reward_coins} coins awarded` });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// REJECT COMPLETION
const rejectCompletion = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const completion = await pool.query(
      `SELECT tc.*, t.title FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id WHERE tc.id = $1`, [id]
    );
    
    await pool.query(`UPDATE task_completions SET status = 'rejected' WHERE id = $1`, [id]);

    // Notify user
    if (completion.rows.length > 0) {
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'warning')`,
          [completion.rows[0].user_id, 'Task Rejected', `Your submission for "${completion.rows[0].title}" was not approved. ${reason || 'Please try again.'}`]
        );
      } catch (e) {}
    }

    res.json({ message: 'Task completion rejected', reason });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET PENDING CASHOUTS
const getPendingCashouts = async (req, res) => {
  try {
    const cashouts = await pool.query(
      `SELECT t.*, u.full_name, u.email, u.phone,
              t.metadata
       FROM transactions t JOIN users u ON t.user_id = u.id
       WHERE t.type = 'cashout' AND t.status = 'pending'
       ORDER BY t.created_at ASC`
    );
    res.json({ cashouts: cashouts.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// APPROVE CASHOUT
const approveCashout = async (req, res) => {
  const { id } = req.params;
  try {
    const tx = await pool.query(
      `SELECT t.*, u.full_name FROM transactions t 
       JOIN users u ON t.user_id = u.id WHERE t.id = $1`, [id]
    );
    
    await pool.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [id]);

    // Notify user
    if (tx.rows.length > 0) {
      const nairaAmount = Math.floor(tx.rows[0].amount / 2);
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'success')`,
          [tx.rows[0].user_id, 'Cashout Paid!', `Your cashout of N${nairaAmount.toLocaleString()} NGN has been processed and sent to your bank account.`]
        );
      } catch (e) {}
    }

    res.json({ message: 'Cashout approved and processed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// CREATE TASK
const createTask = async (req, res) => {
  const { title, description, reward_coins, task_type, target_url } = req.body;
  try {
    if (!title || !task_type) {
      return res.status(400).json({ message: 'Title and task type required' });
    }
    const task = await pool.query(
      `INSERT INTO tasks (title, description, reward_coins, task_type, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [title, description || '', parseInt(reward_coins) || 30, task_type]
    );
    res.status(201).json({ message: 'Task created successfully', task: task.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DEACTIVATE TASK
const deactivateTask = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE tasks SET is_active = false WHERE id = $1`, [id]);
    res.json({ message: 'Task deactivated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  getDashboardStats, getAllUsers, getPendingCompletions,
  approveCompletion, rejectCompletion, getPendingCashouts,
  approveCashout, createTask, deactivateTask
};
