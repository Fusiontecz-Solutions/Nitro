import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import uploadService from '../services/uploadService';
import { findBoldSignTemplatePdfUrlByExactLayoutKey } from '../services/docusign/platform-document-registry';
import { resolveMainContractLayoutKeyForSend } from '../services/docusign/utils/resolve-main-contract-layout';
import { isFunderContractLayoutKey } from '../utils/funderContractLayout';

class ContractTemplateController {
    // Upload a new global contract template (PDF) and persist it
    async upload(req: Request, res: Response) {
        try {
            const reqFiles = (req as any).files;
            if (!reqFiles || !reqFiles.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded',
                });
            }

            const file = reqFiles.file;

            // Only allow PDFs for contract templates
            if (file.mimetype !== 'application/pdf') {
                return res.status(400).json({
                    success: false,
                    message: 'Only PDF files are allowed for contract templates',
                });
            }

            const folder = 'ih-crm/contract-templates';
            const result = await uploadService.uploadFile(file, folder);

            if (!result.success || !result.data) {
                return res.status(500).json({
                    success: false,
                    message: result.message || 'Failed to upload contract template',
                });
            }

            const currentUserId = (req as any).user?.id ?? null;

            const template = await prisma.contractTemplate.create({
                data: {
                    url: result.data.secure_url,
                    publicId: result.data.public_id,
                    originalName: result.fileName,
                    uploadedById: currentUserId,
                },
                include: {
                    uploadedBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            });

            return res.status(200).json({
                success: true,
                message: 'Contract template uploaded successfully',
                data: template,
            });
        } catch (error: any) {
            console.error('Upload contract template error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    // Get the most recently uploaded global contract template
    async getLatest(req: Request, res: Response) {
        try {
            const funderName =
                typeof req.query.funderName === 'string' ? req.query.funderName.trim() : '';
            const layoutKeyFromQuery = String(req.query.layoutKey || '').trim();
            const layoutKey = funderName
                ? await resolveMainContractLayoutKeyForSend({
                      mainContractLayoutKey: layoutKeyFromQuery || 'contract',
                      funderName,
                  })
                : layoutKeyFromQuery || 'contract';

            const byLayout = await this.resolveContractTemplateByLayoutKey(layoutKey);
            if (byLayout) {
                return res.status(200).json({
                    success: true,
                    data: byLayout,
                });
            }

            if (isFunderContractLayoutKey(layoutKey)) {
                return res.status(200).json({
                    success: true,
                    data: null,
                });
            }

            const latest = await prisma.contractTemplate.findFirst({
                orderBy: { createdAt: 'desc' },
            });

            return res.status(200).json({
                success: true,
                data: latest,
            });
        } catch (error: any) {
            console.error('Get latest contract template error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    private async resolveContractTemplateByLayoutKey(layoutKey: string) {
        const key = String(layoutKey || '').trim();
        if (!key) return null;

        const pdfUrl = await findBoldSignTemplatePdfUrlByExactLayoutKey(key);
        if (pdfUrl) {
            const boldSign = await prisma.boldSignTemplate.findFirst({
                where: {
                    OR: [{ layoutKey: key }, { templateId: key }],
                },
                orderBy: { createdAt: 'desc' },
            });
            return {
                id: boldSign?.id,
                url: pdfUrl,
                originalName:
                    boldSign?.name ||
                    (key === 'alliance_bridge_contract'
                        ? 'ALLIANCE BRIDGE CAPITAL.pdf'
                        : 'Contract.pdf'),
                layoutKey: key,
                source: 'boldSignTemplate',
            };
        }

        const contractTemplate = await prisma.contractTemplate.findFirst({
            where: { layoutKey: key },
            orderBy: { createdAt: 'desc' },
        });
        if (contractTemplate?.url) {
            return {
                ...contractTemplate,
                layoutKey: key,
                source: 'contractTemplate',
            };
        }

        if (key === 'contract') {
            const latest = await prisma.contractTemplate.findFirst({
                orderBy: { createdAt: 'desc' },
            });
            if (latest?.url) {
                return {
                    ...latest,
                    layoutKey: key,
                    source: 'contractTemplate',
                };
            }
        }

        return null;
    }
}

const contractTemplateController = new ContractTemplateController();
export default contractTemplateController;

