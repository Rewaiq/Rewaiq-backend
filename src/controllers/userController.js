const pool = require('../config/db');
const { cloudinary } = require('../config/cloudinary');

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

    res.json({ user: user.rows[0] });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
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

    res.json({
      message: 'Profile updated successfully',
      user: updated.rows[0]
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
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

    res.json({
      message: 'Profile picture updated successfully',
      profile_picture: imageUrl
    });
  } catch (err) {
    console.error('Upload profile pic error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
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

    res.json({
      message: 'Interests updated successfully',
      interests
    });
  } catch (err) {
    console.error('Update interests error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================================================
// GET MY REFERRED USERS (For User Referral Dashboard)
// =========================================================
const getMyReferrals = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT 
        r.id AS referral_id,
        r.coins_awarded,
        r.status,
        r.created_at,
        u.id AS user_id,
        u.full_name,
        u.is_email_verified,
        -- Mask email for user privacy (e.g., s***i@gmail.com)
        CONCAT(
          SUBSTRING(u.email FROM 1 FOR 1),
          '***',
          SUBSTRING(u.email FROM POSITION('@' IN u.email) - 1)
        ) AS masked_email
      FROM referrals r
      JOIN users u ON r.referred_id = u.id
      WHERE r.referrer_id = $1
      ORDER BY r.created_at DESC
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

module.exports = {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  updateInterests,
  getMyReferrals
};
