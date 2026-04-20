// src/routes/audit.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/rbac');

const prisma = new PrismaClient();

router.use(authenticate);

// GET /api/v1/audit — admin only
router.get('/', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { organizationId: req.user.organizationId },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { timestamp: 'desc' },
        skip, take: parseInt(limit),
      }),
      prisma.auditLog.count({ where: { organizationId: req.user.organizationId } }),
    ]);

    res.json({ success: true, data: logs, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
