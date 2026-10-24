
const pool = require('../config/db');

// =========================================================
// CREATE TASK (Admin only — protect this route in adminRoutes)
// =========================================================
const createTask = async (req, res) => {
  const { title, description, reward_coins, task_type, target_url } = req.body;

  try {
    if (
      !title ||
      reward_coins === undefined ||
      !Number.isInteger(Number(reward_coins)) ||
      Number(reward_coins) < 0 ||
      !task_type
    ) {
      return res.status(400).json({
        message: 'A title, valid non-negative reward, and task type are required'
      });
    }

    const task = await pool.query(
      `INSERT INTO tasks
       (title, description, reward_coins, task_type, target_url, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       RETURNING *`,
      [
        title.trim(),
        description || null,
        Number(reward_coins),
        task_type,
        target_url || null
      ]
    );

    return res.status(201).json({
      message: 'Task created successfully',
      task: task.rows[0]
    });
  } catch (err) {
    console.error('Create task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// =========================================================
// GET ALL ACTIVE TASKS WITH USER STATUS
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
          CASE
            WHEN tc.status IN ('completed', 'approved') THEN true
            ELSE false
          END AS is_completed,
          COALESCE(tc.status, 'uncompleted') AS completion_status
        FROM tasks t
        LEFT JOIN task_completions tc
          ON t.id = tc.task_id AND tc.user_id = $1
        WHERE t.is_active = true
        ORDER BY t.created_at DESC
      `;
      queryParams = [userId];
    } else {
      tasksQuery = `
        SELECT *,
          false AS is_completed,
          'uncompleted' AS completion_status
        FROM tasks
        WHERE is_active = true
        ORDER BY created_at DESC
      `;
    }

    const tasks = await pool.query(tasksQuery, queryParams);

    return res.json({ tasks: tasks.rows });
  } catch (err) {
    console.error('Get all tasks error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// =========================================================
// GET SINGLE TASK
// =========================================================
const getTask = async (req, res) => {
  const { id } = req.params;

  try {
    const task = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND is_active = true',
      [id]
    );

    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    return res.json({ task: task.rows[0] });
  } catch (err) {
    console.error('Get task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// =========================================================
// SUBMIT TASK — ALWAYS PENDING, NEVER AWARDS COINS HERE
// =========================================================
const completeTask = async (req, res) => {
  const { task_id, proof_url } = req.body;
  const userId = req.user.id;

  if (!task_id) {
    return res.status(400).json({ message: 'Task ID is required' });
  }

  if (
    typeof proof_url !== 'string' ||
    !proof_url.trim()
  ) {
    return res.status(400).json({
      message: 'Please upload your screenshot before submitting this task.'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const taskResult = await client.query(
      'SELECT id FROM tasks WHERE id = $1 AND is_active = true',
      [task_id]
    );

    if (taskResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        message: 'Task not found or inactive'
      });
    }

    // Prevent duplicate submissions for the same user and task.
    // The database should also enforce a UNIQUE(user_id, task_id)
    // constraint if each task can only be submitted once.
    const existing = await client.query(
      `SELECT id
       FROM task_completions
       WHERE user_id = $1 AND task_id = $2
       LIMIT 1`,
      [userId, task_id]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'You have already submitted this task.'
      });
    }

    const completion = await client.query(
      `INSERT INTO task_completions
       (user_id, task_id, proof_url, status, completed_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING *`,
      [userId, task_id, proof_url.trim()]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Submission received — awaiting admin review.',
      completion: completion.rows[0],
      coins_awarded: 0
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Submit task error:', err);

    // A concurrent duplicate may hit a database uniqueness constraint.
    if (err.code === '23505') {
      return res.status(409).json({
        message: 'You have already submitted this task.'
      });
    }

    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

// =========================================================
// APPROVE TASK — AWARD COINS ONCE, ONLY FROM PENDING STATUS
// =========================================================
const approveTask = async (req, res) => {
  const { completion_id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const completionResult = await client.query(
      `SELECT
         tc.id,
         tc.user_id,
         tc.task_id,
         tc.status,
         t.reward_coins,
         t.title,
         t.task_type
       FROM task_completions tc
       JOIN tasks t ON tc.task_id = t.id
       WHERE tc.id = $1
       FOR UPDATE OF tc`,
      [completion_id]
    );

    if (completionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        message: 'Submission not found'
      });
    }

    const completion = completionResult.rows[0];

    if (completion.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Only pending submissions can be approved.',
        current_status: completion.status
      });
    }

    const reward = Number(completion.reward_coins);

    if (!Number.isSafeInteger(reward) || reward < 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        message: 'Invalid task reward configuration'
      });
    }

    // Conditional update ensures only a pending submission is approved.
    const updated = await client.query(
      `UPDATE task_completions
       SET status = 'completed'
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [completion_id]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Submission has already been processed.'
      });
    }

    const userUpdate = await client.query(
      `UPDATE users
       SET coin_balance = COALESCE(coin_balance, 0) + $1
       WHERE id = $2
       RETURNING coin_balance`,
      [reward, completion.user_id]
    );

    if (userUpdate.rows.length === 0) {
      throw new Error('User not found while awarding task reward');
    }

    await client.query(
      `INSERT INTO transactions
       (user_id, amount, type, status, metadata, created_at)
       VALUES ($1, $2, 'task_reward', 'completed', $3, NOW())`,
      [
        completion.user_id,
        reward,
        JSON.stringify({
          completion_id: completion.id,
          task_id: completion.task_id,
          title: completion.title,
          task_type: completion.task_type
        })
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: `Task approved — ${reward} coins awarded.`,
      completion_id: completion.id,
      coins_awarded: reward,
      coin_balance: userUpdate.rows[0].coin_balance
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve task error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

// =========================================================
// GET USER'S TASK SUBMISSIONS
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
    return res.status(500).json({ message: 'Server error' });
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
