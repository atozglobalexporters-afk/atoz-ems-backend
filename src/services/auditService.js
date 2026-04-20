// src/services/auditService.js
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

const createAuditLog = async (userId, organizationId, action, metadata = {}) => {
  try {
    await prisma.auditLog.create({
      data: { userId, organizationId, action, metadata },
    });
  } catch (err) {
    // Audit log failure must never crash the main request
    logger.error('Audit log error:', err.message);
  }
};

module.exports = { createAuditLog };
