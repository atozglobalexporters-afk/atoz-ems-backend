// src/controllers/userController.js
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../services/auditService');

const prisma = new PrismaClient();

const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      organizationId: req.user.organizationId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(role && { role: role.toUpperCase() }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true, name: true, email: true, role: true,
          department: true, isActive: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, password, role, department } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role || 'EMPLOYEE',
        department: department || null,
        organizationId: req.user.organizationId,
      },
      select: { id: true, name: true, email: true, role: true, department: true, createdAt: true },
    });

    // Email notification (fire-and-forget)
    try {
      const { sendWelcomeEmail } = require('../services/emailService');
      sendWelcomeEmail(user, password);
    } catch { /* email is optional */ }

    await createAuditLog(req.user.id, req.user.organizationId, `Created user: ${name}`, { targetUserId: user.id });

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, department, isActive } = req.body;

    const user = await prisma.user.findFirst({
      where: { id: parseInt(id), organizationId: req.user.organizationId },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name: name.trim() }),
        ...(role && { role }),
        ...(department !== undefined && { department }),
        ...(isActive !== undefined && { isActive }),
      },
      select: { id: true, name: true, email: true, role: true, department: true, isActive: true },
    });

    await createAuditLog(req.user.id, req.user.organizationId, `Updated user: ${updated.name}`);

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    const user = await prisma.user.findFirst({
      where: { id: parseInt(id), organizationId: req.user.organizationId },
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Soft delete — never hard delete
    await prisma.user.update({ where: { id: parseInt(id) }, data: { isActive: false, sessionToken: null } });

    await createAuditLog(req.user.id, req.user.organizationId, `Deactivated user: ${user.name}`);

    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser };
