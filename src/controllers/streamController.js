const pool = require('../config/db');

// START STREAM SESSION
const startStream = async (req, res) => {
  const { track_id, track_url } = req.body;
  try {
    // Check if already streaming
    const existing = await pool.query(
      `SELECT * FROM stream_sessions 
       WHERE user_id = $1 AND status = 'active'`,
      [req.user.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        message: 'You already have an active stream session' 
      });
    }

    const session = await pool.query(
      `INSERT INTO stream_sessions 
       (user_id, track_id, track_url, start_time, status)
       VALUES ($1, $2, $3, NOW(), 'active') RETURNING *`,
      [req.user.id, track_id, track_url]
    );

    res.status(201).json({
      message: 'Stream session started',
      session: session.rows[0],
      instruction: 'Stream for at least 2 minutes then call /end to earn coins'
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// END STREAM SESSION
const endStream = async (req, res) => {
  const { session_id } = req.body;
  const MIN_STREAM_SECONDS = 120; // 2 minutes minimum
  const COINS_PER_STREAM = 10;

  try {
    // Get session
    const session = await pool.query(
      `SELECT * FROM stream_sessions WHERE id = $1 AND user_id = $2`,
      [session_id, req.user.id]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (session.rows[0].status !== 'active') {
      return res.status(400).json({ message: 'Session already ended' });
    }

    // Calculate duration
    const startTime = new Date(session.rows[0].start_time);
    const endTime = new Date();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);

    if (durationSeconds < MIN_STREAM_SECONDS) {
      // Update session as failed
      await pool.query(
        `UPDATE stream_sessions SET status = 'failed', 
         end_time = NOW(), duration_seconds = $1 WHERE id = $2`,
        [durationSeconds, session_id]
      );
      return res.status(400).json({
        message: `Stream too short — minimum 2 minutes required`,
        streamed_seconds: durationSeconds,
        required_seconds: MIN_STREAM_SECONDS
      });
    }

    // Update session as completed
    await pool.query(
      `UPDATE stream_sessions SET status = 'completed', 
       end_time = NOW(), duration_seconds = $1, coins_earned = $2 
       WHERE id = $3`,
      [durationSeconds, COINS_PER_STREAM, session_id]
    );

    // Award coins
    await pool.query(
      `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
      [COINS_PER_STREAM, req.user.id]
    );

    // Record transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status)
       VALUES ($1, $2, 'stream_earn', 'completed')`,
      [req.user.id, COINS_PER_STREAM]
    );

    res.json({
      message: `Stream complete! ${COINS_PER_STREAM} coins earned`,
      duration_seconds: durationSeconds,
      coins_earned: COINS_PER_STREAM
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET MY STREAM HISTORY
const getStreamHistory = async (req, res) => {
  try {
    const sessions = await pool.query(
      `SELECT * FROM stream_sessions WHERE user_id = $1 
       ORDER BY start_time DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ sessions: sessions.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { startStream, endStream, getStreamHistory };