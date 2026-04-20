// src/routes/tasks.js
const router = require('express').Router();
const { getTasks, createTask, updateTask, deleteTask } = require('../controllers/taskController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);
router.get('/',    getTasks);
router.post('/',   authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), createTask);
router.put('/:id', updateTask);   // all roles — controller enforces employee-only-own
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), deleteTask);

module.exports = router;
