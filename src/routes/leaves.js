// src/routes/leaves.js
const router = require('express').Router();
const { getLeaves, createLeave, updateLeave } = require('../controllers/leaveController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);
router.get('/',    getLeaves);
router.post('/',   authorize('EMPLOYEE', 'MANAGER'), createLeave);
router.put('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), updateLeave);

module.exports = router;
