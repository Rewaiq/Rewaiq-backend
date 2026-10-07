const pool = require('../config/db');

// =========================================================
// GET PROFILE
// =========================================================
const getProfile = async (req, res) => {
  try {
    const user = await pool.query(
      `SELECT id, full_name, email, phone, role, coin_balance, 
              referral_code, referred_by, referral_count, profile_picture, 
              bio, interests, is_email_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Ensure referral_count accurately reflects database records
    const refCountQuery = await pool.query(
      'SELECT COUNT(*) FROM users WHERE referred_by = $1',
      [req.user.id]
    );
    const count = parseInt(refCountQuery.rows[0]?.count || 0, 10);
    const profileData = { ...user.rows[0], referral_count: count };

    return res.json({ user: profileData });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// GET MY REFERRED USERS
// =========================================================
const getMyReferrals = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.is_email_verified,
        u.created_at,
        COALESCE(r.coins_awarded, 100) AS coins_awarded,
        COALESCE(r.status, CASE WHEN u.is_email_verified THEN 'completed' ELSE 'pending' END) AS status,
        CONCAT(
          SUBSTRING(u.email FROM 1 FOR 2),
          '***@',
          SPLIT_PART(u.email, '@', 2)
        ) AS masked_email
      FROM users u
      LEFT JOIN referrals r 
        ON r.referred_id = u.id AND r.referrer_id = $1
      WHERE u.referred_by = $1
      ORDER BY u.created_at DESC
      `,
      [userId]
    );

    return res.json({
      success: true,
      total_referrals: result.rows.length,
      referrals: result.rows
    });
  } catch (err) {
    console.error('Get my referrals error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// UPDATE PROFILE
// =========================================================
const updateProfile = async (req, res) => {
  const { full_name, phone, bio } = req.body;
  try {
    const updated = await pool.query(
      `UPDATE users SET 
       full_name = COALESCE($1, full_name),
       phone = COALESCE($2, phone),
       bio = COALESCE($3, bio)
       WHERE id = $4 
       RETURNING id, full_name, email, phone, bio, profile_picture`,
      [full_name, phone, bio, req.user.id]
    );

    return res.json({
      message: 'Profile updated successfully',
      user: updated.rows[0]
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// UPLOAD PROFILE PICTURE
// =========================================================
const uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }
    const imageUrl = req.file.path;
    await pool.query(
      'UPDATE users SET profile_picture = $1 WHERE id = $2',
      [imageUrl, req.user.id]
    );
    return res.json({
      message: 'Profile picture updated successfully',
      profile_picture: imageUrl
    });
  } catch (err) {
    console.error('Upload profile pic error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// UPDATE INTERESTS
// =========================================================
const updateInterests = async (req, res) => {
  const { interests } = req.body;
  try {
    await pool.query(
      'UPDATE users SET interests = $1 WHERE id = $2',
      [interests, req.user.id]
    );
    return res.json({
      message: 'Interests updated successfully',
      interests
    });
  } catch (err) {
    console.error('Update interests error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  getProfile,
  getMyReferrals,
  updateProfile,
  uploadProfilePicture,
  updateInterests
};
