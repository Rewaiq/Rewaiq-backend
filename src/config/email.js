require('dotenv').config();

const sendEmail = async (to, subject, html) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Rewaiq <info@updates.rewaiq.com.ng>',
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Email failed: ${JSON.stringify(error)}`);
  }

  return response.json();
};

const sendOTP = async (email, otp, name) => {
  await sendEmail(email, 'Your Rewaiq verification code', `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr>
    <td style="background:#0A1628;border-radius:14px 14px 0 0;padding:28px 40px;text-align:center;border-top:3px solid #4a9eff;">
      <p style="margin:0;font-weight:900;font-size:20px;color:#ffffff;letter-spacing:3px;font-family:'Helvetica Neue',Arial,sans-serif;">REWAIQ</p>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:40px;">
      <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0A1628;">Hi ${name} 👋</p>
      <p style="margin:0 0 24px;font-size:15px;color:#555555;line-height:1.7;">
        Here is your verification code to complete your Rewaiq account setup.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td align="center" style="background:#0A1628;border-radius:12px;padding:28px 20px;">
            <p style="margin:0 0 8px;font-size:11px;color:#8A9BB0;letter-spacing:2px;text-transform:uppercase;">Your verification code</p>
            <p style="margin:0;font-size:48px;font-weight:900;color:#4a9eff;letter-spacing:12px;font-family:'Courier New',monospace;">${otp}</p>
            <p style="margin:10px 0 0;font-size:12px;color:#8A9BB0;">Expires in 10 minutes</p>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#999999;">If you did not create a Rewaiq account, ignore this email.</p>
    </td>
  </tr>
  <tr>
    <td style="background:#0A1628;border-radius:0 0 14px 14px;padding:20px 40px;text-align:center;">
      <p style="margin:0;font-size:10px;color:#3A4A5A;">© 2026 Rewaiq Technologies Ltd · RC 9137882 · rewaiq.com.ng</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>
  `);
};

const sendWelcome = async (email, name) => {
  await sendEmail(email, `Welcome to Rewaiq, ${name}! 🎉`, `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr>
    <td style="background:#0A1628;border-radius:14px 14px 0 0;padding:28px 40px;text-align:center;border-top:3px solid #4a9eff;">
      <p style="margin:0;font-weight:900;font-size:20px;color:#ffffff;letter-spacing:3px;">REWAIQ</p>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:40px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A1628;">Welcome aboard, ${name}! 🎉</p>
      <p style="margin:0 0 24px;font-size:15px;color:#555555;line-height:1.7;">
        Your account is verified. You are now part of Africa's digital earning platform.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;">
          <table><tr>
            <td style="width:36px;font-size:20px;">🎵</td>
            <td><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#0A1628;">Stream & Earn</p>
            <p style="margin:0;font-size:13px;color:#777;">Stream music and earn Rewaiq Coins</p></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;">
          <table><tr>
            <td style="width:36px;font-size:20px;">📋</td>
            <td><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#0A1628;">Complete Tasks</p>
            <p style="margin:0;font-size:13px;color:#777;">Follow, watch, share and earn more</p></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;">
          <table><tr>
            <td style="width:36px;font-size:20px;">💰</td>
            <td><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#0A1628;">Cash Out</p>
            <p style="margin:0;font-size:13px;color:#777;">Redeem coins for real NGN to your bank</p></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:10px 0;">
          <table><tr>
            <td style="width:36px;font-size:20px;">🔗</td>
            <td><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#0A1628;">Refer Friends</p>
            <p style="margin:0;font-size:13px;color:#777;">Earn 100 coins for every friend you invite</p></td>
          </tr></table>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center">
          <a href="https://betarewaiq.netlify.app" style="display:inline-block;background:#4a9eff;color:#fff;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;text-decoration:none;">
            Open Rewaiq →
          </a>
        </td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="background:#0A1628;border-radius:0 0 14px 14px;padding:20px 40px;text-align:center;">
      <p style="margin:0;font-size:10px;color:#3A4A5A;">© 2026 Rewaiq Technologies Ltd · RC 9137882 · rewaiq.com.ng</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>
  `);
};

const sendPasswordReset = async (email, otp, name) => {
  await sendEmail(email, 'Reset your Rewaiq password', `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr>
    <td style="background:#0A1628;border-radius:14px 14px 0 0;padding:28px 40px;text-align:center;border-top:3px solid #4a9eff;">
      <p style="margin:0;font-weight:900;font-size:20px;color:#ffffff;letter-spacing:3px;">REWAIQ</p>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:40px;">
      <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0A1628;">Password Reset</p>
      <p style="margin:0 0 24px;font-size:15px;color:#555555;">Hi ${name}, use this code to reset your password:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td align="center" style="background:#0A1628;border-radius:12px;padding:28px 20px;">
            <p style="margin:0 0 8px;font-size:11px;color:#8A9BB0;letter-spacing:2px;text-transform:uppercase;">Reset code</p>
            <p style="margin:0;font-size:48px;font-weight:900;color:#4a9eff;letter-spacing:12px;font-family:'Courier New',monospace;">${otp}</p>
            <p style="margin:10px 0 0;font-size:12px;color:#8A9BB0;">Expires in 10 minutes</p>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#999999;">If you did not request this, ignore this email.</p>
    </td>
  </tr>
  <tr>
    <td style="background:#0A1628;border-radius:0 0 14px 14px;padding:20px 40px;text-align:center;">
      <p style="margin:0;font-size:10px;color:#3A4A5A;">© 2026 Rewaiq Technologies Ltd · RC 9137882</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>
  `);
};

module.exports = { sendOTP, sendWelcome, sendPasswordReset };
