const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');

require('./config/db');

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
const passport = require('./config/passport');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
app.use('/api/', apiLimiter);

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

module.exports = app;