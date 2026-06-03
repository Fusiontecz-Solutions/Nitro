import { Queue } from 'bullmq';

export const COLLECTION_PAYMENT_UPLOAD_QUEUE = 'collection-payment-upload';

export type CollectionPaymentUploadJobData = {
  queueJobId: string;
  filePath: string;
  fileBufferBase64?: string;
  fileName: string;
  createdById: string | null;
};

let queueInstance: Queue<CollectionPaymentUploadJobData> | null = null;

const redisUrl = () => String(process.env.REDIS_URL || '').trim();

const getRedisConnectionOptions = () => ({
  url: redisUrl(),
  maxRetriesPerRequest: null as null,
  retryStrategy(times: number) {
    return Math.min(times * 200, 2000);
  },
});

export const isCollectionPaymentUploadQueueEnabled = (): boolean => Boolean(redisUrl());

export const getCollectionPaymentUploadQueue = (): Queue<CollectionPaymentUploadJobData> => {
  if (!isCollectionPaymentUploadQueueEnabled()) {
    throw new Error('Collection payment upload queue is disabled. REDIS_URL is not configured.');
  }

  if (!queueInstance) {
    queueInstance = new Queue<CollectionPaymentUploadJobData>(COLLECTION_PAYMENT_UPLOAD_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }

  return queueInstance;
};
