import prisma from '../config/prismaClient';
(async () => {
  const rows = await prisma.funderProfile.findMany({ select: { name: true, displayName: true, isActive: true, sendgridFromEmail: true, sendgridFromName: true, letterLogoUrl: true, letterCompanyName: true, letterAccentStripDark: true, letterAccentStripLight: true } });
  console.log(JSON.stringify(rows, null, 1));
  console.log('ENV FROM', process.env.SENDGRID_FROM_EMAIL, '|', process.env.SENDGRID_FROM_NAME);
  await prisma.$disconnect();
})();
