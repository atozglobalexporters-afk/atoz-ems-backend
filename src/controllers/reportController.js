// src/controllers/reportController.js
const { PrismaClient } = require('@prisma/client');
const { Parser } = require('json2csv');

const prisma = new PrismaClient();

const getReports = async (req, res) => {
  try {
    const { startDate, endDate, format } = req.query;
    const orgId = req.user.organizationId;

    const [users, attendance, tasks] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true, role: true, department: true },
      }),
      prisma.attendance.findMany({
        where: {
          organizationId: orgId,
          ...(startDate && endDate && { date: { gte: startDate, lte: endDate } }),
        },
      }),
      prisma.task.findMany({
        where: { organizationId: orgId },
        select: { id: true, userId: true, status: true },
      }),
    ]);

    const report = users.map((user) => {
      const userAtt    = attendance.filter((a) => a.userId === user.id);
      const userTasks  = tasks.filter((t) => t.userId === user.id);
      const completed  = userTasks.filter((t) => t.status === 'COMPLETED').length;
      const present    = userAtt.filter((a) => a.logoutTime).length;
      const late       = userAtt.filter((a) => a.isLate).length;
      const totalHours = userAtt.reduce((sum, a) => sum + (a.totalHours || 0), 0);
      const productivity = userTasks.length ? Math.round((completed / userTasks.length) * 100) : 0;

      return {
        name:           user.name,
        role:           user.role,
        department:     user.department || '—',
        daysPresent:    present,
        lateLogins:     late,
        totalHours:     totalHours.toFixed(1),
        tasksAssigned:  userTasks.length,
        tasksCompleted: completed,
        productivity:   `${productivity}%`,
      };
    });

    if (format === 'csv') {
      try {
        const parser = new Parser();
        const csv = parser.parse(report);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="ems-report-${new Date().toISOString().split('T')[0]}.csv"`);
        return res.send(csv);
      } catch (csvErr) {
        return res.status(500).json({ success: false, message: 'CSV generation failed' });
      }
    }

    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getReports };
