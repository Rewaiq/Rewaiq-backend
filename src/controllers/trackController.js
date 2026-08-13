const pool = require('../config/db');

// =========================================================
// GENERATE EMBED URL
// =========================================================

const generateEmbedUrl = (url, type) => {
  if (!url) return '';

  switch (type) {
    case 'youtube': {
      const ytId = url.match(
        /(?:v=|youtu\.be\/)([^&\n?#]+)/
      );

      return ytId
        ? `https://www.youtube.com/embed/${ytId[1]}`
        : url;
    }

    case 'tiktok':
      return url.replace(
        'tiktok.com',
        'tiktok.com/embed'
      );

    case 'facebook':
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
        url
      )}`;

    case 'audiomack': {
      const parts = url.split('audiomack.com/')[1];

      return parts
        ? `https://audiomack.com/embed/${parts}`
        : url;
    }

    default:
      return url;
  }
};


// =========================================================
// UPLOAD TRACK
// =========================================================

const uploadTrack = async (req, res) => {
  const {
    title,
    description,
    genre,
    content_type,
    original_url,
    cover_image,
    campaign_coins,
    target_streams
  } = req.body;

  try {
    const embed_url = generateEmbedUrl(
      original_url,
      content_type
    );

    const track = await pool.query(
      `INSERT INTO tracks
      (
        artist_id,
        title,
        description,
        genre,
        content_type,
        original_url,
        embed_url,
        cover_image,
        campaign_coins,
        target_streams,
        is_active
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        false
      )
      RETURNING *`,
      [
        req.user.id,
        title,
        description,
        genre,
        content_type,
        original_url,
        embed_url,
        cover_image,
        campaign_coins || 10,
        target_streams || 1000
      ]
    );

    res.status(201).json({
      message: 'Track uploaded successfully',
      track: track.rows[0]
    });

  } catch (err) {
    console.error(
      'Upload track error:',
      err
    );

    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// GET ALL TRACKS
// =========================================================

const getAllTracks = async (req, res) => {
  const {
    type,
    page = 1,
    limit = 20
  } = req.query;

  const offset =
    (Number(page) - 1) *
    Number(limit);

  try {
    let query = `
      SELECT
        t.*,
        u.full_name AS artist_name,
        u.profile_picture AS artist_picture
      FROM tracks t
      JOIN users u
        ON t.artist_id = u.id
      WHERE 1=1
    `;

    const params = [];

    // Admin can request inactive tracks.
    // Normal users only receive active tracks.
    if (req.query.admin !== 'true') {
      query += ` AND t.is_active = true`;
    }

    if (type) {
      query += `
        AND t.content_type = $${params.length + 1}
      `;

      params.push(type);
    }

    query += `
      ORDER BY t.created_at DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;

    params.push(
      Number(limit),
      offset
    );

    const tracks = await pool.query(
      query,
      params
    );

    res.json({
      tracks: tracks.rows
    });

  } catch (err) {
    console.error(
      'Get all tracks error:',
      err
    );

    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// GET SINGLE TRACK BY ID
// =========================================================

const getTrackById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        t.*,
        u.full_name AS artist_name,
        u.profile_picture AS artist_picture
      FROM tracks t
      JOIN users u
        ON t.artist_id = u.id
      WHERE t.id = $1
      AND t.is_active = true
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Track not found'
      });
    }

    res.json({
      track: result.rows[0]
    });

  } catch (err) {
    console.error(
      'Get track by ID error:',
      err
    );

    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// GET MY TRACKS
// =========================================================

const getMyTracks = async (req, res) => {
  try {
    const tracks = await pool.query(
      `
      SELECT *
      FROM tracks
      WHERE artist_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      tracks: tracks.rows
    });

  } catch (err) {
    console.error(
      'Get my tracks error:',
      err
    );

    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// DELETE / DEACTIVATE TRACK
// =========================================================

const deleteTrack = async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      `
      UPDATE tracks
      SET is_active = false
      WHERE id = $1
      AND artist_id = $2
      `,
      [
        id,
        req.user.id
      ]
    );

    res.json({
      message: 'Track removed successfully'
    });

  } catch (err) {
    console.error(
      'Delete track error:',
      err
    );

    res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
};


// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  uploadTrack,
  getAllTracks,
  getTrackById,
  getMyTracks,
  deleteTrack
};
