// src/routes/reports.js
const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/rbac');
const { getReports }   = require('../controllers/reportController');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/summary', async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const range = req.query.range || '30d';
    const now   = new Date();
    const start = new Date();
    if (range === 'today') start.setHours(0,0,0,0);
    else if (range === '7d')  start.setDate(now.getDate()-7);
    else if (range === '90d') start.setDate(now.getDate()-90);
    else start.setDate(now.getDate()-30);

    const isAdmin = ['ADMIN','SUPER_ADMIN','MANAGER'].includes(req.user.role);
    const tF = isAdmin ? { organizationId:orgId } : { organizationId:orgId, userId:req.user.id };
    const aF = { organizationId:orgId, loginTime:{ gte:start } };
    if (!isAdmin) aF.userId = req.user.id;

    const [totalUsers,activeUsers,totalTasks,completedTasks,inProgressTasks,pendingTasks,attRecs] = await Promise.all([
      prisma.user.count({ where: isAdmin?{ organizationId:orgId }:{ id:req.user.id } }),
      prisma.user.count({ where: isAdmin?{ organizationId:orgId,isActive:true }:{ id:req.user.id } }),
      prisma.task.count({ where: tF }),
      prisma.task.count({ where: { ...tF, status:'COMPLETED' } }),
      prisma.task.count({ where: { ...tF, status:'IN_PROGRESS' } }),
      prisma.task.count({ where: { ...tF, status:'PENDING' } }),
      prisma.attendance.findMany({ where: aF, select:{ totalHours:true, isLate:true, date:true, loginTime:true } }),
    ]);

    const lateLogins     = attRecs.filter(a=>a.isLate).length;
    const presentRecords = attRecs.filter(a=>a.loginTime);
    const hoursRecs      = attRecs.filter(a=>a.totalHours&&a.totalHours>0);
    const avgHours       = hoursRecs.length ? parseFloat((hoursRecs.reduce((s,a)=>s+a.totalHours,0)/hoursRecs.length).toFixed(2)) : 0;
    const workDays       = Math.max(1, Math.round(((now-start)/86400000)*(5/7)));
    const attPct         = parseFloat(Math.min(100,(presentRecords.length/Math.max(1,totalUsers*workDays))*100).toFixed(1));

    const trendMap = {};
    attRecs.forEach(a=>{ const d=a.date; if(!trendMap[d])trendMap[d]={date:d,present:0,late:0}; if(a.loginTime){if(a.isLate)trendMap[d].late++;else trendMap[d].present++;} });
    const attendanceTrend = Object.values(trendMap).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(-14).map(d=>({ date:new Date(d.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}), present:d.present, late:d.late }));

    res.json({ success:true, data:{ totalUsers,activeUsers,totalTasks,completedTasks,inProgressTasks,pendingTasks,averageWorkingHours:avgHours,lateLogins,attendancePercentage:attPct,attendanceTrend,range } });
  } catch (err) { res.status(500).json({ success:false, message:err.message }); }
});

router.get('/', authorize('SUPER_ADMIN','ADMIN','MANAGER'), getReports);
module.exports = router;
