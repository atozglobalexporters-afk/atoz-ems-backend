// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../services/auditService');
const logger = require('../utils/logger');

const prisma = new PrismaClient();
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

const MAX_ADMINS = 3;

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, orgId: user.organizationId, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function safeUser(user) {
  return {
    id:               user.id,
    name:             user.name,
    email:            user.email,
    role:             user.role,
    department:       user.department,
    avatar:           user.avatar,
    organizationId:   user.organizationId,
    organizationName: user.organization?.name,
  };
}

// ── POST /api/v1/auth/register ────────────────────────────────
// Admin-only: creates employees. First-time org setup creates admin.
const register = async (req, res) => {
  try {
    const { name, email, password, role, orgName, orgId } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Resolve organisation
    let org;
    if (orgId) {
      org = await prisma.organization.findUnique({ where: { id: parseInt(orgId) } });
      if (!org) return res.status(404).json({ success: false, message: 'Organisation not found' });
    } else {
      const orgTitle = orgName?.trim() || `${name}'s Organisation`;
      org = await prisma.organization.create({ data: { name: orgTitle } });
    }

    // First user in a fresh org → ADMIN automatically
    const userCount = await prisma.user.count({ where: { organizationId: org.id } });
    let assignedRole = userCount === 0 ? 'ADMIN' : (role || 'EMPLOYEE');

    // Hard cap: max 3 admins
    if (['ADMIN', 'SUPER_ADMIN'].includes(assignedRole)) {
      const adminCount = await prisma.user.count({
        where: { organizationId: org.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      });
      if (adminCount >= MAX_ADMINS) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_ADMINS} admins allowed per organisation`,
        });
      }
    }

    const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    const user = await prisma.user.create({
      data: {
        name:           name.trim(),
        email:          email.toLowerCase().trim(),
        password:       hashed,
        role:           assignedRole,
        department:     req.body.department || null,
        organizationId: org.id,
      },
      include: { organization: true },
    });

    const token = signToken(user);
    await prisma.user.update({ where: { id: user.id }, data: { sessionToken: token } });

    // Auto-create attendance on first login
    const today = new Date().toISOString().split('T')[0];
    const loginTime = new Date();
    const isLate = loginTime.getHours() > 9 || (loginTime.getHours() === 9 && loginTime.getMinutes() > 15);
    await prisma.attendance.create({
      data: { userId: user.id, organizationId: org.id, loginTime, date: today, isLate },
    });

    // Add to #general chat if it exists
    const general = await prisma.chatRoom.findFirst({
      where: { organizationId: org.id, name: 'general' },
    });
    if (general) {
      await prisma.chatRoomMember.upsert({
        where: { roomId_userId: { roomId: general.id, userId: user.id } },
        create: { roomId: general.id, userId: user.id, role: 'MEMBER' },
        update: {},
      });
    }

    await createAuditLog(user.id, org.id, `User registered: ${name}`, { role: assignedRole });

    res.status(201).json({
      success: true,
      message: `Account created. You are logged in as ${assignedRole}.`,
      token,
      user:    safeUser(user),
    });
  } catch (err) {
    logger.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// ── POST /api/v1/auth/login ───────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!user.password) {
      return res.status(401).json({ success: false, message: 'This account uses Google login' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = signToken(user);
    await prisma.user.update({ where: { id: user.id }, data: { sessionToken: token } });

    // Auto-attendance
    const today = new Date().toISOString().split('T')[0];
    const exists = await prisma.attendance.findFirst({ where: { userId: user.id, date: today } });
    if (!exists) {
      const loginTime = new Date();
      const isLate = loginTime.getHours() > 9 || (loginTime.getHours() === 9 && loginTime.getMinutes() > 15);
      await prisma.attendance.create({
        data: { userId: user.id, organizationId: user.organizationId, loginTime, date: today, isLate },
      });
    }

    await createAuditLog(user.id, user.organizationId, 'User login', { ip: req.ip });

    res.json({ success: true, token, user: safeUser(user) });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ── POST /api/v1/auth/google ──────────────────────────────────
const googleLogin = async (req, res) => {
  try {
    if (!googleClient) {
      return res.status(501).json({ success: false, message: 'Google OAuth not configured' });
    }

    const { credential, orgId } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential required' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
      include: { organization: true },
    });

    if (!user) {
      // New Google user — must belong to an existing org
      let org;
      if (orgId) {
        org = await prisma.organization.findUnique({ where: { id: parseInt(orgId) } });
        if (!org) return res.status(404).json({ success: false, message: 'Organisation not found. Ask your admin for the Org ID.' });
      } else {
        // First person creates org
        org = await prisma.organization.create({ data: { name: `${name}'s Organisation` } });
      }

      const userCount = await prisma.user.count({ where: { organizationId: org.id } });
      const assignedRole = userCount === 0 ? 'ADMIN' : 'EMPLOYEE';

      if (['ADMIN'].includes(assignedRole)) {
        const adminCount = await prisma.user.count({
          where: { organizationId: org.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
        });
        if (adminCount >= MAX_ADMINS) {
          return res.status(400).json({ success: false, message: `Max ${MAX_ADMINS} admins allowed` });
        }
      }

      user = await prisma.user.create({
        data: {
          name, email, googleId,
          avatar:         picture || null,
          role:           assignedRole,
          organizationId: org.id,
        },
        include: { organization: true },
      });
    } else {
      // Update googleId if missing
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId, avatar: user.avatar || picture },
          include: { organization: true },
        });
      }
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account deactivated' });
    }

    const token = signToken(user);
    await prisma.user.update({ where: { id: user.id }, data: { sessionToken: token } });

    await createAuditLog(user.id, user.organizationId, 'Google login');

    res.json({ success: true, token, user: safeUser(user) });
  } catch (err) {
    logger.error('Google login error:', err);
    res.status(500).json({ success: false, message: 'Google login failed' });
  }
};

