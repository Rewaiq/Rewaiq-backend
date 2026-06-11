const pool = require('../config/db');
const { cloudinary } = require('../config/cloudinary');

// GET PROFILE
const getProfile = async (req, res) => {
  try {
    const user = await pool.query(
      `SELECT id, full_name, email, phone, role, coin_balance, 
              referral_code, referred_by, profile_picture, 
              interests, is_email_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (user.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE PROFILE
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
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPLOAD PROFILE PICTURE
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
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE INTERESTS
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
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { getProfile, updateProfile, uploadProfilePicture, updateInterests };
