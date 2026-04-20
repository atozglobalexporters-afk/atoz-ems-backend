// src/controllers/chatController.js
const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../services/auditService');
const logger = require('../utils/logger');
const path   = require('path');
const fs     = require('fs');

const prisma = new PrismaClient();

// ── GET /api/v1/chat/rooms ────────────────────────────────────
// List all rooms the current user is a member of
const getRooms = async (req, res) => {
  try {
    const rooms = await prisma.chatRoom.findMany({
      where: {
        organizationId: req.user.organizationId,
        members: { some: { userId: req.user.id } },
      },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, avatar: true, lastSeen: true } } },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: { id: true, name: true } } },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Add unread count per room
    const enriched = await Promise.all(rooms.map(async (room) => {
      const member = room.members.find(m => m.userId === req.user.id);
      const unread = member?.lastReadAt
        ? await prisma.message.count({
            where: {
              roomId: room.id,
              createdAt: { gt: member.lastReadAt },
              senderId: { not: req.user.id },
              isDeleted: false,
            },
          })
        : await prisma.message.count({
            where: { roomId: room.id, senderId: { not: req.user.id }, isDeleted: false },
          });
      return { ...room, unreadCount: unread };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error('getRooms error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/v1/chat/rooms ───────────────────────────────────
// Create a new group room or start a private DM
const createRoom = async (req, res) => {
  try {
    const { name, type = 'GROUP', description, memberIds = [] } = req.body;

    if (type === 'PRIVATE') {
      if (memberIds.length !== 1) {
        return res.status(400).json({ success: false, message: 'Private chat requires exactly 1 other user' });
      }
      // Check if DM already exists
      const existing = await prisma.chatRoom.findFirst({
        where: {
          type: 'PRIVATE',
          organizationId: req.user.organizationId,
          AND: [
            { members: { some: { userId: req.user.id } } },
            { members: { some: { userId: parseInt(memberIds[0]) } } },
          ],
        },
      });
      if (existing) return res.json({ success: true, data: existing, existed: true });
    }

    const allMemberIds = [...new Set([req.user.id, ...memberIds.map(Number)])];

    const room = await prisma.chatRoom.create({
      data: {
        name:          type === 'GROUP' ? name : null,
        type,
        description,
        organizationId: req.user.organizationId,
        createdById:   req.user.id,
        members: {
          create: allMemberIds.map(uid => ({
            userId: uid,
            role: uid === req.user.id ? 'ADMIN' : 'MEMBER',
          })),
        },
      },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });

    // Notify new members via Socket.IO
    const io = req.app.get('io');
    for (const uid of allMemberIds) {
      if (uid !== req.user.id) {
        io?.to(`user:${uid}`).emit('chat:roomInvite', room);
      }
    }

    res.status(201).json({ success: true, data: room });
  } catch (err) {
    logger.error('createRoom error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/v1/chat/rooms/:roomId/messages ───────────────────
const getMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { cursor, limit = 50 } = req.query;

    // Verify membership
    const member = await prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId: parseInt(roomId), userId: req.user.id } },
    });
    if (!member) return res.status(403).json({ success: false, message: 'Not a member of this room' });

    const messages = await prisma.message.findMany({
      where: {
        roomId: parseInt(roomId),
        ...(cursor && { id: { lt: parseInt(cursor) } }),
      },
      include: {
        sender:  { select: { id: true, name: true, avatar: true } },
        replyTo: { select: { id: true, content: true, fileName: true, sender: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });

    // Return in ascending order for display
    const ordered = messages.reverse();
    const nextCursor = messages.length === parseInt(limit) ? messages[0]?.id : null;

    res.json({ success: true, data: ordered, nextCursor });
  } catch (err) {
    logger.error('getMessages error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/v1/chat/rooms/:roomId/messages/file ─────────────
// Upload a file and create a message
const uploadFile = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content, replyToId } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Verify membership
    const member = await prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId: parseInt(roomId), userId: req.user.id } },
    });
    if (!member) {
      fs.unlinkSync(req.file.path); // clean up orphan file
      return res.status(403).json({ success: false, message: 'Not a member of this room' });
    }

    const fileUrl      = `/uploads/chat/${req.file.filename}`;
    const isImage      = req.file.mimetype.startsWith('image/');
    const messageType  = isImage ? 'IMAGE' : 'FILE';

    const message = await prisma.message.create({
      data: {
        content:       content || null,
        type:          messageType,
        fileUrl,
        fileName:      req.file.originalname,
        fileSize:      req.file.size,
        fileMimeType:  req.file.mimetype,
        roomId:        parseInt(roomId),
        senderId:      req.user.id,
        organizationId: req.user.organizationId,
        replyToId:     replyToId ? parseInt(replyToId) : null,
      },
      include: {
        sender:  { select: { id: true, name: true, avatar: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { name: true } } } },
      },
    });

    // Broadcast via Socket.IO
    const io = req.app.get('io');
    io?.to(`room:${roomId}`).emit('chat:message', message);

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    logger.error('uploadFile error:', err.message);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/v1/chat/users ────────────────────────────────────
// List org users to start a DM with
const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId, isActive: true, id: { not: req.user.id } },
      select: { id: true, name: true, email: true, avatar: true, role: true, lastSeen: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/v1/chat/rooms/:roomId/members ───────────────────
const addMember = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    await prisma.chatRoomMember.create({
      data: { roomId: parseInt(roomId), userId: parseInt(userId), role: 'MEMBER' },
    });

    // System message
    const msg = await prisma.message.create({
      data: {
        type:          'SYSTEM',
        content:       `A new member was added to the room`,
        roomId:        parseInt(roomId),
        senderId:      req.user.id,
        organizationId: req.user.organizationId,
      },
      include: { sender: { select: { id: true, name: true } } },
    });

    const io = req.app.get('io');
    io?.to(`room:${roomId}`).emit('chat:message', msg);
    io?.to(`user:${userId}`).emit('chat:roomInvite', { roomId });

    res.json({ success: true, message: 'Member added' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getRooms, createRoom, getMessages, uploadFile, getUsers, addMember };
