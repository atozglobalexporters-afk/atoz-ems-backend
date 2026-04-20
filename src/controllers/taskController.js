// src/controllers/taskController.js
const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../services/auditService');

const prisma = new PrismaClient();

const getTasks = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, priority, userId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Employees only see their own tasks
    const targetUserId = req.user.role === 'EMPLOYEE'
      ? req.user.id
      : userId ? parseInt(userId) : undefined;

    const where = {
      organizationId: req.user.organizationId,
      ...(targetUserId && { userId: targetUserId }),
      ...(status && { status: status.toUpperCase() }),
      ...(priority && { priority: priority.toUpperCase() }),
    };

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.task.count({ where }),
    ]);

    res.json({ success: true, data: tasks, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createTask = async (req, res) => {
  try {
    const { title, description, userId, deadline, priority, status, progressPercentage } = req.body;

    if (!title || !userId || !deadline) {
      return res.status(400).json({ success: false, message: 'Title, assigned user, and deadline are required' });
    }
    if (new Date(deadline) < new Date()) {
      return res.status(400).json({ success: false, message: 'Deadline cannot be in the past' });
    }
    if (progressPercentage !== undefined && (progressPercentage < 0 || progressPercentage > 100)) {
      return res.status(400).json({ success: false, message: 'Progress must be 0–100' });
    }

    // Verify user belongs to same org
    const assignee = await prisma.user.findFirst({
      where: { id: parseInt(userId), organizationId: req.user.organizationId, isActive: true },
    });
    if (!assignee) {
      return res.status(404).json({ success: false, message: 'Assigned user not found in this organisation' });
    }

    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        deadline: new Date(deadline),
        priority: priority?.toUpperCase() || 'MEDIUM',
        status: status?.toUpperCase() || 'PENDING',
        progressPercentage: parseInt(progressPercentage || 0),
        userId: parseInt(userId),
        organizationId: req.user.organizationId,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Real-time notification via Socket.IO
    const io = req.app.get('io');
    io?.to(`user:${userId}`).emit('notification', {
      type: 'task_assigned',
      title: 'New task assigned',
      message: `"${title}" has been assigned to you`,
      timestamp: new Date().toISOString(),
    });

    // Email notification (fire-and-forget)
    try {
      const { sendTaskAssigned } = require('../services/emailService');
      sendTaskAssigned(assignee, task);
    } catch { /* email is optional */ }

    await createAuditLog(req.user.id, req.user.organizationId, `Created task: ${title}`, { taskId: task.id, assignedTo: userId });

    res.status(201).json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, priority, progressPercentage, deadline } = req.body;

    if (progressPercentage !== undefined && (parseInt(progressPercentage) < 0 || parseInt(progressPercentage) > 100)) {
      return res.status(400).json({ success: false, message: 'Progress must be 0–100' });
    }

    const task = await prisma.task.findFirst({
      where: { id: parseInt(id), organizationId: req.user.organizationId },
    });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    // Employees can only update their own tasks (progress/status only)
    if (req.user.role === 'EMPLOYEE' && task.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this task' });
    }

    const updated = await prisma.task.update({
      where: { id: parseInt(id) },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status && { status: status.toUpperCase() }),
        ...(priority && { priority: priority.toUpperCase() }),
        ...(progressPercentage !== undefined && { progressPercentage: parseInt(progressPercentage) }),
        ...(deadline && { deadline: new Date(deadline) }),
      },
      include: { user: { select: { id: true, name: true } } },
    });

    await createAuditLog(req.user.id, req.user.organizationId, `Updated task: ${updated.title} (${updated.progressPercentage}%)`);

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: { id: parseInt(id), organizationId: req.user.organizationId },
    });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    await prisma.task.delete({ where: { id: parseInt(id) } });
    await createAuditLog(req.user.id, req.user.organizationId, `Deleted task: ${task.title}`);

    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getTasks, createTask, updateTask, deleteTask };
