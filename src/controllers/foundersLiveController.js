
const pool = require('../config/db');
const crypto = require('crypto');

const CAMPAIGN_ID = 'founders-live-2026';
const CAMPAIGN_TITLE = 'Founders Live 2026';
const VOTING_URL =
  'https://votefounderslive.com/?video=57932c57-f700-4ed5-9ecb-f2ff8e52c1bd';

const REWARD_50 = Math.max(
  0,
  parseInt(process.env.FOUNDERS_LIVE_50_REWARD_COINS || '5', 10) || 0
);
const REWARD_100 = Math.max(
  0,
  parseInt(process.env.FOUNDERS_LIVE_100_REWARD_COINS || '10', 10) || 0
);

// Campaign window: Nigeria time.
// The end is exclusive: submissions close at midnight on December 3.
const CAMPAIGN_START = new Date('2026-11-02T00:00:00+01:00');
const CAMPAIGN_END = new Date('2026-12-03T00:00:00+01:00');

function campaignIsOpen() {
  const now = Date.now();
  return now >= CAMPAIGN_START.getTime() &&
    now < CAMPAIGN_END.getTime();
}

function hashVoterReference(value) {
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

async function ensureSupporter(client, userId) {
  const existing = await client.query(
    `SELECT id, user_id, campaign_id, supporter_code, created_at
       FROM founders_live_supporter_codes
      WHERE user_id = $1 AND campaign_id = $2
      LIMIT 1`,
    [userId, CAMPAIGN_ID]
  );

  if (existing.rows[0]) return existing.rows[0];

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = `FL${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

    const inserted = await client.query(
      `INSERT INTO founders_live_supporter_codes
         (user_id, campaign_id, supporter_code)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, user_id, campaign_id, supporter_code, created_at`,
      [userId, CAMPAIGN_ID, code]
    );

    if (inserted.rows[0]) return inserted.rows[0];

    const retry = await client.query(
      `SELECT id, user_id, campaign_id, supporter_code, created_at
         FROM founders_live_supporter_codes
        WHERE user_id = $1 AND campaign_id = $2
        LIMIT 1`,
      [userId, CAMPAIGN_ID]
    );

    if (retry.rows[0]) return retry.rows[0];
  }

  throw new Error('Unable to create or retrieve supporter code.');
}

async function getProgress(client, userId) {
  const counts = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_votes,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_votes,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_votes
     FROM founders_live_vote_submissions
     WHERE campaign_id = $1 AND supporter_user_id = $2`,
    [CAMPAIGN_ID, userId]
  );

  const rewards = await client.query(
    `SELECT milestone, coins_awarded, transaction_id, created_at
       FROM founders_live_milestone_rewards
      WHERE campaign_id = $1 AND user_id = $2
      ORDER BY milestone`,
    [CAMPAIGN_ID, userId]
  );

  const row = counts.rows[0];
  const approved = Number(row.approved_votes || 0);
  const earned = rewards.rows.reduce(
    (sum, reward) => sum + Number(reward.coins_awarded || 0),
    0
  );

  return {
    verified_votes: approved,
    approved_votes: approved,
    pending_votes: Number(row.pending_votes || 0),
    rejected_votes: Number(row.rejected_votes || 0),
    next_milestone: approved < 50 ? 50 : approved < 100 ? 100 : null,
    coins_earned: earned,
    milestones: rewards.rows
  };
}

// GET /api/founders-live/me
const getMyProgress = async (req, res) => {
  try {
    const supporter = await ensureSupporter(pool, req.user.id);
    const progress = await getProgress(pool, req.user.id);

    return res.json({
      campaign: {
        id: CAMPAIGN_ID,
        title: CAMPAIGN_TITLE,
        voting_url: VOTING_URL,
        starts_at: CAMPAIGN_START.toISOString(),
        ends_at: CAMPAIGN_END.toISOString(),
        is_open: campaignIsOpen()
      },
      supporter_code: supporter.supporter_code,
      progress
    });
  } catch (err) {
    console.error('Founders Live progress error:', err);
    return res.status(500).json({
      message: 'Unable to load voter progress.'
    });
  }
};

