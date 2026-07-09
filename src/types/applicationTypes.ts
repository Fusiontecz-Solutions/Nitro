// Application Types

/** Populated user shape from API (`mapUserLite`); `role` included when the backend selects it (e.g. list `createdBy`). */
export type ApplicationUserLite = {
    _id?: string;
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: string;
};

/** Populated ISO on application list/detail (`mapApplicationToApi` includes `iso: true`). */
export type ApplicationIsoLite = {
    _id?: string;
    id?: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
};

/** Minimal bank row used by Decision Logic widgets. */
export type BankInformation = {
    id: number;
    bankName?: string | null;
    routingNumber?: string | null;
    accountNumber?: string | null;
};

/** Minimal owner row used by Decision Logic widgets. */
export type OwnerProfile = {
    id: number;
    firstName?: string | null;
    lastName?: string | null;
};

export interface Application {
    _id: string;
    /** External / import deal identifier (e.g. Excel). Distinct from autoincrement `applicationId`. */
    dealId?: string | null;
    applicationId?: number;
    priority: 'Low' | 'Medium' | 'High' | 'Urgent';
    type: 'New' | 'Renewal' | 'Modification';
    referringAgent?: string | ApplicationUserLite;
    /** Linked ISO (independent sales org), when set on the application. */
    iso?: ApplicationIsoLite | null;
    salesRepresentative: string;
    client: string | {
        _id: string;
        clientId?: number;
        business?: {
            name?: string;
            email?: string;
        };
        owner?: {
            firstName?: string;
            lastName?: string;
            email?: string;
        };
    };
    loanAmount?: number | null;
    /** Per-row import / Excel deal name when distinct from client business name (e.g. "… #2"). */
    dealDisplayName?: string | null;
    note?: string;
    files?: ApplicationFiles[];
    documentChecklistChecked?: string[];
    status?: 'Pending' | 'Approved' | 'Rejected' | 'Funded';
    queue?: string;
    state?: string;
    currentQueue?: 'New' | 'Agent' | 'Review' | 'Underwriting' | 'Final Review' | 'Approved' | 'Declined' | 'On Hold' | 'Contracted' | 'Contract Pending' | 'Contract Generated' | 'Contract Sent' | 'Contract Cancelled' | 'Contract Signed' | 'Contract Out' | 'Contracts Out';
    currentState?: 'Draft' | 'Pending' | 'Submitted' | 'In Progress' | 'Completed' | 'Cancelled' | 'Contract Pending' | 'Contract Generated' | 'Contract Sent' | 'Contract Cancelled' | 'Contract Signed' | 'Contract Out' | 'Contracts Out';
    /** Raw DB state (Prisma) when present — `currentState` is workflow-mapped and can collapse funded vs approved. */
    statsCurrentState?: string;
    /** Application-level commission rate (0–100), persisted on the application record. */
    commissionPercentage?: number;
    /** Per-deal commission dollars (e.g. bulk import); used with advance/fees for “already net” style metrics. */
    commissionAmount?: number | null;
    /** Set on `GET /applications?statsBucket=funded`: collection payback/repaid/balance (same logic as `/collection-payments/balances`). */
    collectionPaybackAmount?: number | null;
    collectionSumOfRepaid?: number | null;
    /** Deal Economics REPaid gross (credit+paid+manual−debits); aligns portfolio Recovered totals with Deal Economics tiles. */
    collectionGrossRepaidDealEconomics?: number | null;
    collectionBalanceDue?: number | null;
    createdBy?: string | ApplicationUserLite;
    assignedTo?: string;
    claimedByUnderwriterId?: string | null;
    claimedAt?: string | null;
    claimedByUnderwriter?: ApplicationUserLite | null;
    assignedUnderwriterId?: string | null;
    assignedUnderwriter?: ApplicationUserLite | null;
    approvedByUnderwriterId?: string | null;
    approvedByUnderwriter?: ApplicationUserLite | null;
    /** Operations-set payment health category (e.g. "Weekly Payments", "Insufficient Funds"). */
    category?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface ApplicationFiles {
    _id?: string;
    url?: string;
    publicId?: string;
    originalName?: string;
    size?: number;
    uploadedAt?: string;
    type?: string;
    mimeType?: string;
    requestedDocumentSlug?: string | null;
    documentType?: string | null;
}

export interface CreateApplicationPayload {
    priority: string;
    type: string;
    referringAgent?: string;
    salesRepresentative: string;
    client: string;
    loanAmount?: number | string | null;
    note?: string;
    documents?: File[];
}

export interface UpdateApplicationPayload {
    priority?: string;
    type?: string;
    referringAgent?: string;
    salesRepresentative?: string;
    client?: string;
    loanAmount?: number | string | null;
    note?: string;
    currentQueue?: string;
    currentState?: string;
    status?: string;
    underwriterApproval?: boolean;
    approvedAt?: string;
    commissionPercentage?: number;
    /** Dollar commission stored on the application row (`Application.commissionAmount`). */
    commissionAmount?: number | null;
    /** Links the deal to an ISO; backend validates and syncs commission from the ISO record. */
    isoId?: string | null;
    /** Operations-set payment health category (e.g. "Weekly Payments", "Insufficient Funds"); pass null/"" to clear. */
    category?: string | null;
}

export interface UpdateQueuePayload {
    currentQueue: string;
}

export interface UpdateStatePayload {
    currentState: string;
}

export interface ApplicationsResponse {
    success: boolean;
    data: Application[];
    pagination?: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface ApplicationResponse {
    success: boolean;
    data: Application;
}

export interface GetApplicationsParams {
    /** When true, `getApplications` skips read/write of the client list cache (e.g. deal details). */
    skipListCache?: boolean;
    /** When true, skip cache read but still persist the response (forces a network round-trip). */
    skipListCacheRead?: boolean;
    /** When true, clear list on pending so stale rows are not shown while loading (main / browse lists). */
    clearListOnFetch?: boolean;
    /**
     * When true, fetches consecutive pages with the same filters until a short page is returned,
     * then merges rows.
     */
    fetchAllPages?: boolean;
    /** Overrides axios timeout (ms) for large list responses (default client timeout is 120s). */
    requestTimeoutMs?: number;
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    /** Dashboard stat cards — same buckets as `/applications/stats` aggregation */
    statsBucket?: string;
    operationsStatus?: string;
    priority?: string;
    type?: string;
    clientId?: string;
    currentQueue?: string;
    currentState?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    /** When true, backend returns list-optimized payload (smaller includes, faster response). */
    lite?: boolean;
    /** UNDERWRITER only: narrow list to pool vs my claimed deals (combined with Underwriter queue). */
    underwriterClaim?: 'unclaimed' | 'mine';
}

