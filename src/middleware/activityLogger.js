const pool = require('../config/db');

// Helper to reliably parse client IP
const getClientIp = (req) => {
  if (!req) return null;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
};

// 1. Standalone Helper Function (for manual calls in controllers)
const logActivity = async (userId, action, details = {}, ip = null) => {
  try {
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId || null, action, JSON.stringify(details), ip]
    );
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
};

// 2. Express Middleware Function (for app.use in app.js)
const activityLoggerMiddleware = (req, res, next) => {
  res.on('finish', async () => {
    // Only log API routes and skip static/health checks
    if (!req.originalUrl || !req.originalUrl.startsWith('/api') || req.originalUrl === '/api/health') {
      return;
    }

    try {
      const clientIp = getClientIp(req);
      const userId = req.user?.id || null;
      const action = `${req.method} ${req.baseUrl || req.path}`;
      const details = {
        route: req.originalUrl,
        status: res.statusCode,
      };

      await logActivity(userId, action, details, clientIp);
    } catch (err) {
      console.error('Activity logger middleware error:', err.message);
    }
  });

  next();
};

// Export middleware as default function, and attach helper method
activityLoggerMiddleware.logActivity = logActivity;
module.exports = activityLoggerMiddleware;
