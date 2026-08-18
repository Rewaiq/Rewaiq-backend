const pool = require('../config/db');

const REQUIRED_SECONDS = 60;
const DAILY_CAP = 500;

// Expected heartbeat roughly every 5 seconds.
const HEARTBEAT_INTERVAL = 5;

// Maximum gap we are willing to credit.
const HEARTBEAT_TOLERANCE = 10;

// Challenge appears between 20 and 40 seconds.
const CHALLENGE_MIN_SECONDS = 20;
const CHALLENGE_MAX_SECONDS = 40;

// Sessions older than this are considered stale.
const STALE_SESSION_MINUTES = 10;


// ============================================================
// HELPER
// ============================================================

function getChallengeDueSecond(sessionId) {
  const numericId = Number(sessionId) || 1;

  const range =
    CHALLENGE_MAX_SECONDS -
    CHALLENGE_MIN_SECONDS +
    1;

  return (
    CHALLENGE_MIN_SECONDS +
    (numericId % range)
  );
}


// ============================================================
// START STREAM
// ============================================================

const startStream = async (req, res) => {
  const {
    track_id,
    track_url
  } = req.body;

  try {
    const userId = req.user.id;

    if (!track_id) {
      return res.status(400).json({
        message: 'Track ID is required'
      });
    }

    // --------------------------------------------------------
    // Verify track
    // --------------------------------------------------------

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
        message:
          'This track is no longer available for streaming'
      });
    }

    // --------------------------------------------------------
    // Clean stale active sessions
    // --------------------------------------------------------

    await pool.query(
      `
      UPDATE stream_sessions
      SET
        status = 'failed',
        end_time = NOW(),
        duration_seconds =
          GREATEST(
            0,
            EXTRACT(
              EPOCH FROM
              (NOW() - start_time)
            )::integer
          ),
        coins_earned = 0
      WHERE user_id = $1
        AND status = 'active'
        AND start_time <
          NOW() -
          INTERVAL '${STALE_SESSION_MINUTES} minutes'
      `,
      [userId]
    );

    // --------------------------------------------------------
    // Prevent multiple active sessions
    // --------------------------------------------------------

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
      [userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        message:
          'You already have an active stream session',
        session_id:
          existing.rows[0].id,
        track_id:
          existing.rows[0].track_id
      });
    }

    // --------------------------------------------------------
    // One rewarded stream per track per day
    // --------------------------------------------------------

    const alreadyStreamed =
      await pool.query(
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
          userId,
          track_id
        ]
      );

    if (alreadyStreamed.rows.length > 0) {
      return res.status(400).json({
        message:
          'You have already streamed this track today. Try another track or come back tomorrow.'
      });
    }

    // --------------------------------------------------------
    // Create session
    //
    // IMPORTANT:
    //
    // valid_seconds starts at 0.
    //
    // The session does NOT earn time simply because
    // the Start button was clicked.
    // --------------------------------------------------------

    const sessionResult =
      await pool.query(
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
          NULL,
          0,
          TRUE,
          FALSE,
          NULL
        )
        RETURNING *
        `,
        [
          userId,
          track_id,
          track_url || null
        ]
      );

    const session =
      sessionResult.rows[0];

    // --------------------------------------------------------
    // Generate challenge based on REAL session ID
    // --------------------------------------------------------

    const challengeDue =
      getChallengeDueSecond(
        session.id
      );

    await pool.query(
      `
      UPDATE stream_sessions
      SET challenge_answer = $1
      WHERE id = $2
      `,
      [
        String(challengeDue),
        session.id
      ]
    );

    return res.status(201).json({
      success: true,

      message:
        'Stream session created. Start playback to begin verification.',

      session: {
        id: session.id,
        track_id: session.track_id,
        start_time: session.start_time,
        status: session.status,
        required_seconds: REQUIRED_SECONDS,

        // Important for frontend onboarding.
        playback_confirmation_required: true,

        challenge_required: true
      }
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


// ============================================================
// HEARTBEAT
// ============================================================

const heartbeatStream = async (
  req,
  res
) => {
  const {
    session_id,
    visible,
    focused,
    challenge_response
  } = req.body;

  try {
    const userId = req.user.id;

    if (!session_id) {
      return res.status(400).json({
        message:
          'Session ID is required'
      });
    }

    // --------------------------------------------------------
    // Get session
    // --------------------------------------------------------

    const sessionResult =
      await pool.query(
        `
        SELECT *
        FROM stream_sessions
        WHERE id = $1
          AND user_id = $2
        `,
        [
          session_id,
          userId
        ]
      );

    if (
      sessionResult.rows.length === 0
    ) {
      return res.status(404).json({
        message:
          'Stream session not found'
      });
    }

    const session =
      sessionResult.rows[0];

    if (
      session.status !== 'active'
    ) {
      return res.status(400).json({
        message:
          'This stream session is no longer active'
      });
    }

    // --------------------------------------------------------
    // Server time
    // --------------------------------------------------------

    const nowResult =
      await pool.query(
        `
        SELECT NOW() AS now
        `
      );

    const serverNow =
      new Date(
        nowResult.rows[0].now
      );

    const startTime =
      new Date(
        session.start_time
      );

    const elapsedSeconds =
      Math.max(
        0,
        Math.floor(
          (
            serverNow.getTime() -
            startTime.getTime()
          ) / 1000
        )
      );

    // --------------------------------------------------------
    // Challenge
    // --------------------------------------------------------

    const challengeDue =
      parseInt(
        session.challenge_answer || '30',
        10
      );

    let challengePassed =
      session.challenge_passed === true;

    const challengeIsDue =
      elapsedSeconds >=
      challengeDue;

    if (
      session.challenge_required &&
      !challengePassed &&
      challengeIsDue &&
      challenge_response === true
    ) {
      challengePassed = true;

      await pool.query(
        `
        UPDATE stream_sessions
        SET challenge_passed = TRUE
        WHERE id = $1
        `,
        [session_id]
      );
    }

    // --------------------------------------------------------
    // Determine whether page is genuinely active
    // --------------------------------------------------------

    const isActive =
      visible === true &&
      focused === true;

    let addedSeconds = 0;

    if (isActive) {

      // ------------------------------------------------------
      // First heartbeat
      // ------------------------------------------------------

      if (!session.last_heartbeat) {

        /*
         * IMPORTANT:
         *
         * We don't credit the entire time between
         * session creation and first heartbeat.
         *
         * We only credit one normal heartbeat interval.
         */

        addedSeconds =
          Math.min(
            HEARTBEAT_INTERVAL,
            elapsedSeconds
          );

      } else {

        // ----------------------------------------------------
        // Existing heartbeat
        // ----------------------------------------------------

        const lastHeartbeat =
          new Date(
            session.last_heartbeat
          );

        const gapSeconds =
          Math.floor(
            (
              serverNow.getTime() -
              lastHeartbeat.getTime()
            ) / 1000
          );

        /*
         * Normal:
         *
         * 5 sec = credit
         * 7 sec = credit
         * 10 sec = credit
         *
         * Huge gap:
         *
         * 30 sec = don't credit
         */

        if (
          gapSeconds > 0 &&
          gapSeconds <=
            HEARTBEAT_INTERVAL +
            HEARTBEAT_TOLERANCE
        ) {
          addedSeconds =
            Math.min(
              gapSeconds,
              HEARTBEAT_INTERVAL +
                HEARTBEAT_TOLERANCE
            );
        }
      }
    }

    // --------------------------------------------------------
    // Calculate new verified time
    // --------------------------------------------------------

    const currentValidSeconds =
      Number(
        session.valid_seconds || 0
      );

    let newValidSeconds =
      currentValidSeconds +
      addedSeconds;

    newValidSeconds =
      Math.min(
        REQUIRED_SECONDS,
        newValidSeconds
      );

    // --------------------------------------------------------
    // Save heartbeat
    // --------------------------------------------------------

    await pool.query(
      `
      INSERT INTO stream_heartbeats
      (
        session_id,
        user_id,
        heartbeat_at,
        visible,
        focused
      )
      VALUES
      (
        $1,
        $2,
        NOW(),
        $3,
        $4
      )
      `,
      [
        session_id,
        userId,
        Boolean(visible),
        Boolean(focused)
      ]
    );

    // --------------------------------------------------------
    // Update session
    // --------------------------------------------------------

    await pool.query(
      `
      UPDATE stream_sessions
      SET
        valid_seconds = $1,
        last_heartbeat = NOW(),
        heartbeat_count =
          COALESCE(
            heartbeat_count,
            0
          ) + 1
      WHERE id = $2
      `,
      [
        newValidSeconds,
        session_id
      ]
    );

    // --------------------------------------------------------
    // Challenge state
    // --------------------------------------------------------

    const challengeRequiredNow =
      session.challenge_required &&
      !challengePassed &&
      challengeIsDue;

    const complete =
      newValidSeconds >=
        REQUIRED_SECONDS &&
      challengePassed;

    return res.json({
      success: true,

      valid_seconds:
        newValidSeconds,

      required_seconds:
        REQUIRED_SECONDS,

      seconds_remaining:
        Math.max(
          REQUIRED_SECONDS -
            newValidSeconds,
          0
        ),

      challenge_required:
        Boolean(
          challengeRequiredNow
        ),

      challenge_passed:
        challengePassed,

      complete,

      verified:
        isActive,

      heartbeat_count:
        Number(
          session.heartbeat_count || 0
        ) + 1
    });

  } catch (err) {
    console.error(
      'Heartbeat error:',
      err
    );

    return res.status(500).json({
      message:
        'Server error'
    });
  }
};


// ============================================================
// END STREAM
// ============================================================

const endStream = async (
  req,
  res
) => {

  const {
    session_id
  } = req.body;

  const client =
    await pool.connect();

  try {

    if (!session_id) {
      return res.status(400).json({
        message:
          'Session ID is required'
      });
    }

    await client.query(
      'BEGIN'
    );

    // --------------------------------------------------------
    // Lock session
    // --------------------------------------------------------

    const sessionResult =
      await client.query(
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

    if (
      sessionResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        message:
          'Session not found'
      });
    }

    const session =
      sessionResult.rows[0];

    if (
      session.status !== 'active'
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(400).json({
        message:
          'Session already ended'
      });
    }

    // --------------------------------------------------------
    // Verified time
    // --------------------------------------------------------

    const validSeconds =
      Number(
        session.valid_seconds || 0
      );

    // --------------------------------------------------------
    // Challenge
    // --------------------------------------------------------

    const challengePassed =
      session.challenge_required
        ? session.challenge_passed === true
        : true;

    // --------------------------------------------------------
    // Insufficient verified time
    // --------------------------------------------------------

    if (
      validSeconds <
      REQUIRED_SECONDS
    ) {

      await client.query(
        `
        UPDATE stream_sessions
        SET
          status = 'failed',
          end_time = NOW(),
          duration_seconds =
            GREATEST(
              0,
              EXTRACT(
                EPOCH FROM
                (NOW() - start_time)
              )::integer
            ),
          coins_earned = 0
        WHERE id = $1
        `,
        [session_id]
      );

      await client.query(
        'COMMIT'
      );

      return res.status(400).json({
        message:
          'Not enough verified listening time.',

        valid_seconds:
          validSeconds,

        required_seconds:
          REQUIRED_SECONDS,

        coins_earned: 0
      });
    }

    // --------------------------------------------------------
    // Challenge not passed
    // --------------------------------------------------------

    if (!challengePassed) {

      await client.query(
        `
        UPDATE stream_sessions
        SET
          status = 'failed',
          end_time = NOW(),
          duration_seconds =
            GREATEST(
              0,
              EXTRACT(
                EPOCH FROM
                (NOW() - start_time)
              )::integer
            ),
          coins_earned = 0
        WHERE id = $1
        `,
        [session_id]
      );

      await client.query(
        'COMMIT'
      );

      return res.status(400).json({
        message:
          'Please confirm that you are still listening before completing the stream.',

        challenge_required:
          true,

        coins_earned:
          0
      });
    }

    // --------------------------------------------------------
    // Get reward
    // --------------------------------------------------------

    let coinsToAward = 30;

    const trackResult =
      await client.query(
        `
        SELECT
          campaign_coins,
          total_streams,
          target_streams
        FROM tracks
        WHERE id = $1
        FOR UPDATE
        `,
        [session.track_id]
      );

    if (
      trackResult.rows.length > 0
    ) {

      const track =
        trackResult.rows[0];

      if (
        track.campaign_coins !== null
      ) {
        coinsToAward =
          parseInt(
            track.campaign_coins,
            10
          );
      }
    }

    if (
      !Number.isFinite(
        coinsToAward
      ) ||
      coinsToAward < 0
    ) {
      coinsToAward = 30;
    }

    // --------------------------------------------------------
    // Daily earnings
    // --------------------------------------------------------

    const earnedResult =
      await client.query(
        `
        SELECT
          COALESCE(
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

    // --------------------------------------------------------
    // Daily cap
    // --------------------------------------------------------

    if (
      todayTotal >= DAILY_CAP
    ) {

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
          validSeconds,
          session_id
        ]
      );

      await client.query(
        'COMMIT'
      );

      return res.json({
        message:
          'Daily earning limit reached. Come back tomorrow!',

        coins_earned: 0,

        daily_cap_reached:
          true,

        coins_earned_today:
          todayTotal,

        daily_cap:
          DAILY_CAP
      });
    }

    const actualCoins =
      Math.min(
        coinsToAward,
        DAILY_CAP -
          todayTotal
      );

    // --------------------------------------------------------
    // Complete session
    // --------------------------------------------------------

    await client.query(
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
        validSeconds,
        actualCoins,
        session_id
      ]
    );

    // --------------------------------------------------------
    // Increment track streams
    // --------------------------------------------------------

    if (session.track_id) {

      const updatedTrackResult =
        await client.query(
          `
          UPDATE tracks
          SET
            total_streams =
              COALESCE(
                total_streams,
                0
              ) + 1
          WHERE id = $1
          RETURNING
            total_streams,
            target_streams
          `,
          [session.track_id]
        );

      const updatedTrack =
        updatedTrackResult.rows[0];

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
          [session.track_id]
        );
      }
    }

    // --------------------------------------------------------
    // Credit wallet
    // --------------------------------------------------------

    await client.query(
      `
      UPDATE users
      SET
        coin_balance =
          COALESCE(
            coin_balance,
            0
          ) + $1
      WHERE id = $2
      `,
      [
        actualCoins,
        req.user.id
      ]
    );

    // --------------------------------------------------------
    // Transaction
    // --------------------------------------------------------

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
          track_id:
            session.track_id,

          session_id:
            session_id,

          verified_seconds:
            validSeconds,

          verification:
            'heartbeat'
        })
      ]
    );

    // --------------------------------------------------------
    // Get new balance
    // --------------------------------------------------------

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

    await client.query(
      'COMMIT'
    );

    return res.json({
      success: true,

      message:
        `Stream complete! ${actualCoins} coins earned`,

      duration_seconds:
        validSeconds,

      verified_seconds:
        validSeconds,

      coins_earned:
        actualCoins,

      coin_balance:
        newBalance,

      coins_earned_today:
        todayTotal +
        actualCoins,

      daily_cap:
        DAILY_CAP,

      daily_cap_reached:
        false
    });

  } catch (err) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch (_) {}

    console.error(
      'End stream error:',
      err
    );

    return res.status(500).json({
      message:
        'Server error'
    });

  } finally {
    client.release();
  }
};


// ============================================================
// STREAM HISTORY
// ============================================================

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
        ORDER BY
          s.start_time DESC
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
      message:
        'Server error'
    });
  }
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  startStream,
  heartbeatStream,
  endStream,
  getStreamHistory
};
