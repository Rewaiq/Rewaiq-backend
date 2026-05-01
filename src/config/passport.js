const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('./db');
const crypto = require('crypto');
require('dotenv').config();

const generateReferralCode = () => {
  return 'RWQ' + crypto.randomBytes(4).toString('hex').toUpperCase();
};

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const full_name = profile.displayName;
    const google_id = profile.id;

    // Check if user exists
    let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (user.rows.length > 0) {
      // Update google_id if not set
      if (!user.rows[0].google_id) {
        await pool.query('UPDATE users SET google_id = $1 WHERE email = $2', [google_id, email]);
      }
      return done(null, user.rows[0]);
    }

    // Create new user
    const referralCode = generateReferralCode();
    const newUser = await pool.query(
      `INSERT INTO users 
       (full_name, email, google_id, referral_code, is_email_verified, password)
       VALUES ($1, $2, $3, $4, true, $5) RETURNING *`,
      [full_name, email, google_id, referralCode, 'GOOGLE_AUTH']
    );

    return done(null, newUser.rows[0]);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  done(null, user.rows[0]);
});

module.exports = passport;