// POST /api/founders-live/votes
const submitVoteProof = async (req, res) => {
  const voterCode =
    typeof req.body.voter_code === 'string'
      ? req.body.voter_code.trim()
      : '';

  const submittedSupporterCode =
    typeof req.body.supporter_code === 'string'
      ? req.body.supporter_code.trim().toUpperCase()
      : '';

  const proofUrl =
    typeof req.body.proof_url === 'string'
      ? req.body.proof_url.trim()
      : '';

  const notes =
    typeof req.body.evidence_notes === 'string'
      ? req.body.evidence_notes.trim().slice(0, 1000)
      : '';

  if (!voterCode && !proofUrl) {
    return res.status(400).json({
      message: 'Provide a voting code or screenshot proof URL.'
    });
  }

  if (
    voterCode.length > 200 ||
    proofUrl.length > 2000 ||
    submittedSupporterCode.length > 100
  ) {
    return res.status(400).json({
      message: 'Voting code, supporter code, or proof URL is too long.'
    });
  }

  if (proofUrl && !/^https:\/\/\S+$/i.test(proofUrl)) {
    return res.status(400).json({
      message: 'Proof URL must be a valid HTTPS URL.'
    });
  }

  if (!campaignIsOpen()) {
    return res.status(400).json({
      message: 'The Founders Live voting campaign is not currently open.'
    });
  }

  try {
    let supporter;

    if (submittedSupporterCode) {
      const matched = await pool.query(
        `SELECT id, user_id, campaign_id, supporter_code
           FROM founders_live_supporter_codes
          WHERE campaign_id = $1
            AND UPPER(supporter_code) = $2
          LIMIT 1`,
        [CAMPAIGN_ID, submittedSupporterCode]
      );

      if (!matched.rows[0]) {
        return res.status(400).json({
          message: 'Supporter code not found for this campaign.'
        });
      }

      supporter = matched.rows[0];
    } else {
      supporter = await ensureSupporter(pool, req.user.id);
    }

    // Store only a hash of the supplied voter reference.
    // If no voter code exists, generate a unique reference for this submission.
    // Screenshot-only submissions still require manual review for duplicate detection.
    const reference = voterCode
      ? hashVoterReference(voterCode)
      : crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO founders_live_vote_submissions
         (
           campaign_id,
           supporter_user_id,
           voter_reference_hash,
           evidence_url,
           evidence_notes,
           status
         )
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, status, created_at`,
      [
        CAMPAIGN_ID,
        supporter.user_id,
        reference,
        proofUrl || null,
        notes || null
      ]
    );

    return res.status(201).json({
      message: 'Vote evidence submitted for review. It counts only after approval.',
      attributed_to: supporter.supporter_code,
      submission: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        message: 'That voter reference has already been submitted for this campaign.'
      });
    }

    console.error('Founders Live vote submission error:', err);
    return res.status(500).json({
      message: 'Unable to submit vote evidence.'
    });
  }
};

// Admin middleware: verify role against the database.
const requireAdmin = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.user.id]
    );

    const role = String(result.rows[0]?.role || '').toLowerCase();

    if (!['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({
        message: 'Admin access required.'
      });
    }

    return next();
  } catch (err) {
    console.error('Admin role check failed:', err);
    return res.status(500).json({
      message: 'Unable to verify permissions.'
    });
  }
};

// GET /api/founders-live/admin/submissions/pending
const getPendingVotes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         v.id,
         v.campaign_id,
         v.evidence_url AS proof_url,
         v.evidence_notes,
         v.status,
         v.created_at,
         s.supporter_code,
         u.id AS supporter_user_id,
         u.full_name AS supporter_name,
         u.email AS supporter_email
       FROM founders_live_vote_submissions v
       JOIN founders_live_supporter_codes s
         ON s.user_id = v.supporter_user_id
        AND s.campaign_id = v.campaign_id
       JOIN users u ON u.id = v.supporter_user_id
       WHERE v.campaign_id = $1
         AND v.status = 'pending'
       ORDER BY v.created_at ASC`,
      [CAMPAIGN_ID]
    );

    return res.json({ submissions: result.rows });
  } catch (err) {
    console.error('Founders Live pending votes error:', err);
    return res.status(500).json({
      message: 'Unable to load pending submissions.'
    });
  }
};

// PATCH /api/founders-live/admin/submissions/:id/review
const reviewVote = async (req, res) => {
  const voteId = Number(req.params.id);
  const decision = req.body.decision;
  const note =
    typeof req.body.note === 'string'
      ? req.body.note.trim().slice(0, 1000)
      : null;

  if (
    !Number.isSafeInteger(voteId) ||
    voteId <= 0 ||
    !['approve', 'reject'].includes(decision)
  ) {
    return res.status(400).json({
      message: 'A valid vote ID and approve/reject decision are required.'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT *
         FROM founders_live_vote_submissions
        WHERE id = $1 AND campaign_id = $2
        FOR UPDATE`,
      [voteId, CAMPAIGN_ID]
    );

    if (!found.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        message: 'Vote submission not found.'
      });
    }

    const vote = found.rows[0];

    if (vote.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'This submission has already been reviewed.'
      });
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected';

    await client.query(
      `UPDATE founders_live_vote_submissions
          SET status = $1,
              reviewed_by = $2,
              reviewed_at = NOW(),
              review_notes = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [newStatus, String(req.user.id), note, voteId]
    );

    const awarded = [];

    if (decision === 'approve') {
      // Serialize milestone calculations for this supporter.
      await client.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [vote.supporter_user_id]
      );

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total
           FROM founders_live_vote_submissions
          WHERE campaign_id = $1
            AND supporter_user_id = $2
            AND status = 'approved'`,
        [CAMPAIGN_ID, vote.supporter_user_id]
      );

      const total = Number(countResult.rows[0].total);

      const milestones = [
        { count: 50, coins: REWARD_50 },
        { count: 100, coins: REWARD_100 }
      ];

      for (const milestone of milestones) {
        if (total < milestone.count || milestone.coins <= 0) {
          continue;
        }

        // The unique (campaign_id, user_id, milestone) constraint
        // guarantees that a milestone can only be rewarded once.
        const reward = await client.query(
          `INSERT INTO founders_live_milestone_rewards
             (campaign_id, user_id, milestone, coins_awarded)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (campaign_id, user_id, milestone) DO NOTHING
           RETURNING id`,
          [
            CAMPAIGN_ID,
            vote.supporter_user_id,
            milestone.count,
            milestone.coins
          ]
        );

        if (!reward.rows[0]) continue;

        const balance = await client.query(
          `UPDATE users
              SET coin_balance = COALESCE(coin_balance, 0) + $1
            WHERE id = $2
            RETURNING id`,
          [milestone.coins, vote.supporter_user_id]
        );

        if (!balance.rows[0]) {
          throw new Error(
            `User ${vote.supporter_user_id} was not found while awarding milestone.`
          );
        }

        const tx = await client.query(
          `INSERT INTO transactions
             (user_id, amount, type, status, metadata, created_at)
           VALUES ($1, $2, 'founders_live_reward', 'completed', $3, NOW())
           RETURNING id`,
          [
            vote.supporter_user_id,
            milestone.coins,
            JSON.stringify({
              campaign_id: CAMPAIGN_ID,
              milestone: milestone.count,
              approved_votes: total,
              source: 'founders_live_milestone'
            })
          ]
        );

        await client.query(
          `UPDATE founders_live_milestone_rewards
              SET transaction_id = $1
            WHERE id = $2`,
          [tx.rows[0].id, reward.rows[0].id]
        );

        awarded.push({
          milestone: milestone.count,
          coins: milestone.coins
        });
      }
    }

    await client.query('COMMIT');

    return res.json({
      message: decision === 'approve'
        ? 'Vote verified.'
        : 'Vote evidence rejected.',
      status: newStatus,
      approved_votes_after_review: decision === 'approve'
        ? Number((
            await pool.query(
              `SELECT COUNT(*)::int AS total
                 FROM founders_live_vote_submissions
                WHERE campaign_id = $1
                  AND supporter_user_id = $2
                  AND status = 'approved'`,
              [CAMPAIGN_ID, vote.supporter_user_id]
            )
          ).rows[0].total)
        : undefined,
      coins_awarded: awarded
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Founders Live rollback error:', rollbackErr);
    }

    console.error('Founders Live vote review error:', err);
    return res.status(500).json({
      message: 'Unable to review submission.'
    });
  } finally {
    client.release();
  }
};

// GET /api/founders-live/admin/overview
const getCampaignOverview = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(DISTINCT user_id)::int
            FROM founders_live_supporter_codes
           WHERE campaign_id = $1) AS supporters,
         (SELECT COUNT(*)::int
            FROM founders_live_vote_submissions
           WHERE campaign_id = $1 AND status = 'approved') AS verified_votes,
         (SELECT COUNT(*)::int
            FROM founders_live_vote_submissions
           WHERE campaign_id = $1 AND status = 'pending') AS pending_submissions,
         (SELECT COUNT(*)::int
            FROM founders_live_vote_submissions
           WHERE campaign_id = $1 AND status = 'rejected') AS rejected_submissions,
         (SELECT COALESCE(SUM(coins_awarded), 0)::int
            FROM founders_live_milestone_rewards
           WHERE campaign_id = $1) AS total_coins_awarded`,
      [CAMPAIGN_ID]
    );

    return res.json({
      campaign: {
        id: CAMPAIGN_ID,
        title: CAMPAIGN_TITLE,
        voting_url: VOTING_URL,
        starts_at: CAMPAIGN_START.toISOString(),
        ends_at: CAMPAIGN_END.toISOString(),
        is_open: campaignIsOpen()
      },
      overview: result.rows[0]
    });
  } catch (err) {
    console.error('Founders Live overview error:', err);
    return res.status(500).json({
      message: 'Unable to load campaign overview.'
    });
  }
};

module.exports = {
  getMyProgress,
  submitVoteProof,
  requireAdmin,
  getPendingVotes,
  reviewVote,
  getCampaignOverview
};
