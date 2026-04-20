// src/app.js — A to Z Global EMS Final
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const { apiLimiter } = require('./middleware/rateLimiter');
const logger  = require('./utils/logger');

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map(o=>o.trim());
app.use(cors({
  origin: (origin, cb) => { if (!origin || allowedOrigins.includes(origin)) return cb(null,true); cb(new Error(`CORS blocked: ${origin}`)); },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use('/api/', apiLimiter);

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../../uploads'), { maxAge: '7d' }));

app.get('/health', (_, res) => res.json({ status: 'ok', version: '4.0', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/v1/auth',       require('./routes/auth'));
app.use('/api/v1/users',      require('./routes/users'));
app.use('/api/v1/attendance', require('./routes/attendance'));
app.use('/api/v1/tasks',      require('./routes/tasks'));
app.use('/api/v1/leaves',     require('./routes/leaves'));
app.use('/api/v1/reports',    require('./routes/reports'));
app.use('/api/v1/tools',      require('./routes/tools'));
app.use('/api/v1/audit',      require('./routes/audit'));
app.use('/api/v1/chat',       require('./routes/chat'));
app.use('/api/v1/erp',        require('./routes/erp'));

app.use((req, res) => res.status(404).json({ success: false, message: `${req.method} ${req.url} not found` }));
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, message: 'File too large' });
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

module.exports = app;
