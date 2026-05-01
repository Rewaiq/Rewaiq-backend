const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  }
});

const sendOTP = async (email, otp, name) => {
  await transporter.sendMail({
    from: `"Rewaiq" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Verify your Rewaiq account',
    html: `
      <div style="background:#0A1628;padding:40px;font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border-radius:12px;">
        <h1 style="color:#F0C040;letter-spacing:4px;text-align:center;">REWAIQ</h1>
        <div style="background:#0D1F3C;border-radius:10px;padding:30px;margin-top:20px;text-align:center;">
          <p style="color:#FFFFFF;font-size:16px;">Hi ${name},</p>
          <p style="color:#8A9BB0;font-size:14px;">Your verification code is:</p>
          <div style="background:#D4A017;border-radius:10px;padding:20px;margin:20px 0;">
            <h2 style="color:#0A1628;font-size:36px;letter-spacing:8px;margin:0;">${otp}</h2>
          </div>
          <p style="color:#8A9BB0;font-size:13px;">This code expires in 10 minutes.</p>
          <p style="color:#8A9BB0;font-size:13px;">If you didn't request this, ignore this email.</p>
        </div>
        <p style="color:#3A4A5A;font-size:11px;text-align:center;margin-top:20px;">© 2026 Rewaiq Technologies Ltd · info@rewaiq.com.ng</p>
      </div>
    `
  });
};

const sendWelcome = async (email, name) => {
  await transporter.sendMail({
    from: `"Rewaiq" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Welcome to Rewaiq 🎉',
    html: `
      <div style="background:#0A1628;padding:40px;font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border-radius:12px;">
        <h1 style="color:#F0C040;letter-spacing:4px;text-align:center;">REWAIQ</h1>
        <div style="background:#0D1F3C;border-radius:10px;padding:30px;margin-top:20px;text-align:center;">
          <p style="color:#FFFFFF;font-size:18px;font-weight:bold;">Welcome aboard, ${name}! 🎉</p>
          <p style="color:#8A9BB0;font-size:14px;line-height:1.8;">Your account is verified. You're now part of Africa's digital earning platform. Start streaming, completing tasks, and earning real NGN today.</p>
          <a href="https://app.rewaiq.com.ng" style="display:inline-block;background:#D4A017;color:#0A1628;padding:14px 36px;border-radius:50px;font-weight:bold;text-decoration:none;margin-top:20px;">Open Rewaiq</a>
        </div>
        <p style="color:#3A4A5A;font-size:11px;text-align:center;margin-top:20px;">© 2026 Rewaiq Technologies Ltd</p>
      </div>
    `
  });
};

module.exports = { sendOTP, sendWelcome };