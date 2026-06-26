import type { Request, Response } from 'express';
import uploadService from '../services/uploadService';

/** Safe filename for Content-Disposition (ASCII subset). */
function sanitizeFilename(name: string): string {
    const trimmed = String(name ?? 'document').trim().slice(0, 200);
    return trimmed.replace(/[^\w.\- ()]+/g, '_') || 'document';
}

const EXT_TO_MIME: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function fileExtFromNameOrUrl(name: string, rawUrl: string): string {
    const n = String(name ?? '').toLowerCase().trim();
    const fromName = n.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
    if (fromName) return fromName;
    try {
        const path = new URL(rawUrl).pathname.toLowerCase();
        return path.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
    } catch {
        return '';
    }
}

/** Cloudinary raw files often come back as octet-stream; browsers then download blob: URLs in iframes. */
function resolveInlineContentType(upstreamCt: string, rawUrl: string, nameParam: string): string {
    const base = (upstreamCt || '').split(';')[0].trim().toLowerCase();
    const ext = fileExtFromNameOrUrl(nameParam, rawUrl);
    const fromExt = ext && EXT_TO_MIME[ext];
    if (fromExt) {
        return fromExt;
    }
    if (base && base !== 'application/octet-stream') {
        return base;
    }
    return 'application/octet-stream';
}

class UploadController {
    // Upload single file
    async uploadSingle(req: Request, res: Response) {
        try {
            const reqFiles = (req as any).files;
            if (!reqFiles || !reqFiles.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded',
                });
            }

            const file = reqFiles.file;
            const requestedFolder =
                typeof req.body?.folder === 'string' ? req.body.folder.trim() : '';
            const allowedFolders = new Set(['ih-crm/documents', 'ih-crm/background-checks']);
            const folder = allowedFolders.has(requestedFolder)
                ? requestedFolder
                : 'ih-crm/documents';

            const result = await uploadService.uploadFile(file, folder);

            if (!result.success) {
                return res.status(500).json(result);
            }

            return res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                data: {
                    url: result.data?.secure_url,
                    publicId: result.data?.public_id,
                    originalName: result.fileName,
                    format: result.data?.format,
                    size: result.data?.bytes,
                },
            });
        } catch (error) {
            console.error('Upload single file error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Upload multiple files
    async uploadMultiple(req: Request, res: Response) {
        try {
            const reqFiles = (req as any).files;
            if (!reqFiles || !reqFiles.files) {
                return res.status(400).json({
                    success: false,
                    message: 'No files uploaded',
                });
            }

            const folder = 'ih-crm/documents';

            // Handle both single and multiple files
            let files = reqFiles.files;
            if (!Array.isArray(files)) {
                files = [files];
            }

            const results = await uploadService.uploadMultipleFiles(files, folder);

            const uploadedFiles = results
                .filter((result) => result.success)
                .map((result) => ({
                    url: result.data?.secure_url,
                    publicId: result.data?.public_id,
                    originalName: result.fileName,
                    format: result.data?.format,
                    size: result.data?.bytes,
                }));

            const failedFiles = results.filter((result) => !result.success);

            return res.status(200).json({
                success: true,
                message: `${uploadedFiles.length} file(s) uploaded successfully`,
                data: uploadedFiles,
                failed: failedFiles.length > 0 ? failedFiles : undefined,
            });
        } catch (error) {
            console.error('Upload multiple files error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /**
     * Proxy Cloudinary assets with Content-Disposition: inline so PDFs load in an iframe
     * (raw uploads default to attachment). Authenticated; URL must match this account's cloud.
     */
    async streamInlinePreview(req: Request, res: Response) {
        try {
            const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
            if (!rawUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'url query parameter is required',
                });
            }

            const cloudName = process.env.CLOUD_NAME?.trim();
            if (!cloudName) {
                return res.status(500).json({
                    success: false,
                    message: 'Server misconfigured (cloud name)',
                });
            }

            const prefix = `https://res.cloudinary.com/${cloudName}/`;
            if (!rawUrl.startsWith(prefix)) {
                return res.status(400).json({
                    success: false,
                    message: 'URL not allowed',
                });
            }

            if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\//.test(rawUrl)) {
                return res.status(400).json({
                    success: false,
                    message: 'URL not allowed',
                });
            }

            const upstream = await fetch(rawUrl, { redirect: 'follow' });
            if (!upstream.ok) {
                return res.status(502).json({
                    success: false,
                    message: 'Could not fetch file from storage',
                });
            }

            const upstreamCt =
                upstream.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
            const nameParam =
                typeof req.query.name === 'string' ? req.query.name.trim() : '';
            const filename = sanitizeFilename(nameParam || 'document');
            const ct = resolveInlineContentType(upstreamCt, rawUrl, nameParam);

            res.setHeader('Content-Type', ct);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.setHeader('Cache-Control', 'private, max-age=300');

            const buf = Buffer.from(await upstream.arrayBuffer());
            return res.send(buf);
        } catch (error) {
            console.error('streamInlinePreview error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Delete file from Cloudinary
    async deleteFile(req: Request, res: Response) {
        try {
            const { publicId, resourceType } = req.body;

            if (!publicId) {
                return res.status(400).json({
                    success: false,
                    message: 'Public ID is required',
                });
            }

            const result = await uploadService.deleteFile(publicId, resourceType || 'raw');

            return res.status(200).json(result);
        } catch (error) {
            console.error('Delete file error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }
}

const uploadController = new UploadController();
export default uploadController;
