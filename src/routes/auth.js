// src/routes/auth.js
const router = require('express').Router();
const { register, login, googleLogin, logout, me, createEmployee } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/rbac');
const { loginLimiter } = require('../middleware/rateLimiter');

// Public
router.post('/register', loginLimiter, register);
router.post('/login',    loginLimiter, login);
router.post('/google',   loginLimiter, googleLogin);  // Google OAuth

// Protected
router.post('/logout', authenticate, logout);
router.get('/me',      authenticate, me);

// Admin-only: create employee (no self-registration)
router.post('/admin/create-employee',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN'),
  createEmployee
);

module.exports = router;
