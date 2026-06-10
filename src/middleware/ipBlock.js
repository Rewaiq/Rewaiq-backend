const pool = require('../config/db');

const ipBlockMiddleware = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const blocked = await pool.query(
      `SELECT id FROM blocked_ips 
       WHERE ip_address = $1 
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [ip]
    );
    if (blocked.rows.length > 0) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  } catch {
    next(); // Don't block on error
  }
};

module.exports = ipBlockMiddleware;
