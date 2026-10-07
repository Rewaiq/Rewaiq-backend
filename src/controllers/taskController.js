const pool = require('../config/db');

// =========================================================
// CREATE TASK (Admin only)
// =========================================================
const createTask = async (req, res) => {
  const { title, description, reward_coins, task_type, target_url } = req.body;

  try {
    if (!title || !reward_coins || !task_type) {
      return res.status(400).json({
        message: 'Title, reward coins, and task type are required'
      });
    }

    const task = await pool.query(
      `INSERT INTO tasks (title, description, reward_coins, task_type, target_url, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       RETURNING *`,
      [title, description || null, reward_coins, task_type, target_url || null]
    );

    return res.status(201).json({
      message: 'Task created successfully',
      task: task.rows[0]
    });
  } catch (err) {
    console.error('Create task error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// GET ALL TASKS (With per-user completion state)
// =========================================================
const getAllTasks = async (req, res) => {
  const userId = req.user ? req.user.id : null;

  try {
    let tasksQuery;
    let queryParams = [];

    if (userId) {
      tasksQuery = `
        SELECT 
          t.id,
          t.title,
          t.description,
          t.reward_coins,
          t.task_type,
          t.target_url,
          t.is_active,
          t.created_at,
          CASE WHEN tc.id IS NOT NULL THEN true ELSE false END AS is_completed,
          COALESCE(tc.status, 'uncompleted') AS completion_status
        FROM tasks t
        LEFT JOIN task_completions tc 
          ON t.id = tc.task_id AND tc.user_id = $1 AND tc.status IN ('completed', 'approved')
        WHERE t.is_active = true
        ORDER BY t.created_at DESC
      `;
      queryParams = [userId];
    } else {
      tasksQuery = `
        SELECT *, false AS is_completed, 'uncompleted' AS completion_status 
        FROM tasks 
        WHERE is_active = true 
        ORDER BY created_at DESC
      `;
    }

    const tasks = await pool.query(tasksQuery, queryParams);
    return res.json({ tasks: tasks.rows });
  } catch (err) {
    console.error('Get all tasks error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// GET SINGLE TASK
// =========================================================
const getTask = async (req, res) => {
  const { id } = req.params;
  try {
    const task = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );

    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    return res.json({ task: task.rows[0] });
  } catch (err) {
    console.error('Get task error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// COMPLETE TASK (Auto-approves social tasks & awards coins)
// =========================================================
const completeTask = async (req, res) => {
  const { task_id, proof_url } = req.body;
  const userId = req.user.id;

  if (!task_id) {
    return res.status(400).json({ message: 'Task ID is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if task exists and is active
    const taskResult = await client.query(
      'SELECT * FROM tasks WHERE id = $1 AND is_active = true',
      [task_id]
    );

    if (taskResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Task not found or inactive' });
    }

    const task = taskResult.rows[0];

    // 2. Prevent duplicate claims
    const existing = await client.query(
      `SELECT id, status FROM task_completions 
       WHERE user_id = $1 AND task_id = $2`,
      [userId, task_id]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Task already completed or submitted' });
    }

    // 3. Auto-approve social link tasks (Instagram, TikTok, Telegram, Twitter)
    const autoApproveTypes = ['tiktok', 'instagram', 'telegram', 'twitter', 'social', 'follow'];
    const isAutoApprove = autoApproveTypes.includes((task.task_type || '').toLowerCase());
    const finalStatus = isAutoApprove ? 'completed' : 'pending';

    const completion = await client.query(
      `INSERT INTO task_completions (user_id, task_id, proof_url, status, completed_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [userId, task_id, proof_url || null, finalStatus]
    );

    let updatedBalance = null;

    // 4. Award coins immediately if auto-approved
    if (isAutoApprove) {
      const reward = parseInt(task.reward_coins, 10) || 0;

      await client.query(
        `UPDATE users 
         SET coin_balance = COALESCE(coin_balance, 0) + $1 
         WHERE id = $2`,
        [reward, userId]
      );

      await client.query(
        `INSERT INTO transactions (user_id, amount, type, status, metadata, created_at)
         VALUES ($1, $2, 'task_reward', 'completed', $3, NOW())`,
        [
          userId,
          reward,
          JSON.stringify({
            task_id: task.id,
            title: task.title,
            task_type: task.task_type
          })
        ]
      );

      const userBalanceResult = await client.query(
        'SELECT coin_balance FROM users WHERE id = $1',
        [userId]
      );
      updatedBalance = userBalanceResult.rows[0]?.coin_balance;
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: isAutoApprove 
        ? `Task completed! ${task.reward_coins} coins awarded.` 
        : 'Task submitted successfully — pending review',
      completion: completion.rows[0],
      coins_awarded: isAutoApprove ? task.reward_coins : 0,
      coin_balance: updatedBalance
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Complete task error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// =========================================================
// APPROVE TASK (Admin manual approval)
// =========================================================
const approveTask = async (req, res) => {
  const { completion_id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const completion = await client.query(
      `SELECT tc.*, t.reward_coins, t.title, t.task_type 
       FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id
       WHERE tc.id = $1
       FOR UPDATE`,
      [completion_id]
    );

    if (completion.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Completion record not found' });
    }

    const { user_id, reward_coins, status, task_id, title, task_type } = completion.rows[0];

    if (status === 'approved' || status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This submission has already been approved' });
    }

    await client.query(
      `UPDATE task_completions SET status = 'completed' WHERE id = $1`,
      [completion_id]
    );

    const reward = parseInt(reward_coins, 10) || 0;

    await client.query(
      `UPDATE users SET coin_balance = COALESCE(coin_balance, 0) + $1 WHERE id = $2`,
      [reward, user_id]
    );

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata, created_at)
       VALUES ($1, $2, 'task_reward', 'completed', $3, NOW())`,
      [
        user_id,
        reward,
        JSON.stringify({ task_id, title, task_type })
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: `Task approved — ${reward} coins awarded to user`,
      coins_awarded: reward
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve task error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// =========================================================
// GET USER'S COMPLETED TASKS
// =========================================================
const getMyTasks = async (req, res) => {
  try {
    const completions = await pool.query(
      `SELECT 
        tc.id AS completion_id,
        tc.task_id,
        tc.status,
        tc.proof_url,
        tc.completed_at,
        t.title,
        t.reward_coins,
        t.task_type,
        t.target_url
       FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id
       WHERE tc.user_id = $1
       ORDER BY tc.completed_at DESC`,
      [req.user.id]
    );

    return res.json({ completions: completions.rows });
  } catch (err) {
    console.error('Get my tasks error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { 
  createTask, 
  getAllTasks, 
  getTask, 
  completeTask, 
  approveTask, 
  getMyTasks 
};
