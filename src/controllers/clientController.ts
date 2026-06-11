import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import { resolveOptionalTenantUserId } from '../middleware/authMiddleware';

const MONTH_NAME_TO_INDEX: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
};

/** Parse search text into a createdAt range when it looks like a date (year, month, or full date). */
function parseClientCreatedAtRange(term: string): { start: Date; end: Date } | null {
    const trimmed = term.trim();
    if (!trimmed) return null;

    if (/^\d{4}$/.test(trimmed)) {
        const year = parseInt(trimmed, 10);
        return {
            start: new Date(year, 0, 1, 0, 0, 0, 0),
            end: new Date(year, 11, 31, 23, 59, 59, 999),
        };
    }

    const monthYear = trimmed.match(/^([a-zA-Z]+)\s+(\d{4})$/i);
    if (monthYear) {
        const monthIdx = MONTH_NAME_TO_INDEX[monthYear[1].toLowerCase()];
        const year = parseInt(monthYear[2], 10);
        if (monthIdx !== undefined && !Number.isNaN(year)) {
            return {
                start: new Date(year, monthIdx, 1, 0, 0, 0, 0),
                end: new Date(year, monthIdx + 1, 0, 23, 59, 59, 999),
            };
        }
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
        const start = new Date(parsed);
        start.setHours(0, 0, 0, 0);
        const end = new Date(parsed);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }

    return null;
}

/** Build Prisma OR conditions for client list search across all visible columns. */
function buildClientSearchConditions(search: string): Record<string, unknown>[] {
    const searchStr = String(search).trim();
    if (!searchStr) return [];

    const insensitive = { contains: searchStr, mode: 'insensitive' as const };
    const conditions: Record<string, unknown>[] = [
        { businessName: insensitive },
        { businessEmail: insensitive },
        { ownerFirstName: insensitive },
        { ownerLastName: insensitive },
        { ownerMiddleName: insensitive },
        { ownerEmail: insensitive },
        { businessNumber: insensitive },
        { ownerMobileNumber: insensitive },
        { businessState: insensitive },
        { businessIncorporationState: insensitive },
        { ownerState: insensitive },
        { businessCity: insensitive },
        { ownerCity: insensitive },
        { businessZipCode: insensitive },
        { ownerZipCode: insensitive },
    ];

    const digitsOnly = searchStr.replace(/\D/g, '');
    if (digitsOnly.length >= 3) {
        conditions.push(
            { businessNumber: { contains: digitsOnly } },
            { ownerMobileNumber: { contains: digitsOnly } },
        );
    }

    if (/^\d+$/.test(searchStr)) {
        const clientIdNum = parseInt(searchStr, 10);
        if (!Number.isNaN(clientIdNum)) {
            conditions.push({ clientId: clientIdNum });
        }
    }

    const createdAtRange = parseClientCreatedAtRange(searchStr);
    if (createdAtRange) {
        conditions.push({
            createdAt: {
                gte: createdAtRange.start,
                lte: createdAtRange.end,
            },
        });
    }

    return conditions;
}

// Helper to map Prisma Client record to the Mongo-like shape the frontend expects
const mapClientToApi = (client: any) => {
    if (!client) return client;

    const {
        id,
        clientId,
        status,
        notes,
        createdAt,
        updatedAt,
        createdBy,
        assignedTo,
        businessName,
        businessEmail,
        businessNumber,
        businessWebsite,
        businessIncorporationDate,
        businessIncorporationState,
        businessEntityType,
        businessEinNumber,
        businessAnnualRevenue,
        businessMonthlyRevenue,
        businessAddress1,
        businessAddress2,
        businessCity,
        businessState,
        businessZipCode,
        ownerFirstName,
        ownerMiddleName,
        ownerLastName,
        ownerEmail,
        ownerMobileNumber,
        ownerDateOfBirth,
        ownerSsn,
        ownerFicoScore,
        ownerOwnershipStartDate,
        ownerOwnershipPercentage,
        ownerAddress1,
        ownerAddress2,
        ownerCity,
        ownerState,
        ownerZipCode,
        ...rest
    } = client;

    return {
        ...rest,
        _id: id,
        id, // keep explicit id as well
        clientId,
        status,
        notes,
        createdAt,
        updatedAt,
        business: {
            name: businessName,
            email: businessEmail || '',
            number: businessNumber || '',
            website: businessWebsite || '',
            incorporationDate: businessIncorporationDate,
            incorporationState: businessIncorporationState || '',
            businessEntityType: businessEntityType || '',
            einNumber: businessEinNumber || '',
            annualRevenue: businessAnnualRevenue ?? undefined,
            monthlyRevenue: businessMonthlyRevenue ?? undefined,
            address: {
                address1: businessAddress1 || '',
                address2: businessAddress2 || '',
                city: businessCity || '',
                state: businessState || '',
                zipCode: businessZipCode || '',
            },
        },
        owner: {
            firstName: ownerFirstName,
            middleName: ownerMiddleName || '',
            lastName: ownerLastName,
            email: ownerEmail || '',
            mobileNumber: ownerMobileNumber || '',
            dateOfBirth: ownerDateOfBirth,
            ssn: ownerSsn || '',
            ficoScore: ownerFicoScore ?? undefined,
            ownershipStartDate: ownerOwnershipStartDate,
            ownershipPercentage: ownerOwnershipPercentage ?? undefined,
            address: {
                address1: ownerAddress1 || '',
                address2: ownerAddress2 || '',
                city: ownerCity || '',
                state: ownerState || '',
                zipCode: ownerZipCode || '',
            },
        },
        createdBy: createdBy
            ? {
                _id: createdBy.id,
                id: createdBy.id,
                firstName: createdBy.firstName,
                lastName: createdBy.lastName,
                email: createdBy.email,
            }
            : undefined,
        assignedTo: assignedTo
            ? {
                _id: assignedTo.id,
                id: assignedTo.id,
                firstName: assignedTo.firstName,
                lastName: assignedTo.lastName,
                email: assignedTo.email,
            }
            : undefined,
    };
};

