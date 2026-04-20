// src/controllers/attendanceController.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const getAttendance = async (req, res) => {
  try {
    const { page = 1, limit = 50, date, userId, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      organizationId: req.user.organizationId,
      // Employees only see their own records
      ...(req.user.role === 'EMPLOYEE' && { userId: req.user.id }),
      // Admin/manager can filter by specific user
      ...(userId && req.user.role !== 'EMPLOYEE' && { userId: parseInt(userId) }),
      // Date filters
      ...(date && { date }),
      ...(startDate && endDate && { date: { gte: startDate, lte: endDate } }),
    };

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { loginTime: 'desc' },
      }),
      prisma.attendance.count({ where }),
    ]);

    res.json({
      success: true,
      data: records,
      pagination: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAttendance };
