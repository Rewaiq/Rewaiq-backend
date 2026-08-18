const pool = require('../config/db');

const MIN_STREAM_SECONDS = 60;
const DAILY_CAP = 500;
const STALE_SESSION_MINUTES = 10;

// Heartbeat should normally arrive every 5 seconds.
// We allow up to 15 seconds between heartbeats.
const MAX_HEARTBEAT_GAP = 15;

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
        duration_seconds = LEAST(
          COALESCE(valid_seconds, 0),
          $1
        )
      WHERE user_id = $2
        AND status = 'active'
        AND start_time < NOW() - INTERVAL '${STALE_SESSION_MINUTES} minutes'
      `,
      [
        MIN_STREAM_SECONDS,
        req.user.id
      ]
    );

    // -----------------------------------------------------
    // Check for an existing active session
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
      [
        req.user.id,
        track_id
      ]
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
        coins_earned,
        valid_seconds,
        last_heartbeat,
        heartbeat_count,
        challenge_required,
        challenge_passed,
        challenge_answer
      )
      VALUES
      (
        $1,
        $2,
        $3,
        NOW(),
        'active',
        0,
        0,
        0,
        NOW(),
        0,
        FALSE,
        FALSE,
        NULL
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
      message: 'Server error'
    });
  }
};


// =========================================================
// STREAM HEARTBEAT
// =========================================================

const heartbeatStream = async (req, res) => {
  const {
    session_id,
    visible,
    focused
  } = req.body;

  try {
    if (!session_id) {
      return res.status(400).json({
        message: 'Session ID is required'
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        start_time,
        last_heartbeat,
        valid_seconds,
        heartbeat_count,
        challenge_required,
        challenge_passed,
        status
      FROM stream_sessions
      WHERE id = $1
        AND user_id = $2
      `,
      [
        session_id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Stream session not found'
      });
    }

    const session = result.rows[0];

    if (session.status !== 'active') {
      return res.status(400).json({
        message: 'Stream session is no longer active'
      });
    }

    const now = Date.now();

    const previousHeartbeat = session.last_heartbeat
      ? new Date(session.last_heartbeat).getTime()
      : new Date(session.start_time).getTime();

    let elapsed = Math.floor(
      (now - previousHeartbeat) / 1000
    );

    // -----------------------------------------------------
    // Protect against invalid client timing
    // -----------------------------------------------------

    if (elapsed < 0) {
      elapsed = 0;
    }

    if (elapsed > MAX_HEARTBEAT_GAP) {
      elapsed = 0;
    }

    // -----------------------------------------------------
    // Only credit visible + focused time
    // -----------------------------------------------------

    const isActive =
      visible === true &&
      focused === true;

    const creditedSeconds =
      isActive ? elapsed : 0;

    const currentValidSeconds =
      Number(session.valid_seconds || 0);

    const newValidSeconds =
      Math.min(
        MIN_STREAM_SECONDS,
        currentValidSeconds + creditedSeconds
      );

    const heartbeatCount =
      Number(session.heartbeat_count || 0) + 1;

    // -----------------------------------------------------
    // Create attention challenge
    //
    // We trigger it after approximately 25 seconds.
    // -----------------------------------------------------

    let challengeRequired =
      session.challenge_required;

    let challengeAnswer =
      session.challenge_answer;

    let challengeQuestion = null;

    if (
      !challengeRequired &&
      !session.challenge_passed &&
      newValidSeconds >= 25
    ) {
      const a =
        Math.floor(Math.random() * 5) + 1;

      const b =
        Math.floor(Math.random() * 5) + 1;

      challengeQuestion =
        `What is ${a} + ${b}?`;

      challengeAnswer =
        String(a + b);

      challengeRequired = true;
    }

    // -----------------------------------------------------
    // Store heartbeat
    // -----------------------------------------------------

    await pool.query(
      `
      UPDATE stream_sessions
      SET
        valid_seconds = $1,
        last_heartbeat = NOW(),
        heartbeat_count = $2,
        challenge_required = $3,
        challenge_answer = $4
      WHERE id = $5
        AND user_id = $6
        AND status = 'active'
      `,
      [
        newValidSeconds,
        heartbeatCount,
        challengeRequired,
        challengeAnswer,
        session_id,
        req.user.id
      ]
    );

    return res.json({
      message: 'Heartbeat accepted',
      valid_seconds: newValidSeconds,
      required_seconds: MIN_STREAM_SECONDS,
      challenge_required:
        challengeRequired &&
        !session.challenge_passed,
      challenge_question:
        challengeQuestion
    });

  } catch (err) {
    console.error(
      'Stream heartbeat error:',
      err
    );

    return res.status(500).json({
      message: 'Server error'
    });
  }
};


// =========================================================
// SUBMIT ATTENTION CHALLENGE
// =========================================================