class ClientController {
    // Create a new client
    async create(req: Request, res: Response) {
        try {
            const { business, owner, notes, assignedTo } = req.body;

            // Validate required fields
            if (!business?.name || !owner?.firstName || !owner?.lastName) {
                return res.status(400).json({
                    success: false,
                    message: 'Business name, owner first name, and owner last name are required',
                });
            }

            // Build business address object (handle both flat and nested structures)
            const businessAddress = {
                address1: business.address?.address1 || '',
                address2: business.address?.address2 || '',
                city: business.address?.city || '',
                state: business.address?.state || '',
                zipCode: business.address?.zipCode || '',
            };

            const businessData: any = {
                name: business.name,
                email: business.email,
                number: business.number,
                website: business.website,
                // Convert string date (e.g. "2018-09-13") to a JS Date for Prisma
                incorporationDate: business.incorporationDate
                    ? new Date(business.incorporationDate)
                    : undefined,
                incorporationState: business.incorporationState,
                businessEntityType: business.businessEntityType,
                einNumber: business.einNumber,
                annualRevenue: business.annualRevenue != null ? Number(business.annualRevenue) : undefined,
                monthlyRevenue: business.monthlyRevenue != null ? Number(business.monthlyRevenue) : undefined,
                address: businessAddress,
            };

            // Build owner address object (handle both flat and nested structures)
            const ownerAddress = {
                address1: owner.address?.address1 || '',
                address2: owner.address?.address2 || '',
                city: owner.address?.city || '',
                state: owner.address?.state || '',
                zipCode: owner.address?.zipCode || '',
            };

            const ownerData: any = {
                firstName: owner.firstName,
                middleName: owner.middleName,
                lastName: owner.lastName,
                email: owner.email,
                mobileNumber: owner.mobileNumber,
                // Convert to JS Date for Prisma
                dateOfBirth: owner.dateOfBirth ? new Date(owner.dateOfBirth) : undefined,
                ssn: owner.ssn,
                ficoScore: owner.ficoScore ? Number(owner.ficoScore) : undefined,
                ownershipStartDate: owner.ownershipStartDate
                    ? new Date(owner.ownershipStartDate)
                    : undefined,
                ownershipPercentage: owner.ownershipPercentage ? Number(owner.ownershipPercentage) : undefined,
                address: ownerAddress,
            };

            // Prevent duplicate clients by SSN (ownerSsn)
            const normalizedSsn = ownerData.ssn ? String(ownerData.ssn).trim() : '';
            if (normalizedSsn) {
                const existingClient = await prisma.client.findFirst({
                    where: {
                        ownerSsn: normalizedSsn,
                    },
                });

                if (existingClient) {
                    console.warn('Duplicate client creation attempt detected for SSN:', normalizedSsn, 'existing clientId:', existingClient.clientId);
                    return res.status(409).json({
                        success: false,
                        message: 'Client already exists with this SSN.',
                    });
                }
            }

            const client = await prisma.client.create({
                data: {
                    businessName: businessData.name,
                    businessEmail: businessData.email || null,
                    businessNumber: businessData.number || null,
                    businessWebsite: businessData.website || null,
                    businessIncorporationDate: businessData.incorporationDate || null,
                    businessIncorporationState: businessData.incorporationState || null,
                    businessEntityType: businessData.businessEntityType || null,
                    businessEinNumber: businessData.einNumber || null,
                    businessAnnualRevenue: businessData.annualRevenue ?? null,
                    businessMonthlyRevenue: businessData.monthlyRevenue ?? null,
                    businessAddress1: businessAddress.address1 || null,
                    businessAddress2: businessAddress.address2 || null,
                    businessCity: businessAddress.city || null,
                    businessState: businessAddress.state || null,
                    businessZipCode: businessAddress.zipCode || null,
                    ownerFirstName: ownerData.firstName,
                    ownerMiddleName: ownerData.middleName || null,
                    ownerLastName: ownerData.lastName,
                    ownerEmail: ownerData.email || null,
                    ownerMobileNumber: ownerData.mobileNumber || null,
                    ownerDateOfBirth: ownerData.dateOfBirth || null,
                    ownerSsn: ownerData.ssn || null,
                    ownerFicoScore: ownerData.ficoScore ?? null,
                    ownerOwnershipStartDate: ownerData.ownershipStartDate || null,
                    ownerOwnershipPercentage: ownerData.ownershipPercentage ?? null,
                    ownerAddress1: ownerAddress.address1 || null,
                    ownerAddress2: ownerAddress.address2 || null,
                    ownerCity: ownerAddress.city || null,
                    ownerState: ownerAddress.state || null,
                    ownerZipCode: ownerAddress.zipCode || null,
                    notes: notes || null,
                    assignedToId: assignedTo || null,
                    createdById: await resolveOptionalTenantUserId(req),
                },
            });

            return res.status(201).json({
                success: true,
                message: 'Client created successfully',
                data: mapClientToApi(client),
            });
        } catch (error: any) {
            console.error('Create client error:', error);
            const code = error?.code;
            if (code === 'P2002') {
                // Unique constraint violation (e.g. ownerSsn)
                return res.status(409).json({
                    success: false,
                    message: 'Client already exists with this SSN.',
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get all clients with pagination and filters
    async getAll(req: Request, res: Response) {
        try {
            const {
                page = 1,
                limit = 10,
                status,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc',
            } = req.query;

            const pageNum = Number(page);
            const limitNum = Number(limit);
            const skip = (pageNum - 1) * limitNum;

            // Build where/sort for Prisma
            const where: any = {};

            if (status) {
                where.status = status;
            }

            if (search) {
                const searchConditions = buildClientSearchConditions(String(search));
                if (searchConditions.length > 0) {
                    where.OR = searchConditions;
                }
            }

            let orderByField: string = 'createdAt';
            if (sortBy === 'createdAt' || sortBy === 'clientId') {
                orderByField = String(sortBy);
            }
            const orderBy: any = { [orderByField]: sortOrder === 'asc' ? 'asc' : 'desc' };

            const [clients, total] = await Promise.all([
                prisma.client.findMany({
                    where,
                    orderBy,
                    skip,
                    take: limitNum,
                    include: {
                        assignedTo: {
                            select: { id: true, firstName: true, lastName: true, email: true },
                        },
                    },
                }),
                prisma.client.count({ where }),
            ]);

            return res.status(200).json({
                success: true,
                data: clients.map(mapClientToApi),
                pagination: {
                    currentPage: pageNum,
                    totalPages: Math.ceil(total / limitNum),
                    totalItems: total,
                    itemsPerPage: limitNum,
                },
            });
        } catch (error) {
            console.error('Get all clients error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get single client by ID
    async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const client = await prisma.client.findUnique({
                where: { id },
                include: {
                    createdBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    assignedTo: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            });

            if (!client) {
                return res.status(404).json({
                    success: false,
                    message: 'Client not found',
                });
            }

            return res.status(200).json({
                success: true,
                data: mapClientToApi(client),
            });
        } catch (error) {
            console.error('Get client by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get client by clientId (numeric ID)
    async getByClientId(req: Request, res: Response) {
        try {
            const { clientId } = req.params;

            const client = await prisma.client.findUnique({
                where: { clientId: Number(clientId) },
                include: {
                    createdBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    assignedTo: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            });

            if (!client) {
                return res.status(404).json({
                    success: false,
                    message: 'Client not found',
                });
            }

            return res.status(200).json({
                success: true,
                data: mapClientToApi(client),
            });
        } catch (error) {
            console.error('Get client by clientId error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update client
    async update(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { business, owner, status, notes, assignedTo } = req.body;

            const client = await prisma.client.findUnique({ where: { id } });

            if (!client) {
                return res.status(404).json({
                    success: false,
                    message: 'Client not found',
                });
            }

            const updateData: any = {};

            // Update business data if provided
            if (business) {
                if (business.name !== undefined) updateData.businessName = business.name;
                if (business.email !== undefined) updateData.businessEmail = business.email;
                if (business.number !== undefined) updateData.businessNumber = business.number;
                if (business.website !== undefined) updateData.businessWebsite = business.website;
                if (business.incorporationDate !== undefined) {
                    updateData.businessIncorporationDate = business.incorporationDate
                        ? new Date(business.incorporationDate)
                        : null;
                }
                if (business.incorporationState !== undefined) updateData.businessIncorporationState = business.incorporationState;
                if (business.businessEntityType !== undefined) updateData.businessEntityType = business.businessEntityType;
                if (business.einNumber !== undefined) updateData.businessEinNumber = business.einNumber;
                if (business.annualRevenue !== undefined) updateData.businessAnnualRevenue = Number(business.annualRevenue);
                if (business.monthlyRevenue !== undefined) updateData.businessMonthlyRevenue = Number(business.monthlyRevenue);

                // Handle address fields
                if (business.address?.address1 !== undefined) updateData.businessAddress1 = business.address.address1;
                if (business.address?.address2 !== undefined) updateData.businessAddress2 = business.address.address2;
                if (business.address?.city !== undefined) updateData.businessCity = business.address.city;
                if (business.address?.state !== undefined) updateData.businessState = business.address.state;
                if (business.address?.zipCode !== undefined) updateData.businessZipCode = business.address.zipCode;
            }

            // Update owner data if provided
            if (owner) {
                if (owner.firstName !== undefined) updateData.ownerFirstName = owner.firstName;
                if (owner.middleName !== undefined) updateData.ownerMiddleName = owner.middleName;
                if (owner.lastName !== undefined) updateData.ownerLastName = owner.lastName;
                if (owner.email !== undefined) updateData.ownerEmail = owner.email;
                if (owner.mobileNumber !== undefined) updateData.ownerMobileNumber = owner.mobileNumber;
                if (owner.dateOfBirth !== undefined) {
                    updateData.ownerDateOfBirth = owner.dateOfBirth ? new Date(owner.dateOfBirth) : null;
                }

                if (owner.ssn !== undefined) {
                    const newSsn = String(owner.ssn).trim();
                    if (newSsn) {
                        const existingWithSsn = await prisma.client.findFirst({
                            where: {
                                ownerSsn: newSsn,
                                NOT: { id },
                            },
                        });

                        if (existingWithSsn) {
                            console.warn('Duplicate client SSN update attempt detected for SSN:', newSsn, 'existing clientId:', existingWithSsn.clientId);
                            return res.status(409).json({
                                success: false,
                                message: 'Client already exists with this SSN.',
                            });
                        }
                    }

                    updateData.ownerSsn = owner.ssn;
                }

                if (owner.ficoScore !== undefined) updateData.ownerFicoScore = Number(owner.ficoScore);
                if (owner.ownershipStartDate !== undefined) {
                    updateData.ownerOwnershipStartDate = owner.ownershipStartDate
                        ? new Date(owner.ownershipStartDate)
                        : null;
                }
                if (owner.ownershipPercentage !== undefined) updateData.ownerOwnershipPercentage = Number(owner.ownershipPercentage);

                if (owner.address?.address1 !== undefined) updateData.ownerAddress1 = owner.address.address1;
                if (owner.address?.address2 !== undefined) updateData.ownerAddress2 = owner.address.address2;
                if (owner.address?.city !== undefined) updateData.ownerCity = owner.address.city;
                if (owner.address?.state !== undefined) updateData.ownerState = owner.address.state;
                if (owner.address?.zipCode !== undefined) updateData.ownerZipCode = owner.address.zipCode;
            }

            // Update other fields
            if (status !== undefined) updateData.status = status;
            if (notes !== undefined) updateData.notes = notes;
            if (assignedTo !== undefined) updateData.assignedToId = assignedTo;

            const updatedClient = await prisma.client.update({
                where: { id },
                data: updateData,
                include: {
                    createdBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    assignedTo: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            });

            return res.status(200).json({
                success: true,
                message: 'Client updated successfully',
                data: mapClientToApi(updatedClient),
            });
        } catch (error) {
            console.error('Update client error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Delete client
    async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const client = await prisma.client.delete({ where: { id } });

            if (!client) {
                return res.status(404).json({
                    success: false,
                    message: 'Client not found',
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Client deleted successfully',
            });
        } catch (error) {
            console.error('Delete client error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update client status
    async updateStatus(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status || !['Active', 'Inactive', 'Pending', 'Archived'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid status is required (Active, Inactive, Pending, Archived)',
                });
            }

            const client = await prisma.client.update({
                where: { id },
                data: { status },
                include: {
                    createdBy: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    assignedTo: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            });

            if (!client) {
                return res.status(404).json({
                    success: false,
                    message: 'Client not found',
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Client status updated successfully',
                data: mapClientToApi(client),
            });
        } catch (error) {
            console.error('Update client status error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }
}

const clientController = new ClientController();
export default clientController;

 