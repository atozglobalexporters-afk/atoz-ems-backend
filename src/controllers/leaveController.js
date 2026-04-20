// src/controllers/leaveController.js
const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../services/auditService');

const prisma = new PrismaClient();

const getLeaves = async (req, res) => {
  try {
    const { status, userId, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      organizationId: req.user.organizationId,
      // Employees see only their own leaves
      ...(req.user.role === 'EMPLOYEE' && { userId: req.user.id }),
      // Admin/manager can filter by userId
      ...(userId && req.user.role !== 'EMPLOYEE' && { userId: parseInt(userId) }),
      ...(status && { status: status.toUpperCase() }),
    };

    const [leaves, total] = await Promise.all([
      prisma.leave.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.leave.count({ where }),
    ]);

    res.json({ success: true, data: leaves, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createLeave = async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;

    if (!leaveType || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Leave type, start date, and end date are required' });
    }
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ success: false, message: 'Start date must be before end date' });
    }

    const leave = await prisma.leave.create({
      data: {
        leaveType,
        reason: reason?.trim() || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        userId: req.user.id,
        organizationId: req.user.organizationId,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await createAuditLog(req.user.id, req.user.organizationId, `Applied for ${leaveType}`);

    res.status(201).json({ success: true, data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status?.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Status must be APPROVED or REJECTED' });
    }

    const leave = await prisma.leave.findFirst({
      where: { id: parseInt(id), organizationId: req.user.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found' });
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Only pending leaves can be updated' });
    }

    const updated = await prisma.leave.update({
      where: { id: parseInt(id) },
      data: { status: status.toUpperCase() },
    });

    // Real-time notification
    const io = req.app.get('io');
    io?.to(`user:${leave.userId}`).emit('notification', {
      type: status.toUpperCase() === 'APPROVED' ? 'leave_approved' : 'leave_rejected',
      title: `Leave ${status.toLowerCase()}`,
      message: `Your ${leave.leaveType} has been ${status.toLowerCase()}`,
      timestamp: new Date().toISOString(),
    });

    // Email notification (fire-and-forget)
    try {
      const { sendLeaveDecision } = require('../services/emailService');
      sendLeaveDecision(leave.user, leave, status.toUpperCase());
    } catch { /* email is optional */ }

    await createAuditLog(
      req.user.id,
      req.user.organizationId,
      `${status} leave for ${leave.user.name} (${leave.leaveType})`
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getLeaves, createLeave, updateLeave };
