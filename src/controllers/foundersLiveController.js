const pool = require('../config/db');
const crypto = require('crypto');

const CAMPAIGN_SLUG = 'founders-live-2026';
const REWARD_50 = Math.max(0, parseInt(process.env.FOUNDERS_LIVE_50_REWARD_COINS || '5', 10));
const REWARD_100 = Math.max(0, parseInt(process.env.FOUNDERS_LIVE_100_REWARD_COINS || '10', 10));

async function getCampaign(client = pool) {
  const result = await client.query(
    `SELECT * FROM founders_live_campaigns
     WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
    [CAMPAIGN_SLUG]
  );
  return result.rows[0] || null;
}

async function ensureSupporter(client, campaignId, userId) {
  const existing = await client.query(
    `SELECT * FROM founders_live_supporters
     WHERE campaign_id = $1 AND user_id = $2`,
    [campaignId, userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const code = 'FL' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const inserted = await client.query(
    `INSERT INTO founders_live_supporters (campaign_id, user_id, supporter_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (campaign_id, user_id) DO NOTHING
     RETURNING *`,
    [campaignId, userId, code]
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const retry = await client.query(
    `SELECT * FROM founders_live_supporters WHERE campaign_id = $1 AND user_id = $2`,
    [campaignId, userId]
  );
  return retry.rows[0];
}

async function getProgress(client, supporterId) {
  const votes = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved')::int AS verified_votes,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_votes,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_votes
     FROM founders_live_votes WHERE supporter_id = $1`,
    [supporterId]
  );
  const rewards = await client.query(
    `SELECT milestone, coins_awarded, created_at
     FROM founders_live_milestone_rewards
     WHERE supporter_id = $1 ORDER BY milestone`,
    [supporterId]
  );
  const verified = votes.rows[0].verified_votes;
  return {
    verified_votes: verified,
    pending_votes: votes.rows[0].pending_votes,
    rejected_votes: votes.rows[0].rejected_votes,
    next_milestone: verified < 50 ? 50 : verified < 100 ? 100 : null,
    coins_earned: rewards.rows.reduce((sum, r) => sum + Number(r.coins_awarded || 0), 0),
    milestones: rewards.rows
  };
}

// GET campaign and the signed-in user's progress.
const getMyProgress = async (req, res) => {
  try {
    const campaign = await getCampaign();
    if (!campaign) return res.status(404).json({ message: 'Founders Live campaign is not active.' });
    const supporter = await ensureSupporter(pool, campaign.id, req.user.id);
    const progress = await getProgress(pool, supporter.id);
    res.json({
      campaign: {
        title: campaign.title,
        voting_url: campaign.voting_url,
        starts_at: campaign.starts_at,
        ends_at: campaign.ends_at
      },
      supporter_code: supporter.supporter_code,
      progress
    });
  } catch (err) {
    console.error('Founders Live progress error:', err);
    res.status(500).json({ message: 'Unable to load voter progress.' });
  }
};

// Submit one external vote for manual review. This does NOT claim the vote is verified.
const submitVoteProof = async (req, res) => {
  const voterCode = typeof req.body.voter_code === 'string' ? req.body.voter_code.trim() : '';
  const submittedSupporterCode = typeof req.body.supporter_code === 'string' ? req.body.supporter_code.trim().toUpperCase() : '';
  const proofUrl = typeof req.body.proof_url === 'string' ? req.body.proof_url.trim() : '';
  if (!voterCode && !proofUrl) {
    return res.status(400).json({ message: 'Provide a voting code or screenshot proof URL.' });
  }
  if (voterCode.length > 200 || proofUrl.length > 2000) {
    return res.status(400).json({ message: 'Voting code or proof URL is too long.' });
  }
  if (proofUrl && !/^https:\/\/\S+$/i.test(proofUrl)) {
    return res.status(400).json({ message: 'Proof URL must be a valid HTTPS URL.' });
  }

  try {
    const campaign = await getCampaign();
    if (!campaign) return res.status(404).json({ message: 'Founders Live campaign is not active.' });
    const now = Date.now();
    if (campaign.starts_at && now < new Date(campaign.starts_at).getTime()) {
      return res.status(400).json({ message: 'Voting campaign has not started yet.' });
    }
    if (campaign.ends_at && now >= new Date(campaign.ends_at).getTime()) {
      return res.status(400).json({ message: 'Voting campaign has ended.' });
    }

    let supporter;
    if (submittedSupporterCode) {
      const matched = await pool.query(
        `SELECT * FROM founders_live_supporters
         WHERE campaign_id = $1 AND UPPER(supporter_code) = $2`,
        [campaign.id, submittedSupporterCode]
      );
      if (!matched.rows[0]) {
        return res.status(400).json({ message: 'Supporter code not found for this campaign.' });
      }
      supporter = matched.rows[0];
    } else {
      // If no campaign attribution code is entered, attribute the proof to the submitting user.
      supporter = await ensureSupporter(pool, campaign.id, req.user.id);
    }
    const result = await pool.query(
      `INSERT INTO founders_live_votes
       (campaign_id, supporter_id, submitted_by_user_id, voter_code, proof_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
      [campaign.id, supporter.id, req.user.id, voterCode || null, proofUrl || null]
    );
    res.status(201).json({
      message: 'Vote evidence submitted for review. It will count only after approval.',
      attributed_to: supporter.supporter_code,
      submission: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That voting code has already been submitted.' });
    }
    console.error('Founders Live vote submission error:', err);
    res.status(500).json({ message: 'Unable to submit vote evidence.' });
  }
};

// Admin-only: verify role from database, not from client input or JWT claims.
const requireAdmin = async (req, res, next) => {
  try {
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0] || !['admin', 'superadmin'].includes(String(result.rows[0].role).toLowerCase())) {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    next();
  } catch (err) {
    console.error('Admin role check failed:', err);
    res.status(500).json({ message: 'Unable to verify permissions.' });
  }
};

const getPendingVotes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.id, v.voter_code, v.proof_url, v.status, v.created_at,
              s.supporter_code, u.id AS supporter_user_id, u.full_name AS supporter_name,
              u.email AS supporter_email
       FROM founders_live_votes v
       JOIN founders_live_supporters s ON s.id = v.supporter_id
       JOIN users u ON u.id = s.user_id
       WHERE v.status = 'pending'
       ORDER BY v.created_at ASC`
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    console.error('Founders Live pending votes error:', err);
    res.status(500).json({ message: 'Unable to load pending submissions.' });
  }
};

const reviewVote = async (req, res) => {
  const voteId = Number(req.params.id);
  const decision = req.body.decision;
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : null;
  if (!Number.isInteger(voteId) || voteId <= 0 || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ message: 'A valid vote ID and approve/reject decision are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT v.*, s.user_id AS supporter_user_id, s.id AS supporter_id
       FROM founders_live_votes v
       JOIN founders_live_supporters s ON s.id = v.supporter_id
       WHERE v.id = $1 FOR UPDATE OF v`,
      [voteId]
    );
    if (!found.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Vote submission not found.' });
    }
    const vote = found.rows[0];
    if (vote.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This submission has already been reviewed.' });
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected';
    await client.query(
      `UPDATE founders_live_votes
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
       WHERE id = $4`,
      [newStatus, req.user.id, note, voteId]
    );

    const awarded = [];
    if (decision === 'approve') {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM founders_live_votes
         WHERE supporter_id = $1 AND status = 'approved'`,
        [vote.supporter_id]
      );
      const total = countResult.rows[0].total;
      const milestones = [
        { count: 50, coins: REWARD_50 },
        { count: 100, coins: REWARD_100 }
      ];
      for (const milestone of milestones) {
        if (total >= milestone.count && milestone.coins > 0) {
          const inserted = await client.query(
            `INSERT INTO founders_live_milestone_rewards
             (campaign_id, supporter_id, user_id, milestone, coins_awarded)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (campaign_id, supporter_id, milestone) DO NOTHING
             RETURNING id`,
            [vote.campaign_id, vote.supporter_id, vote.supporter_user_id, milestone.count, milestone.coins]
          );
          if (inserted.rows[0]) {
            await client.query(
              `UPDATE users SET coin_balance = COALESCE(coin_balance, 0) + $1 WHERE id = $2`,
              [milestone.coins, vote.supporter_user_id]
            );
            const tx = await client.query(
              `INSERT INTO transactions (user_id, amount, type, status, metadata, created_at)
               VALUES ($1, $2, 'founders_live_reward', 'completed', $3, NOW())
               RETURNING id`,
              [vote.supporter_user_id, milestone.coins, JSON.stringify({
                campaign_slug: CAMPAIGN_SLUG,
                milestone: milestone.count,
                verified_votes: total
              })]
            );
            await client.query(
              `UPDATE founders_live_milestone_rewards SET transaction_id = $1 WHERE id = $2`,
              [tx.rows[0].id, inserted.rows[0].id]
            );
            awarded.push({ milestone: milestone.count, coins: milestone.coins });
          }
        }
      }
    }

    await client.query('COMMIT');
    res.json({
      message: decision === 'approve' ? 'Vote verified.' : 'Vote evidence rejected.',
      status: newStatus,
      coins_awarded: awarded
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Founders Live vote review error:', err);
    res.status(500).json({ message: 'Unable to review submission.' });
  } finally {
    client.release();
  }
};

const getCampaignOverview = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM founders_live_supporters s
         WHERE s.campaign_id = c.id) AS supporters,
        (SELECT COUNT(*)::int FROM founders_live_votes v
         WHERE v.campaign_id = c.id AND v.status = 'approved') AS verified_votes,
        (SELECT COUNT(*)::int FROM founders_live_votes v
         WHERE v.campaign_id = c.id AND v.status = 'pending') AS pending_submissions
       FROM founders_live_campaigns c WHERE c.slug = $1`,
      [CAMPAIGN_SLUG]
    );
    res.json({ overview: result.rows[0] });
  } catch (err) {
    console.error('Founders Live overview error:', err);
    res.status(500).json({ message: 'Unable to load campaign overview.' });
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
