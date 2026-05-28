import express, { Application, NextFunction, Request, Response } from 'express';
import './config/loadEnv';
import 'reflect-metadata';
import { createServer } from 'http';
import { startCronJob } from './cron-job/crmGmailCronJob';
import fileUpload from 'express-fileupload';
import connectDB from './config/database';
import router from './routes/index';
import cors from 'cors';
import cloudinaryConnect from './config/cloudinary';
import { initializeSocketIO } from './socket/index';
import { testRedisConnection } from './config/redis';
import { ensurePayoffWireTemplate } from './bootstrap/ensurePayoffWireTemplate';
import { ensureZeroBalanceLetterTemplate } from './bootstrap/ensureZeroBalanceLetterTemplate';
import { startCollectionPaymentUploadWorker } from './workers/collectionPaymentUploadWorker';
import { startApplicationApprovalWorker } from './workers/applicationApprovalWorker';
import { verifySuperAdminProxy } from './middleware/verifySuperAdminProxy';

process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[process] unhandledRejection:', reason, promise);
});

// Create Express application
const app: Application = express();
const PORT = process.env.PORT || 4000;

// Create HTTP server for Socket.IO
const httpServer = createServer(app);

app.use(
  cors({
    // Allow the browser to read Content-Disposition on blob responses (Gmail attachment filename).
    exposedHeaders: ['Content-Disposition'],
  })
);
// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// File upload middleware - handles multipart/form-data (req.files) for most routes.
// IMPORTANT: Do not run this on routes that use Multer — both parse multipart/body and the
// stream can only be consumed once (Multer then throws "Unexpected end of form").
import os from 'os';
const expressFileUploadMiddleware = fileUpload({
  useTempFiles: true,
  tempFileDir: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  abortOnLimit: true,
});

app.use((req, res, next) => {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return next();
  }
  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  if (
    pathOnly.includes('/applications/upload') ||
    pathOnly.includes('/applications/bulk-upload-excel') ||
    pathOnly.includes('/transactions/upload') ||
    pathOnly.includes('/pdf-extraction/')
  ) {
    return next();
  }
  return expressFileUploadMiddleware(req, res, next);
});

cloudinaryConnect();
console.log('Starting CRM Email Bot...');
startCronJob();
// Test Redis connection
testRedisConnection().catch(console.error);
startCollectionPaymentUploadWorker();
startApplicationApprovalWorker();

// Initialize Socket.IO
initializeSocketIO(httpServer);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1', verifySuperAdminProxy, router);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Not Found',
    path: req.path,
  });
});

// Error handling middleware — must be last (after all other `app.use` without 4 args)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error('Error:', err);
  const status =
    err &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(status).json({
    status: 'error',
    message,
  });
});

// Start the HTTP server after DB is ready (seed default templates)
void (async () => {
  await connectDB();
  await ensurePayoffWireTemplate().catch((err) => {
    console.error('ensurePayoffWireTemplate:', err);
  });
  await ensureZeroBalanceLetterTemplate().catch((err) => {
    console.error('ensureZeroBalanceLetterTemplate:', err);
  });
  httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Socket.IO server initialized`);
  });
})();

export default app;
