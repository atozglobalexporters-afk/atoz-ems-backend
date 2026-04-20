// src/routes/chat.js
const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const { v4: uuid } = require('uuid');
const { authenticate } = require('../middleware/auth');
const {
  getRooms, createRoom, getMessages, uploadFile, getUsers, addMember,
} = require('../controllers/chatController');

// File upload config for chat
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/chat/'),
  filename:    (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    // Allow images, PDFs, Office docs, and common file types
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|mp4|mp3/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

router.use(authenticate);
router.get('/users',                        getUsers);
router.get('/rooms',                        getRooms);
router.post('/rooms',                       createRoom);
router.get('/rooms/:roomId/messages',       getMessages);
router.post('/rooms/:roomId/messages/file', upload.single('file'), uploadFile);
router.post('/rooms/:roomId/members',       addMember);

module.exports = router;
