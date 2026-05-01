require('dotenv').config();
const pool = require('./db');

const migrate = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        otp VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id),
        referred_id INTEGER REFERENCES users(id),
        coins_awarded INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE,
        ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
    `);
    console.log('✅ Migration 4 successful');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

migrate();