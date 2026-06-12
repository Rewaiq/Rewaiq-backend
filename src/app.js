const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');

require('./config/db');
const promoRoutes = require('./routes/promoRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const coinRoutes = require('./routes/coinRoutes');
const taskRoutes = require('./routes/taskRoutes');
const streamRoutes = require('./routes/streamRoutes');
const profileRoutes = require('./routes/profileRoutes');
const feedRoutes = require('./routes/feedRoutes');
const trackRoutes = require('./routes/trackRoutes');
const adminRoutes = require('./routes/adminRoutes');
const referralRoutes = require('./routes/referralRoutes');
const paystackRoutes = require('./routes/paystackRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const passport = require('./config/passport');
const artistRoutes = require('./routes/artistRoutes');
const emailRoutes = require('./routes/emailRoutes');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
app.use('/api/', apiLimiter);
app.use('/api/notifications', notificationRoutes);
app.use('/api/promo', promoRoutes);
app.use('/api/artist', artistRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Rewaiq API is live 🚀' });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/coins', coinRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/paystack', paystackRoutes);
app.use('/api/email', emailRoutes);

// Update platform stats daily
const updatePlatformStats = async () => {
  try {
    const pool = require('./config/db');
    const today = new Date().toISOString().split('T')[0];
    
    const [users, streams, coins] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query(`SELECT COUNT(*) FROM stream_sessions WHERE DATE(created_at) = $1`, [today]),
      pool.query(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='stream_earn' AND DATE(created_at) = $1`, [today]),
    ]);

    await pool.query(
      `INSERT INTO platform_stats (date, total_users, total_streams, total_coins_earned)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (date) DO UPDATE SET
       total_users = $2, total_streams = $3, total_coins_earned = $4`,
      [today, users.rows[0].count, streams.rows[0].count, coins.rows[0].coalesce]
    );
  } catch (err) {
    console.error('Stats update failed:', err.message);
  }
};

// Run every hour
setInterval(updatePlatformStats, 60 * 60 * 1000);
updatePlatformStats(); // Run on startup

module.exports = app;
