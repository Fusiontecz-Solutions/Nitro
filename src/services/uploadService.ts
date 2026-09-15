/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { cloudinary } from '../config/cloudinary';

interface UploadedFile {
    name: string;
    tempFilePath: string;
    mimetype: string;
    size: number;
    tempFileStream?: NodeJS.ReadableStream;
}

interface UploadResult {
    success: boolean;
    message: string;
    data?: any;
    fileName?: string;
    error?: string;
}

function resolveCloudinaryResourceType(file: {
    mimetype?: string;
    name?: string;
}): 'image' | 'raw' {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
        return 'image';
    }
    if (mime.startsWith('image/')) {
        return 'image';
    }
    return 'raw';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCloudinaryRateLimitError(error: unknown): boolean {
    const msg = String((error as any)?.message || error || '');
    const code = Number((error as any)?.http_code || (error as any)?.httpCode || 0);
    return code === 429 || /429|rate.?limit|too many requests/i.test(msg);
}

class UploadToCloudinaryService {
    // Upload single file to Cloudinary (retries on HTTP 429 rate limits)
    async uploadFile(file: UploadedFile, folder: string, title?: string): Promise<UploadResult> {
        const fileName = title || file.name;
        const resourceType = resolveCloudinaryResourceType(file);
        const maxAttempts = 5;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const options = { folder, resource_type: resourceType as 'image' | 'raw' };

                // If file has a stream-like property, use upload_stream
                if (file.tempFileStream) {
                    const streamResult = await new Promise<UploadResult>((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            {
                                resource_type: resourceType,
                                folder,
                                public_id: `${Date.now()}_${fileName}`,
                            },
                            (error: any, cloudinaryResult: any) => {
                                if (error) {
                                    reject(error);
                                } else {
                                    resolve({
                                        success: true,
                                        message: 'File uploaded successfully',
                                        data: cloudinaryResult,
                                        fileName,
                                    });
                                }
                            }
                        );
                        file.tempFileStream!.pipe(uploadStream);
                    });
                    return streamResult;
                }

                const response = await cloudinary.uploader.upload(file.tempFilePath, options);
                return {
                    success: true,
                    message: 'File uploaded successfully',
                    data: response,
                    fileName,
                };
            } catch (error: any) {
                const retryable = isCloudinaryRateLimitError(error);
                console.error(
                    `Error in uploading file to Cloudinary (attempt ${attempt}/${maxAttempts}):`,
                    error,
                );
                if (retryable && attempt < maxAttempts) {
                    const waitMs = Math.min(8000, 750 * Math.pow(2, attempt - 1));
                    console.warn(`[cloudinary] 429 rate limit — retrying in ${waitMs}ms…`);
                    await sleep(waitMs);
                    continue;
                }
                return {
                    success: false,
                    message: 'Error occurred while uploading file to Cloudinary',
                    error: error?.message || String(error),
                };
            }
        }

        return {
            success: false,
            message: 'Error occurred while uploading file to Cloudinary',
            error: 'Upload failed after retries',
        };
    }

    /**
     * Upload an in-memory buffer. PDFs are stored as Cloudinary `image` + format `pdf`
     * (not `raw`) so they open as PDFs in viewers.
     */
    async uploadBuffer(
        buffer: Buffer,
        folder: string,
        fileName: string,
        options?: { forcePdf?: boolean },
    ): Promise<UploadResult> {
        const safeBase = String(fileName || 'document.pdf').replace(/[^\w.\-]+/g, '_');
        const withoutExt = safeBase.replace(/\.[^/.]+$/, '');
        const isPdf =
            options?.forcePdf === true || safeBase.toLowerCase().endsWith('.pdf');
        const maxAttempts = 5;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const publicId = `${Date.now()}_${randomUUID().slice(0, 8)}_${withoutExt || 'document'}`;
                const uploadOptions: Record<string, unknown> = {
                    folder,
                    public_id: publicId,
                };

                if (isPdf) {
                    uploadOptions.resource_type = 'image';
                    uploadOptions.format = 'pdf';
                } else {
                    uploadOptions.resource_type = resolveCloudinaryResourceType({ name: safeBase });
                }

                const result = await new Promise<UploadResult>((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        uploadOptions as any,
                        (error: any, cloudinaryResult: any) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve({
                                    success: true,
                                    message: 'File uploaded successfully',
                                    data: cloudinaryResult,
                                    fileName: isPdf
                                        ? safeBase.toLowerCase().endsWith('.pdf')
                                            ? safeBase
                                            : `${withoutExt || 'document'}.pdf`
                                        : safeBase,
                                });
                            }
                        }
                    );
                    Readable.from(buffer).pipe(uploadStream);
                });
                return result;
            } catch (error: any) {
                const retryable = isCloudinaryRateLimitError(error);
                console.error(
                    `Error uploading buffer to Cloudinary (attempt ${attempt}/${maxAttempts}):`,
                    error,
                );
                if (retryable && attempt < maxAttempts) {
                    const waitMs = Math.min(8000, 750 * Math.pow(2, attempt - 1));
                    console.warn(`[cloudinary] buffer 429 — retrying in ${waitMs}ms…`);
                    await sleep(waitMs);
                    continue;
                }
                return {
                    success: false,
                    message: 'Error occurred while uploading file to Cloudinary',
                    error: error?.message || String(error),
                };
            }
        }

        return {
            success: false,
            message: 'Error occurred while uploading file to Cloudinary',
            error: 'Upload failed after retries',
        };
    }

    // Upload multiple files to Cloudinary
    async uploadMultipleFiles(files: UploadedFile[], folder: string): Promise<UploadResult[]> {
        const uploadPromises = files.map((file) => this.uploadFile(file, folder, file.name));
        return Promise.all(uploadPromises);
    }

    // Delete file from Cloudinary
    async deleteFile(publicId: string, resourceType: string = 'raw'): Promise<any> {
        try {
            const result = await cloudinary.uploader.destroy(publicId, {
                resource_type: resourceType as any,
            });
            return {
                success: true,
                message: 'File deleted successfully',
                data: result,
            };
        } catch (error: any) {
            console.error('Error deleting from Cloudinary:', error);
            return {
                success: false,
                message: 'Error occurred while deleting file from Cloudinary',
                error: error.message,
            };
        }
    }
}

const uploadService = new UploadToCloudinaryService();
export default uploadService;

