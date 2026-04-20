// server.js
require('dotenv').config();
const http   = require('http');
const { Server } = require('socket.io');
const jwt    = require('jsonwebtoken');
const app    = require('./src/app');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map(o=>o.trim());

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e7,
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = d.userId; socket.userName = d.name;
    socket.userRole = d.role; socket.orgId = d.orgId;
    next();
  } catch { next(new Error('Invalid token')); }
});

io.on('connection', async (socket) => {
  logger.info(`Socket: user ${socket.userId} connected`);
  socket.join(`user:${socket.userId}`);
  socket.join(`org:${socket.orgId}`);

  try {
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    await p.user.update({ where:{ id:socket.userId }, data:{ lastSeen: new Date() } });
    await p.$disconnect();
  } catch {}

  socket.on('chat:join',  rid => socket.join(`room:${rid}`));
  socket.on('chat:leave', rid => socket.leave(`room:${rid}`));

  socket.on('chat:message', async data => {
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    try {
      const member = await p.chatRoomMember.findUnique({
        where: { roomId_userId: { roomId: parseInt(data.roomId), userId: socket.userId } },
      });
      if (!member) { socket.emit('error', { message: 'Not a member' }); return; }
      const msg = await p.message.create({
        data: { content: data.content, type: 'TEXT', roomId: parseInt(data.roomId), senderId: socket.userId, organizationId: socket.orgId, replyToId: data.replyToId ? parseInt(data.replyToId) : null },
        include: { sender: { select:{ id:true, name:true, avatar:true } }, replyTo: { select:{ id:true, content:true, sender:{ select:{ name:true } } } } },
      });
      io.to(`room:${data.roomId}`).emit('chat:message', msg);
      const members = await p.chatRoomMember.findMany({ where:{ roomId:parseInt(data.roomId), userId:{ not:socket.userId } } });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit('notification', { type:'chat', title:'New message', message:`${socket.userName}: ${data.content?.substring(0,60)}`, roomId:data.roomId, timestamp:new Date().toISOString() });
      }
    } catch (err) { logger.error('chat:message error:', err.message); }
    finally { await p.$disconnect(); }
  });

  socket.on('chat:typing', data => {
    socket.to(`room:${data.roomId}`).emit('chat:typing', { userId:socket.userId, userName:socket.userName, roomId:data.roomId, typing:data.typing });
  });

  socket.on('chat:edit', async data => {
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    try {
      const msg = await p.message.findUnique({ where:{ id:parseInt(data.messageId) } });
      if (!msg || msg.senderId !== socket.userId) { socket.emit('error',{ message:'Cannot edit' }); return; }
      const updated = await p.message.update({
        where:{ id:parseInt(data.messageId) },
        data:{ content:data.content, isEdited:true, editedAt:new Date() },
        include:{ sender:{ select:{ id:true,name:true,avatar:true } } },
      });
      io.to(`room:${msg.roomId}`).emit('chat:edited', updated);
    } catch { } finally { await p.$disconnect(); }
  });

  socket.on('chat:delete', async data => {
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    try {
      const msg = await p.message.findUnique({ where:{ id:parseInt(data.messageId) } });
      if (!msg) return;
      const canAll = msg.senderId===socket.userId || ['ADMIN','SUPER_ADMIN'].includes(socket.userRole);
      if (data.deleteFor==='everyone' && canAll) {
        await p.message.update({ where:{ id:msg.id }, data:{ isDeleted:true, deletedAt:new Date(), content:null, fileUrl:null } });
        io.to(`room:${msg.roomId}`).emit('chat:deleted', { messageId:msg.id, roomId:msg.roomId, deleteFor:'everyone' });
      } else {
        socket.emit('chat:deleted', { messageId:msg.id, roomId:msg.roomId, deleteFor:'me' });
      }
    } catch { } finally { await p.$disconnect(); }
  });

  socket.on('chat:read', async data => {
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    try {
      await p.chatRoomMember.updateMany({ where:{ roomId:parseInt(data.roomId), userId:socket.userId }, data:{ lastReadAt:new Date() } });
      socket.to(`room:${data.roomId}`).emit('chat:read', { roomId:data.roomId, userId:socket.userId });
    } catch { } finally { await p.$disconnect(); }
  });

  socket.on('admin:broadcast', message => {
    if (!['ADMIN','SUPER_ADMIN','MANAGER'].includes(socket.userRole)) return;
    io.to(`org:${socket.orgId}`).emit('notification', { type:'broadcast', title:'Announcement', message, timestamp:new Date().toISOString() });
  });

  socket.on('disconnect', async () => {
    logger.info(`Socket: user ${socket.userId} disconnected`);
    try {
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      await p.user.update({ where:{ id:socket.userId }, data:{ lastSeen:new Date() } });
      await p.$disconnect();
    } catch {}
  });
});

app.set('io', io);

// Auto-close attendance
const AUTO_HOURS = parseInt(process.env.AUTO_LOGOUT_HOURS || '10');
setInterval(async () => {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const cutoff = new Date(Date.now() - AUTO_HOURS * 3600000);
    const stale = await p.attendance.findMany({ where: { logoutTime:null, loginTime:{ lt:cutoff } } });
    for (const r of stale) {
      await p.attendance.update({ where:{ id:r.id }, data:{ logoutTime:new Date(), totalHours:AUTO_HOURS, autoClosedAt:new Date() } });
    }
    if (stale.length) logger.info(`Auto-closed ${stale.length} attendance records`);
  } catch (err) { logger.error('Auto-close error:', err.message); }
  finally { await p.$disconnect(); }
}, 3600000);

server.listen(PORT, () => logger.info(`A to Z EMS v4 running on port ${PORT} [${process.env.NODE_ENV||'development'}]`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
