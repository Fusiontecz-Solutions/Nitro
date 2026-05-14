/* eslint-disable @typescript-eslint/no-explicit-any */
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

class UploadToCloudinaryService {
    // Upload single file to Cloudinary
    async uploadFile(file: UploadedFile, folder: string, title?: string): Promise<UploadResult> {
        try {
            const fileName = title || file.name;
            const options = { folder, resource_type: 'raw' as const };

            // If file has a stream-like property, use upload_stream
            if (file.tempFileStream) {
                return new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {
                            resource_type: 'raw',
                            folder,
                            public_id: `${Date.now()}_${fileName}`,
                        },
                        (error: any, cloudinaryResult: any) => {
                            if (error) {
                                console.error('Error in uploading file to Cloudinary (stream):', error);
                                reject({
                                    success: false,
                                    message: 'Error occurred while uploading file to Cloudinary',
                                    error: error.message,
                                });
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
            } else {
                // Default to upload method using tempFilePath
                const response = await cloudinary.uploader.upload(file.tempFilePath, options);
                return {
                    success: true,
                    message: 'File uploaded successfully',
                    data: response,
                    fileName,
                };
            }
        } catch (error: any) {
            console.error('Error in uploading file to Cloudinary:', error);
            return {
                success: false,
                message: 'Error occurred while uploading file to Cloudinary',
                error: error.message,
            };
        }
    }

    /** Upload a buffer (e.g. PDF) as a raw asset — used when the file is only in memory. */
    async uploadBuffer(buffer: Buffer, folder: string, fileName: string): Promise<UploadResult> {
        try {
            const safeBase = String(fileName || 'document.pdf').replace(/[^\w.\-]+/g, '_');
            const withoutExt = safeBase.replace(/\.[^/.]+$/, '');
            const publicId = `${Date.now()}_${withoutExt || 'document'}`;

            return await new Promise<UploadResult>((resolve) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        resource_type: 'raw',
                        folder,
                        public_id: publicId,
                    },
                    (error: any, cloudinaryResult: any) => {
                        if (error) {
                            console.error('Error uploading buffer to Cloudinary:', error);
                            resolve({
                                success: false,
                                message: 'Error occurred while uploading file to Cloudinary',
                                error: error.message,
                            });
                        } else {
                            resolve({
                                success: true,
                                message: 'File uploaded successfully',
                                data: cloudinaryResult,
                                fileName: safeBase,
                            });
                        }
                    }
                );
                Readable.from(buffer).pipe(uploadStream);
            });
        } catch (error: any) {
            console.error('Error in uploadBuffer:', error);
            return {
                success: false,
                message: 'Error occurred while uploading file to Cloudinary',
                error: error.message,
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

