require('dotenv').config();
const pool = require('./db');

const migrate = async () => {
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS google_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS reset_token VARCHAR(100),
        ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;
    `);
    console.log('✅ Migration 5 successful');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

migrate();