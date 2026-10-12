import express, { Application, NextFunction, Request, Response } from 'express';
import './config/loadEnv';
import 'reflect-metadata';
import { createServer } from 'http';
import fileUpload from 'express-fileupload';
import connectDB from './config/database';
import router from './routes/index';
import cors from 'cors';
import cloudinaryConnect from './config/cloudinary';
import { initializeSocketIO } from './socket/index';
import { testRedisConnection } from './config/redis';
import { startApplicationApprovalWorker } from './workers/applicationApprovalWorker';
import { verifySuperAdminProxy } from './middleware/verifySuperAdminProxy';
import { activityLogger } from './middleware/activityLogger';
import { describeDefaultMailSender } from './config/nodemailer';
import { startSignNowContractStatusJob } from './cron-job/signNowContractStatusJob';

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
// Capture the raw request body so webhook signature verification (e.g. SendGrid
// "Signed Event Webhook" ECDSA check) can hash the exact bytes SendGrid signed.
// Without this, req.rawBody is undefined and signed webhooks are rejected.
app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// File upload middleware - handles multipart/form-data (req.files) for most routes.
// IMPORTANT: Do not run this on routes that use Multer — both parse multipart/body and the
// stream can only be consumed once (Multer then throws "Unexpected end of form").
import os from 'os';

/** Per-file ceiling for multipart uploads (application PDFs, bank statements). */
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
/**
 * Hard ceiling on how long multipart parsing may take before we answer the
 * caller. express-fileupload can leave a request without ever calling `next()`
 * (e.g. busboy never emits `finish` after an aborted/unpiped stream), which
 * otherwise leaves the browser spinning forever on "create application".
 */
const MULTIPART_PARSE_TIMEOUT_MS = 180_000;

const expressFileUploadMiddleware = fileUpload({
  useTempFiles: true,
  tempFileDir: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_FILE_BYTES },
  // Drain + answer with JSON ourselves instead of letting the library reset the
  // socket: a mid-upload reset surfaces in the browser as an opaque network
  // error, so the UI never learns the file was simply too large.
  abortOnLimit: false,
  limitHandler: (req: Request, res: Response) => {
    if (res.headersSent) return;
    req.resume();
    res.status(413).json({
      success: false,
      message: `File is too large. Maximum allowed size is ${Math.round(
        MAX_UPLOAD_FILE_BYTES / (1024 * 1024),
      )}MB per file.`,
    });
  },
});

app.use((req: Request, res: Response, next: NextFunction) => {
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

  // express-fileupload can invoke `next()` more than once (a file `error` event
  // and a later busboy `finish` both call it). On POST /applications that ran
  // the create handler twice — duplicate applications plus an
  // ERR_HTTP_HEADERS_SENT crash. Latch so only the first call gets through.
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error(`[upload] multipart parsing timed out for ${req.method} ${pathOnly}`);
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: 'File upload timed out. Please retry with a smaller file or a better connection.',
      });
    } else {
      res.end();
    }
  }, MULTIPART_PARSE_TIMEOUT_MS);

  const settle = (err?: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // The limit handler (or an abort) already answered — stop here rather than
    // running the route against a half-parsed body.
    if (res.headersSent || res.writableEnded) return;
    next(err as never);
  };

  res.on('close', () => clearTimeout(timer));

  return expressFileUploadMiddleware(req, res, settle);
});

cloudinaryConnect();
void describeDefaultMailSender().then((sender) =>
  console.log(
    `[mail] Default outbound sender: ${sender} (SendGrid: disabled)`,
  ),
);
// SendGrid disabled — all mail goes through Gmail; the SendGrid event webhook is no longer mounted.
// const sendgridWebhookBase = process.env.SENDGRID_WEBHOOK_URL?.trim().replace(/\/$/, '');
// if (sendgridWebhookBase) {
//   console.log(`[mail] SendGrid event webhook (configure in SendGrid dashboard): ${sendgridWebhookBase}/sendgrid/webhook`);
// }
// Test Redis connection, then start workers only when Redis is reachable.
void testRedisConnection()
  .catch(console.error)
  .finally(() => {
    startApplicationApprovalWorker();
  });

// Initialize Socket.IO
initializeSocketIO(httpServer);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Hybrid authentication gateway: every /api/v1 request first passes through
// the Super Admin proxy verifier. If it carries valid x-super-admin-proxy +
// x-super-admin-secret headers, `req.isSuperAdminProxy` is set and downstream
// `authenticateToken` will skip tenant JWT validation and synthesize a
// CONTRACTS_LOG principal. Regular tenant-user requests are untouched.
app.use('/api/v1', verifySuperAdminProxy, activityLogger, router);

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
  httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Socket.IO server initialized`);
    // Moves signed SignNow contracts to Contract Signed and chases missing CC
    // notices without anyone clicking the contract's refresh button.
    startSignNowContractStatusJob();
  });
})();

export default app;
