import prisma from '../config/prismaClient';
import { buildApplicationStatsBucketWhere } from './applicationStatsBucketWhere';

export type PlatformDealCounts = {
  totalDealsCount: number;
  fundedDealsCount: number;
};

/** Global application counts for Super Admin platform snapshot. */
export async function computePlatformDealCounts(): Promise<PlatformDealCounts> {
  const fundedWhere = buildApplicationStatsBucketWhere('funded');
  const [totalDealsCount, fundedDealsCount] = await Promise.all([
    prisma.application.count(),
    fundedWhere ? prisma.application.count({ where: fundedWhere }) : 0,
  ]);
  return { totalDealsCount, fundedDealsCount };
}
