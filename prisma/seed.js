// prisma/seed.js
// Creates ONE organization + ONE super-admin only.
// All other users are created through the app by admins.
// Max 3 admins enforced at backend level.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Setting up A to Z Global EMS...\n');

  // Prevent double-seeding
  const existing = await prisma.organization.findFirst();
  if (existing) {
    console.log('⚠  Database already seeded. Skipping.');
    console.log('   To reset: npx prisma migrate reset --force\n');
    return;
  }

  // Create organization
  const org = await prisma.organization.create({
    data: { name: 'A to Z Global Exporters' },
  });

  // Admin password from env, fallback to a secure default
  const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMe@2026!';
  const adminEmail = process.env.ADMIN_INITIAL_EMAIL   || 'admin@atozglobal.com';

  const hashed = await bcrypt.hash(adminPass, 12);

  const admin = await prisma.user.create({
    data: {
      name:           'System Admin',
      email:          adminEmail,
      password:       hashed,
      role:           'ADMIN',
      department:     'Management',
      organizationId: org.id,
    },
  });

  // Create default chat channels
  const general = await prisma.chatRoom.create({
    data: {
      name:           'general',
      type:           'GROUP',
      description:    'Company-wide announcements',
      organizationId: org.id,
      createdById:    admin.id,
      members: { create: [{ userId: admin.id, role: 'ADMIN' }] },
    },
  });

  await prisma.message.create({
    data: {
      content:        'Welcome to A to Z Global EMS! 🎉',
      type:           'SYSTEM',
      roomId:         general.id,
      senderId:       admin.id,
      organizationId: org.id,
    },
  });

  console.log('✅ Seed complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Organisation:', org.name);
  console.log('  Organisation ID:', org.id, '(share with employees)');
  console.log('  Admin email:   ', adminEmail);
  console.log('  Admin password:', adminPass);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n⚠  IMPORTANT: Change the admin password on first login!');
  console.log('   You can set ADMIN_INITIAL_PASSWORD in your .env before seeding.\n');
}

main()
  .catch(e => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
