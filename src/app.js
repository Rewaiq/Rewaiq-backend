const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

require('./config/db');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const coinRoutes = require('./routes/coinRoutes');
const taskRoutes = require('./routes/taskRoutes');
const streamRoutes = require('./routes/streamRoutes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Rewaiq API is live' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/coins', coinRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/streams', streamRoutes);

module.exports = app;