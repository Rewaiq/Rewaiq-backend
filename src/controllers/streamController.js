const pool = require('../config/db');

const MIN_STREAM_SECONDS = 60;
const DAILY_CAP = 500;
const STALE_SESSION_MINUTES = 10;

// =========================================================
// START STREAM SESSION
// =========================================================

const startStream = async (req, res) => {
  const { track_id, track_url } = req.body;

  try {
    // -----------------------------------------------------
    // Validate track
    // -----------------------------------------------------

    if (!track_id) {
      return res.status(400).json({
        message: 'Track ID is required'
      });
    }

    // -----------------------------------------------------
    // Confirm track exists and is active
    // -----------------------------------------------------

    const trackResult = await pool.query(
      `
      SELECT
        id,
        title,
        campaign_coins,
        target_streams,
        total_streams,
        is_active
      FROM tracks
      WHERE id = $1
      `,
      [track_id]
    );

    if (trackResult.rows.length === 0) {
      return res.status(404).json({
        message: 'Track not found'
      });
    }

    const track = trackResult.rows[0];

    if (!track.is_active) {
      return res.status(400).json({
        message: 'This track is no longer available for streaming'
      });
    }

    // -----------------------------------------------------
    // Clean up stale active sessions
    // -----------------------------------------------------

    await pool.query(
      `
      UPDATE stream_sessions
      SET
        status = 'failed',
        end_time = NOW(),
        duration_seconds = GREATEST(
          0,
          EXTRACT(EPOCH FROM (NOW() - start_time))::integer
        )
      WHERE user_id = $1
        AND status = 'active'
        AND start_time < NOW() - INTERVAL '${STALE_SESSION_MINUTES} minutes'
      `,
      [req.user.id]
    );

    // -----------------------------------------------------
    // Check for a genuinely active session
    // -----------------------------------------------------

    const existing = await pool.query(
      `
      SELECT
        id,
        track_id,
        start_time
      FROM stream_sessions
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY start_time DESC
      LIMIT 1
      `,
      [req.user.id]
    );

    if (existing.rows.length > 0) {
      const activeSession = existing.rows[0];

      return res.status(400).json({
        message: 'You already have an active stream session',
        session_id: activeSession.id,
        track_id: activeSession.track_id
      });
    }

    // -----------------------------------------------------
    // Prevent same-track streaming more than once per day
    // -----------------------------------------------------

    const alreadyStreamed = await pool.query(
      `
      SELECT id
      FROM stream_sessions
      WHERE user_id = $1
        AND track_id = $2
        AND status = 'completed'
        AND start_time >= CURRENT_DATE
      LIMIT 1
      `,
      [req.user.id, track_id]
    );

    if (alreadyStreamed.rows.length > 0) {
      return res.status(400).json({
        message:
          'You have already streamed this track today. Try another track or come back tomorrow.'
      });
    }

    // -----------------------------------------------------
    // Create stream session
    // -----------------------------------------------------

    const session = await pool.query(
      `
      INSERT INTO stream_sessions
      (
        user_id,
        track_id,
        track_url,
        start_time,
        status,
        duration_seconds,
        coins_earned
      )
      VALUES
      (
        $1,
        $2,
        $3,
        NOW(),
        'active',
        0,
        0
      )
      RETURNING *
      `,
      [
        req.user.id,
        track_id,
        track_url || null
      ]
    );

    return res.status(201).json({
      message: 'Stream session started',
      session: session.rows[0]
    });

  } catch (err) {
    console.error(
      'Start stream error:',
      err
    );

    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// END STREAM SESSION
// =========================================================

const endStream = async (req, res) => {
  const { session_id } = req.body;

  try {
    if (!session_id) {
      return res.status(400).json({
        message: 'Session ID is required'
      });
    }

    // -----------------------------------------------------
    // Get session
    // -----------------------------------------------------

    const sessionResult = await pool.query(
      `
      SELECT *
      FROM stream_sessions
      WHERE id = $1
        AND user_id = $2
      `,
      [
        session_id,
        req.user.id
      ]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        message: 'Session not found'
      });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'active') {
      return res.status(400).json({
        message: 'Session already ended'
      });
    }

    // -----------------------------------------------------
    // Calculate duration
    // -----------------------------------------------------

    const startTime = new Date(
      session.start_time
    );

    const durationSeconds = Math.floor(
      (Date.now() - startTime.getTime()) / 1000
    );

    const trackId = session.track_id;

    // -----------------------------------------------------
    // Minimum stream duration
    // -----------------------------------------------------

    if (
      durationSeconds <
      MIN_STREAM_SECONDS
    ) {
      await pool.query(
        `
        UPDATE stream_sessions
        SET
          status = 'failed',
          end_time = NOW(),
          duration_seconds = $1,
          coins_earned = 0
        WHERE id = $2
        `,
        [
          durationSeconds,
          session_id
        ]
      );

      return res.status(400).json({
        message:
          'Stream too short — minimum 60 seconds required',
        streamed_seconds:
          durationSeconds,
        required_seconds:
          MIN_STREAM_SECONDS
      });
    }

    // -----------------------------------------------------
    // Get track reward
    // -----------------------------------------------------

    let coinsToAward = 30;

    if (trackId) {
      const trackResult = await pool.query(
        `
        SELECT campaign_coins
        FROM tracks
        WHERE id = $1
        `,
        [trackId]
      );

      if (
        trackResult.rows.length > 0 &&
        trackResult.rows[0].campaign_coins !== null
      ) {
        coinsToAward = parseInt(
          trackResult.rows[0].campaign_coins,
          10
        );
      }
    }

    if (
      !Number.isFinite(coinsToAward) ||
      coinsToAward < 0
    ) {
      coinsToAward = 30;
    }

    // -----------------------------------------------------
    // Calculate today's stream earnings
    // -----------------------------------------------------

    const earnedResult = await pool.query(
      `
      SELECT COALESCE(
        SUM(amount),
        0
      ) AS total
      FROM transactions
      WHERE user_id = $1
        AND type = 'stream_earn'
        AND status = 'completed'
        AND created_at >= CURRENT_DATE
      `,
      [req.user.id]
    );

    const todayTotal = parseInt(
      earnedResult.rows[0]?.total || 0,
      10
    );

    // -----------------------------------------------------
    // Daily cap
    // -----------------------------------------------------

    if (todayTotal >= DAILY_CAP) {
      await pool.query(
        `
        UPDATE stream_sessions
        SET
          status = 'completed',
          end_time = NOW(),
          duration_seconds = $1,
          coins_earned = 0
        WHERE id = $2
        `,
        [
          durationSeconds,
          session_id
        ]
      );

      return res.json({
        message:
          'Daily earning limit reached. Come back tomorrow!',
        coins_earned: 0,
        daily_cap_reached: true,
        coins_earned_today: todayTotal,
        daily_cap: DAILY_CAP
      });
    }

    const actualCoins = Math.min(
      coinsToAward,
      DAILY_CAP - todayTotal
    );

    // -----------------------------------------------------
    // Complete session
    // -----------------------------------------------------

    await pool.query(
      `
      UPDATE stream_sessions
      SET
        status = 'completed',
        end_time = NOW(),
        duration_seconds = $1,
        coins_earned = $2
      WHERE id = $3
      `,
      [
        durationSeconds,
        actualCoins,
        session_id
      ]
    );

    // -----------------------------------------------------
    // Update track stream count
    // -----------------------------------------------------

    if (trackId) {
      await pool.query(
        `
        UPDATE tracks
        SET total_streams =
          COALESCE(total_streams, 0) + 1
        WHERE id = $1
        `,
        [trackId]
      );

      const trackData =
        await pool.query(
          `
          SELECT
            total_streams,
            target_streams
          FROM tracks
          WHERE id = $1
          `,
          [trackId]
        );

      const updatedTrack =
        trackData.rows[0];

      if (
        updatedTrack &&
        updatedTrack.target_streams &&
        updatedTrack.total_streams >=
          updatedTrack.target_streams
      ) {
        await pool.query(
          `
          UPDATE tracks
          SET is_active = false
          WHERE id = $1
          `,
          [trackId]
        );
      }
    }

    // -----------------------------------------------------
    // Credit user wallet
    // -----------------------------------------------------

    await pool.query(
      `
      UPDATE users
      SET coin_balance =
        COALESCE(coin_balance, 0) + $1
      WHERE id = $2
      `,
      [
        actualCoins,
        req.user.id
      ]
    );

    // -----------------------------------------------------
    // Record transaction
    // -----------------------------------------------------

    await pool.query(
      `
      INSERT INTO transactions
      (
        user_id,
        amount,
        type,
        status,
        metadata
      )
      VALUES
      (
        $1,
        $2,
        'stream_earn',
        'completed',
        $3
      )
      `,
      [
        req.user.id,
        actualCoins,
        JSON.stringify({
          track_id: trackId,
          session_id
        })
      ]
    );

    // -----------------------------------------------------
    // Get updated balance
    // -----------------------------------------------------

    const balanceResult =
      await pool.query(
        `
        SELECT coin_balance
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

    const newBalance =
      balanceResult.rows[0]
        ?.coin_balance || 0;

    // -----------------------------------------------------
    // Response
    // -----------------------------------------------------

    return res.json({
      message:
        `Stream complete! ${actualCoins} coins earned`,
      duration_seconds:
        durationSeconds,
      coins_earned:
        actualCoins,
      coin_balance:
        newBalance,
      coins_earned_today:
        todayTotal + actualCoins,
      daily_cap:
        DAILY_CAP,
      daily_cap_reached:
        false
    });

  } catch (err) {
    console.error(
      'End stream error:',
      err
    );

    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// GET STREAM HISTORY
// =========================================================

const getStreamHistory = async (
  req,
  res
) => {
  try {
    const sessions =
      await pool.query(
        `
        SELECT
          s.*,
          t.title AS track_title
        FROM stream_sessions s
        LEFT JOIN tracks t
          ON s.track_id = t.id
        WHERE s.user_id = $1
        ORDER BY s.start_time DESC
        LIMIT 20
        `,
        [req.user.id]
      );

    return res.json({
      sessions:
        sessions.rows
    });

  } catch (err) {
    console.error(
      'Get stream history error:',
      err
    );

    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  startStream,
  endStream,
  getStreamHistory
};
