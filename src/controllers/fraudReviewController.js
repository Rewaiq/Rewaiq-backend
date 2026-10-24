const pool = require('../config/db');

// Finds groups sharing the same normalized phone number and creates review flags.
// Shared numbers can be legitimate (family, recycled numbers), so this never bans users.
const scanDuplicatePhones = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groups = await client.query(`
      SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS normalized_phone,
             jsonb_agg(jsonb_build_object(
               'id', id, 'email', email, 'full_name', full_name,
               'created_at', created_at, 'registration_ip', registration_ip
             ) ORDER BY created_at ASC) AS accounts,
             array_agg(email ORDER BY email) AS emails,
             COUNT(*)::int AS account_count
      FROM users
      WHERE phone IS NOT NULL
        AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7
      GROUP BY regexp_replace(phone, '[^0-9]', '', 'g')
      HAVING COUNT(*) > 1
    `);

    let created = 0;
    for (const group of groups.rows) {
      const reason = `${group.account_count} accounts share the same normalized phone number. Review manually; this is not proof of fraud.`;
      // One pending flag per phone group; evidence contains account emails/IDs but not the full phone.
      const exists = await client.query(`
        SELECT id FROM fraud_review_flags
        WHERE flag_type = 'duplicate_phone'
          AND status = 'pending'
          AND evidence->>'normalized_phone' = $1
        LIMIT 1
      `, [group.normalized_phone]);
      if (exists.rows.length) continue;

      await client.query(`
        INSERT INTO fraud_review_flags (email, flag_type, reason, evidence, status)
        VALUES ($1, 'duplicate_phone', $2, $3::jsonb, 'pending')
      `, [
        group.emails[0],
        reason,
        JSON.stringify({
          normalized_phone: group.normalized_phone,
          account_count: group.account_count,
          accounts: group.accounts
        })
      ]);
      created += 1;
    }
    await client.query('COMMIT');
    res.json({
      message: 'Duplicate-phone scan completed. Flags are for manual review only.',
      duplicate_groups_found: groups.rowCount,
      new_flags_created: created
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Duplicate-phone scan failed:', err.message);
    res.status(500).json({ message: 'Duplicate-phone scan failed' });
  } finally {
    client.release();
  }
};

const listFraudFlags = async (req, res) => {
  try {
    const status = ['pending', 'confirmed', 'cleared'].includes(req.query.status)
      ? req.query.status : 'pending';
    const result = await pool.query(`
      SELECT id, email, flag_type, reason, evidence, status, created_at, reviewed_at, reviewed_by
      FROM fraud_review_flags
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT 200
    `, [status]);
    res.json({ flags: result.rows });
  } catch (err) {
    console.error('Fraud flag list failed:', err.message);
    res.status(500).json({ message: 'Unable to load fraud review flags' });
  }
};

const reviewFraudFlag = async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { status } = req.body || {};
  if (!Number.isInteger(id) || id < 1 || !['confirmed', 'cleared'].includes(status)) {
    return res.status(400).json({ message: 'Provide a valid flag ID and status: confirmed or cleared' });
  }
  try {
    const result = await pool.query(`
      UPDATE fraud_review_flags
      SET status = $1, reviewed_at = NOW(), reviewed_by = $2
      WHERE id = $3
      RETURNING id, email, flag_type, reason, evidence, status, created_at, reviewed_at, reviewed_by
    `, [status, req.user.id, id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Fraud review flag not found' });
    res.json({ message: `Flag marked ${status}. No account was automatically blocked.`, flag: result.rows[0] });
  } catch (err) {
    console.error('Fraud flag review failed:', err.message);
    res.status(500).json({ message: 'Unable to update fraud review flag' });
  }
};

module.exports = { scanDuplicatePhones, listFraudFlags, reviewFraudFlag };