// ── POST /api/v1/auth/logout ──────────────────────────────────
const logout = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const att = await prisma.attendance.findFirst({
      where: { userId: req.user.id, date: today, logoutTime: null },
      orderBy: { loginTime: 'desc' },
    });
    if (att) {
      const out = new Date();
      const hrs = parseFloat(((out - att.loginTime) / 3600000).toFixed(2));
      await prisma.attendance.update({ where: { id: att.id }, data: { logoutTime: out, totalHours: hrs } });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { sessionToken: null } });
    await createAuditLog(req.user.id, req.user.organizationId, 'User logout');
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

// ── GET /api/v1/auth/me ───────────────────────────────────────
const me = async (req, res) => {
  res.json({ success: true, user: safeUser(req.user) });
};

// ── POST /api/v1/auth/admin/create-employee ───────────────────
// Only admins can create employees (no self-registration)
const createEmployee = async (req, res) => {
  try {
    const { name, email, password, role, department } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });

    // Enforce admin cap
    const safeRole = role || 'EMPLOYEE';
    if (['ADMIN', 'SUPER_ADMIN'].includes(safeRole)) {
      const adminCount = await prisma.user.count({
        where: { organizationId: req.user.organizationId, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      });
      if (adminCount >= MAX_ADMINS) {
        return res.status(400).json({ success: false, message: `Max ${MAX_ADMINS} admins allowed` });
      }
    }

    const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const user = await prisma.user.create({
      data: {
        name:           name.trim(),
        email:          email.toLowerCase().trim(),
        password:       hashed,
        role:           safeRole,
        department:     department || null,
        organizationId: req.user.organizationId,
      },
      select: { id: true, name: true, email: true, role: true, department: true, createdAt: true },
    });

    // Auto-add to #general
    const general = await prisma.chatRoom.findFirst({
      where: { organizationId: req.user.organizationId, name: 'general' },
    });
    if (general) {
      await prisma.chatRoomMember.upsert({
        where: { roomId_userId: { roomId: general.id, userId: user.id } },
        create: { roomId: general.id, userId: user.id, role: 'MEMBER' },
        update: {},
      });
    }

    // Email welcome (fire-and-forget)
    try {
      const { sendWelcomeEmail } = require('../services/emailService');
      sendWelcomeEmail(user, password);
    } catch { /* optional */ }

    await createAuditLog(req.user.id, req.user.organizationId, `Created employee: ${name}`);

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    logger.error('createEmployee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { register, login, googleLogin, logout, me, createEmployee };