const submitStreamChallenge = async (
  req,
  res
) => {
  const {
    session_id,
    answer
  } = req.body;

  try {
    if (!session_id) {
      return res.status(400).json({
        message: 'Session ID is required'
      });
    }

    if (
      answer === undefined ||
      answer === null
    ) {
      return res.status(400).json({
        message: 'Answer is required'
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        challenge_required,
        challenge_passed,
        challenge_answer,
        status
      FROM stream_sessions
      WHERE id = $1
        AND user_id = $2
      `,
      [
        session_id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Stream session not found'
      });
    }

    const session = result.rows[0];

    if (session.status !== 'active') {
      return res.status(400).json({
        message: 'Stream session is no longer active'
      });
    }

    if (session.challenge_passed) {
      return res.json({
        message: 'Challenge already completed',
        passed: true
      });
    }

    if (!session.challenge_required) {
      return res.status(400).json({
        message: 'No challenge is currently required'
      });
    }

    const correct =
      String(answer).trim() ===
      String(session.challenge_answer).trim();

    if (!correct) {
      return res.status(400).json({
        message: 'Incorrect answer',
        passed: false
      });
    }

    await pool.query(
      `
      UPDATE stream_sessions
      SET
        challenge_passed = TRUE,
        challenge_required = FALSE,
        challenge_answer = NULL
      WHERE id = $1
        AND user_id = $2
        AND status = 'active'
      `,
      [
        session_id,
        req.user.id
      ]
    );

    return res.json({
      message: 'Challenge passed',
      passed: true
    });

  } catch (err) {
    console.error(
      'Stream challenge error:',
      err
    );

    return res.status(500).json({
      message: 'Server error'
    });
  }
};


// =========================================================
// END STREAM SESSION
// =========================================================

const endStream = async (req, res) => {
  const { session_id } = req.body;

  const client = await pool.connect();

  try {
    if (!session_id) {
      return res.status(400).json({
        message: 'Session ID is required'
      });
    }

    await client.query('BEGIN');

    // -----------------------------------------------------
    // Lock session
    // -----------------------------------------------------

    const sessionResult = await client.query(
      `
      SELECT *
      FROM stream_sessions
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [
        session_id,
        req.user.id
      ]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        message: 'Session not found'
      });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'active') {
      await client.query('ROLLBACK');

      return res.status(400).json({
        message: 'Session already ended'
      });
    }

    // -----------------------------------------------------
    // IMPORTANT:
    //
    // Do NOT use Date.now() - start_time.
    //
    // The backend now relies on valid_seconds.
    // -----------------------------------------------------

    const durationSeconds =
      Number(session.valid_seconds || 0);

    // -----------------------------------------------------
    // Require attention challenge
    // -----------------------------------------------------

    if (!session.challenge_passed) {
      await client.query(
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

      await client.query('COMMIT');

      return res.status(400).json({
        message:
          'Please complete the listening verification before ending the stream.',
        streamed_seconds:
          durationSeconds,
        required_seconds:
          MIN_STREAM_SECONDS
      });
    }

    // -----------------------------------------------------
    // Minimum valid duration
    // -----------------------------------------------------

    if (
      durationSeconds <
      MIN_STREAM_SECONDS
    ) {
      await client.query(
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

      await client.query('COMMIT');

      return res.status(400).json({
        message:
          'Stream too short — minimum 60 seconds of verified engagement required',
        streamed_seconds:
          durationSeconds,
        required_seconds:
          MIN_STREAM_SECONDS
      });
    }

    const trackId =
      session.track_id;

    // -----------------------------------------------------
    // Get track reward
    // -----------------------------------------------------

    let coinsToAward = 30;

    if (trackId) {
      const trackResult =
        await client.query(
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
        coinsToAward =
          parseInt(
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

    const earnedResult =
      await client.query(
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

    const todayTotal =
      parseInt(
        earnedResult.rows[0]?.total || 0,
        10
      );

    // -----------------------------------------------------
    // Daily cap
    // -----------------------------------------------------

    if (todayTotal >= DAILY_CAP) {
      await client.query(
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

      await client.query('COMMIT');

      return res.json({
        message:
          'Daily earning limit reached. Come back tomorrow!',
        coins_earned: 0,
        daily_cap_reached: true,
        coins_earned_today:
          todayTotal,
        daily_cap:
          DAILY_CAP
      });
    }

    const actualCoins =
      Math.min(
        coinsToAward,
        DAILY_CAP - todayTotal
      );

    // -----------------------------------------------------
    // Complete session
    // -----------------------------------------------------

    await client.query(
      `
      UPDATE stream_sessions
      SET
        status = 'completed',
        end_time = NOW(),
        duration_seconds = $1,
        coins_earned = $2
      WHERE id = $3
        AND status = 'active'
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
      await client.query(
        `
        UPDATE tracks
        SET total_streams =
          COALESCE(total_streams, 0) + 1
        WHERE id = $1
        `,
        [trackId]
      );

      const trackData =
        await client.query(
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
        await client.query(
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
    // Credit wallet
    // -----------------------------------------------------

    await client.query(
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

    await client.query(
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
      await client.query(
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

    await client.query('COMMIT');

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
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        'Rollback error:',
        rollbackError
      );
    }

    console.error(
      'End stream error:',
      err
    );

    return res.status(500).json({
      message: 'Server error'
    });

  } finally {
    client.release();
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
      message: 'Server error'
    });
  }
};


// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  startStream,
  heartbeatStream,
  submitStreamChallenge,
  endStream,
  getStreamHistory
};
