const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  }
});

// ── OTP EMAIL ──
const sendOTP = async (email, otp, name) => {
  await transporter.sendMail({
    from: `"Rewaiq" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Rewaiq verification code',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
<tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:#0A1628;border-radius:14px 14px 0 0;padding:32px 40px;text-align:center;border-top:3px solid #4a9eff;">
      <svg width="48" height="38" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.0669 64.9132V27.8448C11.0669 27.3337 11.665 27.0567 12.0548 27.3871L62.735 70.3446C63.0191 70.5854 62.8488 71.0497 62.4764 71.0497H49.5669C39.3371 70.5626 30.0565 65.3295 22.1875 58.5871C21.8251 58.2766 21.2945 58.2594 20.9163 58.5505L12.0329 65.3886C11.6383 65.6923 11.0669 65.4111 11.0669 64.9132Z" fill="#1a3a8f"/>
        <path d="M12.2466 20.8923C9.56504 17.9523 8.61661 13.8979 9.13672 10.6093C9.62504 7.52173 11.9248 5.00455 14.5282 3.27418C15.9203 2.34889 17.5956 1.50727 19.4373 0.975666C20.5603 0.651546 21.7464 1.00602 22.6382 1.76144L98.8583 66.325C99.196 66.611 99.1179 67.1516 98.712 67.3279C90.4102 70.9338 84.6197 72.1928 72.4271 71.665C71.9846 71.6459 71.5565 71.4777 71.2195 71.1903L12.2466 20.8923Z" fill="#4a9eff"/>
        <path d="M72.4608 71.6478C84.77 72.2692 90.6026 71.0456 98.9505 67.478C99.3591 67.3034 99.4388 66.76 99.0994 66.4732L63.7412 36.6038C53.6976 40.1309 47.5016 40.9898 35.5864 40.7853L71.2682 71.1746C71.6014 71.4583 72.0237 71.6257 72.4608 71.6478Z" fill="#2d6be4"/>
      </svg>
      <p style="margin:10px 0 0;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:900;font-size:22px;color:#ffffff;letter-spacing:3px;">REWAIQ</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#ffffff;padding:40px 40px 32px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A1628;">Hi ${name}, 👋</p>
      <p style="margin:0 0 24px;font-size:15px;color:#555555;line-height:1.7;">
        Here is your verification code to complete your Rewaiq account setup.
      </p>

      <!-- OTP Box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td align="center" style="background:#0A1628;border-radius:12px;padding:28px 20px;">
            <p style="margin:0 0 8px;font-size:11px;color:#8A9BB0;letter-spacing:2px;text-transform:uppercase;">Your verification code</p>
            <p style="margin:0;font-size:48px;font-weight:900;color:#4a9eff;letter-spacing:12px;font-family:'Courier New',monospace;">${otp}</p>
            <p style="margin:10px 0 0;font-size:12px;color:#8A9BB0;">Expires in 10 minutes</p>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 16px;font-size:14px;color:#777777;line-height:1.7;">
        Enter this code on the Rewaiq verification screen to activate your account and start earning.
      </p>

      <!-- Security note -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border-left:3px solid #4a9eff;margin-bottom:24px;">
        <tr>
          <td style="padding:14px 16px;">
            <p style="margin:0;font-size:13px;color:#555555;line-height:1.6;">
              🔒 If you did not create a Rewaiq account, ignore this email. Your account will not be activated.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0A1628;border-radius:0 0 14px 14px;padding:24px 40px;text-align:center;border-top:2px solid #4a9eff;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#4a9eff;letter-spacing:3px;">REWAIQ</p>
      <p style="margin:0 0 8px;font-size:11px;color:#8A9BB0;">
        <a href="https://rewaiq.com.ng" style="color:#8A9BB0;text-decoration:none;">rewaiq.com.ng</a>
        &nbsp;·&nbsp;
        <a href="mailto:info@rewaiq.com.ng" style="color:#8A9BB0;text-decoration:none;">info@rewaiq.com.ng</a>
      </p>
      <p style="margin:0;font-size:10px;color:#3A4A5A;">© 2026 Rewaiq Technologies Ltd · RC 9137882 · Aba, Abia State, Nigeria</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>
    `
  });
};

