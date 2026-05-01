const pool = require('../config/db');

// GET TASKS FEED
const getTasksFeed = async (req, res) => {
  const { type, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    // Get user interests for personalization
    const userResult = await pool.query(
      'SELECT interests FROM users WHERE id = $1',
      [req.user.id]
    );
    const userInterests = userResult.rows[0]?.interests || [];

    // Build query
    let query = `
      SELECT t.*, 
        CASE WHEN tc.user_id IS NOT NULL THEN true ELSE false END as completed
      FROM tasks t
      LEFT JOIN task_completions tc 
        ON t.id = tc.task_id AND tc.user_id = $1
      WHERE t.is_active = true
    `;
    
    const params = [req.user.id];
    let paramCount = 2;

    // Filter by type
    if (type) {
      query += ` AND t.task_type = $${paramCount}`;
      params.push(type);
      paramCount++;
    }

    // Order: uncompleted first, highest reward, newest
    query += `
      ORDER BY 
        completed ASC,
        t.reward_coins DESC,
        t.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limit, offset);

    const tasks = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM tasks WHERE is_active = true`,
    );

    res.json({
      tasks: tasks.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET CONTENT FEED (tracks + tasks combined)
const getContentFeed = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    // Get tracks
    const tracks = await pool.query(
      `SELECT *, 'track' as feed_type FROM tracks 
       WHERE is_active = true 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get tasks
    const tasks = await pool.query(
      `SELECT t.*, 'task' as feed_type,
        CASE WHEN tc.user_id IS NOT NULL THEN true ELSE false END as completed
       FROM tasks t
       LEFT JOIN task_completions tc 
         ON t.id = tc.task_id AND tc.user_id = $1
       WHERE t.is_active = true
       ORDER BY t.reward_coins DESC, t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    // Combine and shuffle
    const feed = [...tracks.rows, ...tasks.rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ feed });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getTasksFeed, getContentFeed };