const pool = require('../config/db');

// CREATE TASK (admin only)
const createTask = async (req, res) => {
  const { title, description, reward_coins, task_type } = req.body;
  try {
    const task = await pool.query(
      `INSERT INTO tasks (title, description, reward_coins, task_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, description, reward_coins, task_type]
    );
    res.status(201).json({
      message: 'Task created successfully',
      task: task.rows[0]
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET ALL TASKS
const getAllTasks = async (req, res) => {
  try {
    const tasks = await pool.query(
      `SELECT * FROM tasks WHERE is_active = true ORDER BY created_at DESC`
    );
    res.json({ tasks: tasks.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET SINGLE TASK
const getTask = async (req, res) => {
  const { id } = req.params;
  try {
    const task = await pool.query(
      'SELECT * FROM tasks WHERE id = $1', [id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json({ task: task.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// COMPLETE TASK (user submits proof)
const completeTask = async (req, res) => {
  const { task_id, proof_url } = req.body;
  try {
    // Check task exists
    const task = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND is_active = true', [task_id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found or inactive' });
    }

    // Check if already completed
    const existing = await pool.query(
      `SELECT * FROM task_completions 
       WHERE user_id = $1 AND task_id = $2`,
      [req.user.id, task_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Task already submitted' });
    }

    // Submit completion
    const completion = await pool.query(
      `INSERT INTO task_completions (user_id, task_id, proof_url, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [req.user.id, task_id, proof_url]
    );

    res.status(201).json({
      message: 'Task submitted successfully — pending approval',
      completion: completion.rows[0]
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// APPROVE TASK (admin approves — awards coins)
const approveTask = async (req, res) => {
  const { completion_id } = req.params;
  try {
    // Get completion
    const completion = await pool.query(
      `SELECT tc.*, t.reward_coins FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id
       WHERE tc.id = $1`,
      [completion_id]
    );

    if (completion.rows.length === 0) {
      return res.status(404).json({ message: 'Completion not found' });
    }

    const { user_id, reward_coins, status } = completion.rows[0];

    if (status === 'approved') {
      return res.status(400).json({ message: 'Already approved' });
    }

    // Update status
    await pool.query(
      `UPDATE task_completions SET status = 'approved' WHERE id = $1`,
      [completion_id]
    );

    // Award coins
    await pool.query(
      `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
      [reward_coins, user_id]
    );

    // Record transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, 'task_reward', 'completed')`,
      [user_id, reward_coins]
    );

    res.json({
      message: `Task approved — ${reward_coins} coins awarded to user`,
      coins_awarded: reward_coins
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET MY COMPLETED TASKS
const getMyTasks = async (req, res) => {
  try {
    const completions = await pool.query(
      `SELECT tc.*, t.title, t.reward_coins, t.task_type 
       FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id
       WHERE tc.user_id = $1
       ORDER BY tc.completed_at DESC`,
      [req.user.id]
    );
    res.json({ completions: completions.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { createTask, getAllTasks, getTask, completeTask, approveTask, getMyTasks };