/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { cloudinary } from '../config/cloudinary';
import { runCloudinaryUpload } from './cloudinaryUploadLimiter';

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

class UploadToCloudinaryService {
    /**
     * Upload a single file. Concurrency and HTTP 429 back-off are handled process-wide by
     * `runCloudinaryUpload`, so callers are free to invoke this in parallel.
     */
    async uploadFile(file: UploadedFile, folder: string, title?: string): Promise<UploadResult> {
        const fileName = title || file.name;
        const resourceType = resolveCloudinaryResourceType(file);

        try {
            return await runCloudinaryUpload(fileName || 'file', async () => {
                // If file has a stream-like property, use upload_stream
                if (file.tempFileStream) {
                    return await new Promise<UploadResult>((resolve, reject) => {
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
                }

                const response = await cloudinary.uploader.upload(file.tempFilePath, {
                    folder,
                    resource_type: resourceType as 'image' | 'raw',
                });
                return {
                    success: true,
                    message: 'File uploaded successfully',
                    data: response,
                    fileName,
                };
            });
        } catch (error: any) {
            console.error(`Error in uploading file to Cloudinary (${fileName}):`, error);
            return {
                success: false,
                message: 'Error occurred while uploading file to Cloudinary',
                error: error?.message || String(error),
            };
        }
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

        try {
            return await runCloudinaryUpload(safeBase, async () => {
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

                return await new Promise<UploadResult>((resolve, reject) => {
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
            });
        } catch (error: any) {
            console.error(`Error uploading buffer to Cloudinary (${safeBase}):`, error);
            return {
                success: false,
                message: 'Error occurred while uploading file to Cloudinary',
                error: error?.message || String(error),
            };
        }
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

