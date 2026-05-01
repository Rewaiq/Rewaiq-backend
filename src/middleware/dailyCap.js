const pool = require('../config/db');

const DAILY_CAP = 500; // max coins per day

const checkDailyCap = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const earned = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE user_id = $1 
       AND type IN ('stream_earn', 'task_reward', 'referral_reward')
       AND status = 'completed'
       AND created_at >= $2`,
      [req.user.id, today]
    );

    const todayTotal = parseInt(earned.rows[0].total);

    if (todayTotal >= DAILY_CAP) {
      return res.status(429).json({
        message: `Daily earning limit reached (${DAILY_CAP} coins). Come back tomorrow!`,
        coins_earned_today: todayTotal,
        daily_cap: DAILY_CAP
      });
    }

    req.coinsEarnedToday = todayTotal;
    req.remainingCap = DAILY_CAP - todayTotal;
    next();
  } catch (err) {
    next();
  }
};

module.exports = { checkDailyCap };