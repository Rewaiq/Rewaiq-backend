require('dotenv').config();
const pool = require('./db');

const migrate = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracks (
        id SERIAL PRIMARY KEY,
        artist_id INTEGER REFERENCES users(id),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        genre VARCHAR(100),
        content_type VARCHAR(20) NOT NULL,
        original_url VARCHAR(500) NOT NULL,
        embed_url VARCHAR(500) NOT NULL,
        cover_image VARCHAR(500),
        campaign_coins INTEGER DEFAULT 10,
        target_streams INTEGER DEFAULT 1000,
        total_streams INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tracks table created');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

migrate();