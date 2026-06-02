const pool = require('../config/db');

// DASHBOARD STATS
const getDashboardStats = async (req, res) => {
  try {
    const [users, tasks, completions, cashouts, streams] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM tasks WHERE is_active = true'),
      pool.query(`SELECT COUNT(*) FROM task_completions WHERE status = 'pending'`),
      pool.query(`SELECT COUNT(*), SUM(amount) FROM transactions WHERE type = 'cashout' AND status = 'pending'`),
      pool.query('SELECT COUNT(*) FROM stream_sessions WHERE status = $1', ['completed']),
    ]);
    res.json({
      stats: {
        total_users: parseInt(users.rows[0].count),
        active_tasks: parseInt(tasks.rows[0].count),
        pending_approvals: parseInt(completions.rows[0].count),
        pending_cashouts: parseInt(cashouts.rows[0].count),
        pending_cashout_amount: cashouts.rows[0].sum || 0,
        total_streams: parseInt(streams.rows[0].count),
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET ALL USERS
const getAllUsers = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const users = await pool.query(
      `SELECT id, full_name, email, phone, role, coin_balance, is_verified, created_at
       FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET PENDING TASK COMPLETIONS
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

// APPROVE TASK COMPLETION
const approveCompletion = async (req, res) => {
  const { id } = req.params;
  try {
    const completion = await pool.query(
      `SELECT tc.*, t.reward_coins FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id WHERE tc.id = $1`, [id]
    );
    if (completion.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (completion.rows[0].status === 'approved') return res.status(400).json({ message: 'Already approved' });

    const { user_id, reward_coins } = completion.rows[0];
    await pool.query(`UPDATE task_completions SET status = 'approved' WHERE id = $1`, [id]);
    await pool.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [reward_coins, user_id]);
    await pool.query(`INSERT INTO transactions (user_id, amount, type, status) VALUES ($1, $2, 'task_reward', 'completed')`, [user_id, reward_coins]);

    res.json({ message: `Approved — ${reward_coins} coins awarded` });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// REJECT TASK COMPLETION
const rejectCompletion = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    await pool.query(`UPDATE task_completions SET status = 'rejected' WHERE id = $1`, [id]);
    res.json({ message: 'Task completion rejected', reason });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET PENDING CASHOUTS
const getPendingCashouts = async (req, res) => {
  try {
    const cashouts = await pool.query(
      `SELECT t.*, u.full_name, u.email, u.phone
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
    await pool.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [id]);
    res.json({ message: 'Cashout approved and processed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// CREATE TASK (Admin)
const createTask = async (req, res) => {
  const { title, description, reward_coins, task_type } = req.body;
  try {
    if (!title || !task_type) {
      return res.status(400).json({ message: 'Title and task type are required' });
    }
    const task = await pool.query(
      `INSERT INTO tasks (title, description, reward_coins, task_type, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [title, description, reward_coins || 30, task_type]
    );
    res.status(201).json({ message: 'Task created', task: task.rows[0] });
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
