const pool = require('../config/db');

// Generate embed URL from original URL
const generateEmbedUrl = (url, type) => {
  switch(type) {
    case 'youtube':
      const ytId = url.match(/(?:v=|youtu\.be\/)([^&\n?#]+)/);
      return ytId ? `https://www.youtube.com/embed/${ytId[1]}` : url;
    case 'tiktok':
      return url.replace('tiktok.com', 'tiktok.com/embed');
    case 'facebook':
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}`;
    case 'audiomack':
      const parts = url.split('audiomack.com/')[1];
      return parts ? `https://audiomack.com/embed/${parts}` : url;
    default:
      return url;
  }
};

// UPLOAD TRACK (Artist)
const uploadTrack = async (req, res) => {
  const { title, description, genre, content_type, original_url, cover_image, campaign_coins, target_streams } = req.body;
  try {
    const embed_url = generateEmbedUrl(original_url, content_type);
    const track = await pool.query(
  `INSERT INTO tracks 
   (artist_id, title, description, genre, content_type, original_url, embed_url, cover_image, campaign_coins, target_streams, is_active)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false) RETURNING *`,
  [req.user.id, title, description, genre, content_type, original_url, embed_url, cover_image, campaign_coins || 10, target_streams || 1000]
);
    res.status(201).json({ message: 'Track uploaded successfully', track: track.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET ALL TRACKS (User feed)
const getAllTracks = async (req, res) => {
  const { type, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    let query = `SELECT t.*, u.full_name as artist_name, u.profile_picture as artist_picture
                 FROM tracks t JOIN users u ON t.artist_id = u.id
                 WHERE 1=1`;
    const params = [];
    
    // Admin sees all tracks, users only see active ones
    if (req.query.admin !== 'true') {
      query += ` AND t.is_active = true`;
    }
    
    if (type) { 
      query += ` AND t.content_type = $${params.length + 1}`; 
      params.push(type); 
    }
    query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const tracks = await pool.query(query, params);
    res.json({ tracks: tracks.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET MY TRACKS (Artist)
const getMyTracks = async (req, res) => {
  try {
    const tracks = await pool.query(
      `SELECT * FROM tracks WHERE artist_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ tracks: tracks.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE TRACK
const deleteTrack = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE tracks SET is_active = false WHERE id = $1 AND artist_id = $2`,
      [id, req.user.id]
    );
    res.json({ message: 'Track removed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = { uploadTrack, getAllTracks, getMyTracks, deleteTrack };
