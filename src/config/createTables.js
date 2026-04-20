const pool = require('./db');

const createTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        coin_balance INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        reward_coins INTEGER NOT NULL,
        task_type VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS task_completions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id INTEGER REFERENCES tasks(id),
        proof_url VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        completed_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stream_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  track_id VARCHAR(100),
  track_url VARCHAR(255),
  start_time TIMESTAMP DEFAULT NOW(),
  end_time TIMESTAMP,
  duration_seconds INTEGER DEFAULT 0,
  coins_earned INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

     CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) DEFAULT 'user',
  coin_balance INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
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
    console.log('✅ Tables created successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating tables:', err);
    process.exit(1);
  }
};

createTables();