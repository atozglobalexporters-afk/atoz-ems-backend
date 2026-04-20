// src/services/emailService.js
// Nodemailer email service — fire-and-forget pattern
// Requires: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env
// Gmail: generate an App Password at myaccount.google.com → Security → App Passwords

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"${process.env.FROM_NAME || 'A to Z EMS'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`;

// Base HTML wrapper
const wrap = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
  <div style="max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#0a0f1e;padding:22px 28px;display:flex;align-items:center;gap:12px">
      <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff">A</div>
      <span style="color:#f1f5f9;font-size:15px;font-weight:700;margin-left:8px">A to Z Global Exporters EMS</span>
    </div>
    <div style="padding:32px 28px">${content}</div>
    <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center">
      This is an automated message from A to Z EMS. Please do not reply.
    </div>
  </div>
</body>
</html>`;

async function sendEmail({ to, subject, html }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('Email not configured — skipping email send');
    return;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`Email sent → ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Email failed → ${to}: ${err.message}`);
    // Never throw — email failure must not break the API response
  }
}

// ── Template: Welcome email (sent when admin creates an employee) ─
async function sendWelcomeEmail(user, plainPassword) {
  await sendEmail({
    to: user.email,
    subject: 'Welcome to A to Z Global EMS',
    html: wrap(`
      <h2 style="color:#0f172a;margin:0 0 12px">Welcome, ${user.name}! 👋</h2>
      <p style="color:#475569;line-height:1.7">Your EMS account has been created. Here are your login credentials:</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;font-family:monospace">
        <div style="margin-bottom:8px"><span style="color:#64748b">Email: </span><strong style="color:#0f172a">${user.email}</strong></div>
        <div><span style="color:#64748b">Password: </span><strong style="color:#0f172a">${plainPassword}</strong></div>
      </div>
      <p style="color:#ef4444;font-size:13px;font-weight:600">⚠ Please change your password after your first login.</p>
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open EMS →</a>
    `),
  });
}

// ── Template: Task assigned ───────────────────────────────────────
async function sendTaskAssigned(user, task) {
  const deadline = task.deadline
    ? new Date(task.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
  const priorityColor = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#10b981' }[task.priority] || '#64748b';

  await sendEmail({
    to: user.email,
    subject: `New task assigned: ${task.title}`,
    html: wrap(`
      <h2 style="color:#0f172a;margin:0 0 12px">New task assigned 📋</h2>
      <p style="color:#475569;line-height:1.7">Hi ${user.name}, you have been assigned a new task:</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px">${task.title}</div>
        ${task.description ? `<div style="color:#475569;font-size:14px;margin-bottom:12px">${task.description}</div>` : ''}
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <span style="font-size:12px;color:${priorityColor};font-weight:700;text-transform:uppercase;background:${priorityColor}15;padding:3px 10px;border-radius:20px">${task.priority} PRIORITY</span>
          <span style="font-size:13px;color:#64748b">📅 Due: <strong>${deadline}</strong></span>
        </div>
      </div>
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Task →</a>
    `),
  });
}

// ── Template: Leave decision ──────────────────────────────────────
async function sendLeaveDecision(user, leave, status) {
  const approved = status === 'APPROVED';
  const color = approved ? '#10b981' : '#ef4444';
  const icon  = approved ? '✅' : '❌';
  const start = new Date(leave.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const end   = new Date(leave.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  await sendEmail({
    to: user.email,
    subject: `Leave ${approved ? 'Approved' : 'Rejected'}: ${leave.leaveType}`,
    html: wrap(`
      <h2 style="color:#0f172a;margin:0 0 12px">${icon} Leave ${status.toLowerCase()}</h2>
      <p style="color:#475569;line-height:1.7">Hi ${user.name}, your leave request has been <strong style="color:${color}">${status.toLowerCase()}</strong>.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:20px;margin:20px 0">
        <div style="font-weight:700;color:#0f172a;margin-bottom:8px">${leave.leaveType}</div>
        <div style="color:#64748b;font-size:14px">${start} → ${end}</div>
        ${leave.reason ? `<div style="color:#64748b;font-size:13px;margin-top:8px">Reason: ${leave.reason}</div>` : ''}
      </div>
      ${approved
        ? '<p style="color:#10b981;font-size:13px">Your leave has been approved. Please ensure your work is handed over before you leave.</p>'
        : '<p style="color:#64748b;font-size:13px">If you have questions, please contact your manager directly.</p>'
      }
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open EMS →</a>
    `),
  });
}

module.exports = { sendWelcomeEmail, sendTaskAssigned, sendLeaveDecision };
