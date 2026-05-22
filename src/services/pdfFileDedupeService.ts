import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';

const DEDUPE_DAYS_DEFAULT = 7;

export function readPdfFileDedupeDays(): number {
    const raw = Number(process.env.GMAIL_AUTO_CREATE_DEDUPE_DAYS ?? DEDUPE_DAYS_DEFAULT);
    if (!Number.isFinite(raw) || raw < 1) return DEDUPE_DAYS_DEFAULT;
    return Math.min(Math.floor(raw), 90);
}

export type PdfFileSignature = {
    originalName: string;
    size: number | null;
};

/** Primary PDF attachment stored on the application (Gmail auto-create / upload). */
export function pickPrimaryPdfFile(
    files: Array<{ originalName?: string | null; size?: number | null }> | null | undefined,
): PdfFileSignature | null {
    if (!files?.length) return null;
    const pdf = files.find((f) =>
        String(f.originalName || '')
            .trim()
            .toLowerCase()
            .endsWith('.pdf'),
    );
    if (!pdf) return null;
    const originalName = String(pdf.originalName || '').trim();
    if (!originalName) return null;
    const size = pdf.size != null && Number(pdf.size) > 0 ? Number(pdf.size) : null;
    return { originalName, size };
}

/**
 * Other applications with the same PDF filename (+ size when known) from the same creator,
 * within ±dedupeDays of `referenceCreatedAt`. After the window, returns empty (completely new).
 */
export async function findSamePdfFileApplications(params: {
    excludeApplicationId: string;
    createdById: string;
    file: PdfFileSignature;
    referenceCreatedAt: Date;
    dedupeDays?: number;
}) {
    const dedupeDays = params.dedupeDays ?? readPdfFileDedupeDays();
    const deltaMs = dedupeDays * 24 * 60 * 60 * 1000;
    const refTime = params.referenceCreatedAt.getTime();
    const windowStart = new Date(refTime - deltaMs);
    const windowEnd = new Date(refTime + deltaMs);

    const fileWhere: Prisma.ApplicationFileWhereInput = {
        originalName: params.file.originalName,
        ...(params.file.size != null && params.file.size > 0 ? { size: params.file.size } : {}),
    };

    return prisma.application.findMany({
        where: {
            id: { not: params.excludeApplicationId },
            createdById: params.createdById,
            createdAt: { gte: windowStart, lte: windowEnd },
            files: { some: fileWhere },
        },
        include: {
            client: true,
            createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
            files: { select: { originalName: true, size: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
}
