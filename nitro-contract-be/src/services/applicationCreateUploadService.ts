import { promises as fs } from 'fs';
import { attachBufferAsApplicationFile } from './applicationPdfAttachService';

export type PendingApplicationUpload = {
    buffer: Buffer;
    originalName: string;
    mimetype: string;
};

type ExpressUploadedFile = {
    name?: string;
    tempFilePath?: string;
    mimetype?: string;
    data?: Buffer;
    truncated?: boolean;
};

function normalizeUploadedFiles(reqFiles: unknown): ExpressUploadedFile[] {
    const filesField = (reqFiles as { files?: ExpressUploadedFile | ExpressUploadedFile[] } | null)?.files;
    if (!filesField) return [];
    return Array.isArray(filesField) ? filesField : [filesField];
}

/**
 * Copy multipart files into memory before the request ends.
 * express-fileupload deletes temp files after the response, so Cloudinary
 * uploads must not depend on those paths remaining on disk.
 */
export async function snapshotRequestFiles(reqFiles: unknown): Promise<PendingApplicationUpload[]> {
    const files = normalizeUploadedFiles(reqFiles);
    const pending: PendingApplicationUpload[] = [];

    for (const file of files) {
        // A truncated file hit the size limit mid-stream; storing it would
        // attach a silently corrupt document to the application.
        if (file?.truncated) {
            console.warn(`[create application] skipping truncated upload: ${file?.name || 'document'}`);
            continue;
        }
        const originalName = String(file?.name || 'document').trim() || 'document';
        const mimetype = String(file?.mimetype || '').trim();
        if (file?.data && Buffer.isBuffer(file.data) && file.data.length > 0) {
            pending.push({
                buffer: file.data,
                originalName,
                mimetype,
            });
            continue;
        }
        const tempPath = String(file?.tempFilePath || '').trim();
        if (!tempPath) continue;
        const buffer = await fs.readFile(tempPath);
        pending.push({ buffer, originalName, mimetype });
    }

    return pending;
}

/**
 * Upload files after the create response has already been sent.
 * Failures are logged and never thrown to the HTTP caller.
 */
export function scheduleApplicationFileUploads(
    applicationId: string,
    files: PendingApplicationUpload[],
): void {
    if (!applicationId || files.length === 0) return;

    setImmediate(() => {
        void (async () => {
            const results = await Promise.allSettled(
                files.map((file) =>
                    attachBufferAsApplicationFile(applicationId, file.buffer, file.originalName),
                ),
            );
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
                console.error(
                    `[create application] ${failed.length}/${files.length} background file upload(s) failed for ${applicationId}`,
                    failed.map((r) => (r.status === 'rejected' ? r.reason : null)),
                );
            }
        })().catch((err) => {
            console.error('[create application] background file upload failed:', err);
        });
    });
}
