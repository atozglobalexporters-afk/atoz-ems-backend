// src/routes/tools.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

router.use(authenticate);

// GET /api/v1/tools — list all available tools with metadata
router.get('/', async (req, res) => {
  try {
    const TOOLS = [
      // Internal tools
      { id:'analytics',   name:'Analytics Dashboard', category:'Internal',     icon:'📊', internal:true,  tab:'analytics',  description:'View KPIs and reports' },
      { id:'erp',         name:'Export Business',     category:'Internal',     icon:'🚢', internal:true,  tab:'erp',        description:'Shipments, products & payments' },
      { id:'chat',        name:'Team Chat',            category:'Internal',     icon:'💬', internal:true,  tab:'chat',       description:'Real-time messaging' },
      // Comms
      { id:'gmail',       name:'Gmail',                category:'Comms',        icon:'✉', url:'https://mail.google.com',         description:'Company email inbox' },
      { id:'meet',        name:'Google Meet',          category:'Comms',        icon:'🎥', url:'https://meet.google.com',          description:'Video meetings' },
      { id:'whatsapp',    name:'WhatsApp Web',         category:'Comms',        icon:'💬', url:'https://web.whatsapp.com',         description:'WhatsApp messaging' },
      // Productivity
      { id:'drive',       name:'Google Drive',         category:'Productivity', icon:'📁', url:'https://drive.google.com',         description:'Shared files & docs' },
      { id:'excel',       name:'Excel Online',         category:'Productivity', icon:'📊', url:'https://office.com/launch/excel',  description:'Spreadsheets' },
      { id:'word',        name:'Word Online',          category:'Productivity', icon:'📝', url:'https://office.com/launch/word',   description:'Documents' },
      { id:'calendar',    name:'Google Calendar',      category:'Productivity', icon:'📅', url:'https://calendar.google.com',      description:'Schedule meetings' },
      // Social
      { id:'instagram',   name:'Instagram',            category:'Social',       icon:'📷', url:'https://www.instagram.com',        description:'Instagram business page' },
      { id:'facebook',    name:'Facebook',             category:'Social',       icon:'👥', url:'https://www.facebook.com',         description:'Facebook business page' },
      { id:'twitter',     name:'Twitter / X',          category:'Social',       icon:'🐦', url:'https://twitter.com',              description:'Twitter / X account' },
      { id:'linkedin',    name:'LinkedIn',             category:'Social',       icon:'💼', url:'https://linkedin.com',             description:'LinkedIn company page' },
      // Search
      { id:'google',      name:'Google Search',        category:'External',     icon:'🔍', url:'https://www.google.com',           description:'Search the web' },
    ];

    // Fetch recent usage
    const recent = await prisma.toolUsageLog.groupBy({
      by: ['toolId'],
      where: { userId: req.user.id },
      _count: { toolId: true },
      _max:   { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: 6,
    });
    const recentIds = recent.map(r => r.toolId);

    res.json({ success: true, data: TOOLS, recentIds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tools/log
router.post('/log', async (req, res) => {
  try {
    const { toolId, toolName, action = 'OPENED' } = req.body;
    if (!toolId || !toolName) {
      return res.status(400).json({ success: false, message: 'toolId and toolName required' });
    }
    await prisma.toolUsageLog.create({
      data: { toolId, toolName, action, userId: req.user.id, organizationId: req.user.organizationId },
    });
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error('Tool log error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/tools/recent
router.get('/recent', async (req, res) => {
  try {
    const recent = await prisma.toolUsageLog.groupBy({
      by: ['toolId', 'toolName'],
      where: { userId: req.user.id },
      _count:   { toolId: true },
      _max:     { createdAt: true },
      orderBy:  { _max: { createdAt: 'desc' } },
      take: 10,
    });
    res.json({ success: true, data: recent.map(r => ({ toolId: r.toolId, toolName: r.toolName, count: r._count.toolId, lastUsed: r._max.createdAt })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
