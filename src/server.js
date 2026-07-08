require('dotenv').config();
const app = require('./app');

// ==========================================
// GLOBAL CRASH GUARDS (Crucial for Railway)
// ==========================================

// Catches synchronous errors that happen outside your route handlers
process.on('uncaughtException', (err) => {
  console.error('💥 CRITICAL UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  // Optional: You can choose not to exit(1) if you want to try keeping the container alive
});

// Catches unhandled Promise rejections (e.g., if database queries fail in the background)
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 CRITICAL UNHANDLED REJECTION AT:', promise, 'REASON:', reason);
});

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Rewaiq server running on port ${PORT}`);
});
