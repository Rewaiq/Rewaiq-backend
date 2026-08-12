const pool = require('../config/db');

// START STREAM SESSION
const startStream = async (req, res) => {
  const { track_id, track_url } = req.body;
  try {
    // Auto-clear any stuck active session older than 10 minutes
    const existing = await pool.query(
      `SELECT * FROM stream_sessions WHERE user_id = $1 AND status = 'active'`,
      [req.user.id]
    );

    if (existing.rows.length > 0) {
      const session = existing.rows[0];
      const minutesOld = (new Date() - new Date(session.start_time)) / 1000 / 60;

      if (minutesOld > 10) {
        await pool.query(
          `UPDATE stream_sessions SET status = 'failed', end_time = NOW() WHERE id = $1`,
          [session.id]
        );
      } else {
        return res.status(400).json({ message: 'You already have an active stream session' });
      }
    }

    // Block streaming the same track more than once per day
    if (track_id) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const alreadyStreamed = await pool.query(
        `SELECT id FROM stream_sessions 
         WHERE user_id = $1 AND track_id = $2 
         AND status = 'completed' AND start_time >= $3`,
        [req.user.id, track_id, today]
      );

      if (alreadyStreamed.rows.length > 0) {
        return res.status(400).json({
          message: 'You have already streamed this track today. Try again tomorrow or pick another track.'
        });
      }
    }

    const session = await pool.query(
      `INSERT INTO stream_sessions (user_id, track_id, track_url, start_time, status)
       VALUES ($1, $2, $3, NOW(), 'active') RETURNING *`,
      [req.user.id, track_id, track_url]
    );

    res.status(201).json({
      message: 'Stream session started',
      session: session.rows[0],
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// END STREAM SESSION
const endStream = async (req, res) => {
  const { session_id } = req.body;
  const MIN_STREAM_SECONDS = 60;

  try {
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

    const startTime = new Date(session.rows[0].start_time);
    const durationSeconds = Math.floor((new Date() - startTime) / 1000);
    const track_id = session.rows[0].track_id;

    // Too short
    if (durationSeconds < MIN_STREAM_SECONDS) {
      await pool.query(
        `UPDATE stream_sessions SET status = 'failed', end_time = NOW(), 
         duration_seconds = $1 WHERE id = $2`,
        [durationSeconds, session_id]
      );
      return res.status(400).json({
        message: 'Stream too short — minimum 60 seconds required',
        streamed_seconds: durationSeconds,
        required_seconds: MIN_STREAM_SECONDS
      });
    }

    // Get coins from track campaign
    let coinsToAward = 30; // updated default per new coin economics
    if (track_id) {
      const track = await pool.query(
        'SELECT campaign_coins FROM tracks WHERE id = $1',
        [track_id]
      );
      if (track.rows[0]?.campaign_coins) {
        coinsToAward = parseInt(track.rows[0].campaign_coins);
      }
    }

    // Check daily cap
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earned = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE user_id = $1 
       AND type = 'stream_earn'
       AND status = 'completed'
       AND created_at >= $2`,
      [req.user.id, today]
    );

    const todayTotal = parseInt(earned.rows[0].total);
    const DAILY_CAP = 500;

    if (todayTotal >= DAILY_CAP) {
      await pool.query(
        `UPDATE stream_sessions SET status = 'completed', end_time = NOW(), 
         duration_seconds = $1, coins_earned = 0 WHERE id = $2`,
        [durationSeconds, session_id]
      );
      return res.status(200).json({
        message: 'Daily earning limit reached. Come back tomorrow!',
        coins_earned: 0,
        daily_cap_reached: true,
        coins_earned_today: todayTotal,
        daily_cap: DAILY_CAP
      });
    }

    const actualCoins = Math.min(coinsToAward, DAILY_CAP - todayTotal);

    // Mark session complete
    await pool.query(
      `UPDATE stream_sessions SET status = 'completed', end_time = NOW(), 
       duration_seconds = $1, coins_earned = $2 WHERE id = $3`,
      [durationSeconds, actualCoins, session_id]
    );

    // Update track stream count
    if (track_id) {
      await pool.query(
        'UPDATE tracks SET total_streams = COALESCE(total_streams, 0) + 1 WHERE id = $1',
        [track_id]
      );

      const trackData = await pool.query(
        'SELECT total_streams, target_streams FROM tracks WHERE id = $1',
        [track_id]
      );
      const t = trackData.rows[0];
      if (t && t.target_streams && t.total_streams >= t.target_streams) {
        await pool.query(
          `UPDATE tracks SET is_active = false WHERE id = $1`,
          [track_id]
        );
      }
    }

    // Credit coins to user
    await pool.query(
      'UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2',
      [actualCoins, req.user.id]
    );

    // Record transaction
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, status, metadata)
       VALUES ($1, $2, 'stream_earn', 'completed', $3)`,
      [req.user.id, actualCoins, JSON.stringify({ track_id, session_id })]
    );

    const newBalance = await pool.query(
      'SELECT coin_balance FROM users WHERE id = $1',
      [req.user.id]
    );

    res.json({
      message: 'Stream complete! ' + actualCoins + ' coins earned',
      duration_seconds: durationSeconds,
      coins_earned: actualCoins,
      coin_balance: newBalance.rows[0].coin_balance,
      coins_earned_today: todayTotal + actualCoins,
      daily_cap: DAILY_CAP,
      daily_cap_reached: false
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET STREAM HISTORY
const getStreamHistory = async (req, res) => {
  try {
    const sessions = await pool.query(
      `SELECT s.*, t.title as track_title 
       FROM stream_sessions s
       LEFT JOIN tracks t ON s.track_id = t.id
       WHERE s.user_id = $1 
       ORDER BY s.start_time DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ sessions: sessions.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { startStream, endStream, getStreamHistory };
