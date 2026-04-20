// src/routes/attendance.js
const router = require('express').Router();
const { getAttendance } = require('../controllers/attendanceController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.get('/', getAttendance);

module.exports = router;
