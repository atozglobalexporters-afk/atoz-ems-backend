// src/routes/users.js
const router = require('express').Router();
const { getUsers, createUser, updateUser, deleteUser } = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);
router.get('/',    authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), getUsers);
router.post('/',   authorize('SUPER_ADMIN', 'ADMIN'), createUser);
router.put('/:id', authorize('SUPER_ADMIN', 'ADMIN'), updateUser);
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), deleteUser);

module.exports = router;
