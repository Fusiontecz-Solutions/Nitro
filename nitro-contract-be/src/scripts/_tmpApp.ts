require('../config/loadEnv');
const prisma = require('../config/prismaClient').default;
async function main() {
  const apps: any[] = await prisma.application.findMany({ where: { clientId: '87193c2f-3164-446c-ba91-ce5ef6d1fb2b' }, orderBy: { createdAt: 'desc' }, take: 4, select: { id: true, applicationId: true, dealId: true, loanAmount: true, createdAt: true } });
  for (const app of apps) {
    const od: any = await prisma.offerDecision.findFirst({ where: { applicationId: app.id } });
    console.log(JSON.stringify({ app: app.applicationId, dealId: app.dealId, loan: app.loanAmount, created: app.createdAt, offer: od && { decision: od.decision, offer: od.offer, totalRemit: od.totalRemit, term: od.term, frequency: od.frequency, repay: od.repayPerPeriod, fees: od.fees, rate: od.rate, refi: od.refinanceAmount, prevDate: od.previousDealDate } }));
  }
}
main().finally(() => prisma.$disconnect());