// ── WELCOME EMAIL ──
const sendWelcome = async (email, name) => {
  await transporter.sendMail({
    from: `"Rewaiq" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Welcome to Rewaiq, ${name}! 🎉`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
<tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:#0A1628;border-radius:14px 14px 0 0;padding:32px 40px;text-align:center;border-top:3px solid #4a9eff;">
      <svg width="48" height="38" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.0669 64.9132V27.8448C11.0669 27.3337 11.665 27.0567 12.0548 27.3871L62.735 70.3446C63.0191 70.5854 62.8488 71.0497 62.4764 71.0497H49.5669C39.3371 70.5626 30.0565 65.3295 22.1875 58.5871C21.8251 58.2766 21.2945 58.2594 20.9163 58.5505L12.0329 65.3886C11.6383 65.6923 11.0669 65.4111 11.0669 64.9132Z" fill="#1a3a8f"/>
        <path d="M12.2466 20.8923C9.56504 17.9523 8.61661 13.8979 9.13672 10.6093C9.62504 7.52173 11.9248 5.00455 14.5282 3.27418C15.9203 2.34889 17.5956 1.50727 19.4373 0.975666C20.5603 0.651546 21.7464 1.00602 22.6382 1.76144L98.8583 66.325C99.196 66.611 99.1179 67.1516 98.712 67.3279C90.4102 70.9338 84.6197 72.1928 72.4271 71.665C71.9846 71.6459 71.5565 71.4777 71.2195 71.1903L12.2466 20.8923Z" fill="#4a9eff"/>
        <path d="M72.4608 71.6478C84.77 72.2692 90.6026 71.0456 98.9505 67.478C99.3591 67.3034 99.4388 66.76 99.0994 66.4732L63.7412 36.6038C53.6976 40.1309 47.5016 40.9898 35.5864 40.7853L71.2682 71.1746C71.6014 71.4583 72.0237 71.6257 72.4608 71.6478Z" fill="#2d6be4"/>
      </svg>
      <p style="margin:10px 0 0;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:900;font-size:22px;color:#ffffff;letter-spacing:3px;">REWAIQ</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#ffffff;padding:40px 40px 32px;">
      <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0A1628;">Welcome aboard, ${name}! 🎉</p>
      <p style="margin:0 0 28px;font-size:15px;color:#555555;line-height:1.7;">
        Your account is verified. You are now part of Africa's digital earning platform. Here is what you can do on Rewaiq:
      </p>

      <!-- Features -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        ${[
          { icon: '🎵', title: 'Stream & Earn', desc: 'Stream music and earn Rewaiq Coins' },
          { icon: '📋', title: 'Complete Tasks', desc: 'Follow, watch, share — earn more coins' },
          { icon: '💰', title: 'Cash Out', desc: 'Redeem coins for real NGN to your bank' },
          { icon: '🔗', title: 'Refer Friends', desc: 'Earn 100 coins for every friend you invite' },
        ].map(f => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:44px;font-size:22px;vertical-align:top;padding-top:2px;">${f.icon}</td>
                <td>
                  <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#0A1628;">${f.title}</p>
                  <p style="margin:0;font-size:13px;color:#777777;">${f.desc}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`).join('')}
      </table>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td align="center">
            <a href="https://app.rewaiq.com.ng" style="display:inline-block;background:#4a9eff;color:#ffffff;font-size:16px;font-weight:700;padding:16px 40px;border-radius:12px;text-decoration:none;letter-spacing:0.5px;">
              Open Rewaiq →
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;color:#999999;text-align:center;line-height:1.7;">
        Questions? Reply to this email or contact us at<br>
        <a href="mailto:info@rewaiq.com.ng" style="color:#4a9eff;text-decoration:none;">info@rewaiq.com.ng</a>
      </p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0A1628;border-radius:0 0 14px 14px;padding:24px 40px;text-align:center;border-top:2px solid #4a9eff;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#4a9eff;letter-spacing:3px;">REWAIQ</p>
      <p style="margin:0 0 8px;font-size:11px;color:#8A9BB0;">
        <a href="https://rewaiq.com.ng" style="color:#8A9BB0;text-decoration:none;">rewaiq.com.ng</a>
        &nbsp;·&nbsp;
        <a href="mailto:info@rewaiq.com.ng" style="color:#8A9BB0;text-decoration:none;">info@rewaiq.com.ng</a>
      </p>
      <p style="margin:0;font-size:10px;color:#3A4A5A;">© 2026 Rewaiq Technologies Ltd · RC 9137882 · Aba, Abia State, Nigeria</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>
    `
  });
};

// ── PASSWORD RESET EMAIL ──
const sendPasswordReset = async (email, otp, name) => {
  await transporter.sendMail({
    from: `"Rewaiq" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Reset your Rewaiq password',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
<tr><td align="center">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
  <tr>
    <td style="background:#0A1628;border-radius:14px 14px 0 0;padding:32px 40px;text-align:center;border-top:3px solid #4a9eff;">
      <p style="margin:0;font-weight:900;font-size:22px;color:#ffffff;letter-spacing:3px;">REWAIQ</p>
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
    `
  });
};

module.exports = { sendOTP, sendWelcome, sendPasswordReset };
