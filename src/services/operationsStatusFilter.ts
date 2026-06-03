import type { Prisma } from '@prisma/client';

type ApplicationState =
    | 'DRAFT'
    | 'PENDING'
    | 'SUBMITTED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'CONTRACT_PENDING'
    | 'CONTRACTS_OUT'
    | 'SIGNED_CONTRACTS'
    | 'FUNDING_CALL'
    | 'DISBURSMENT'
    | 'FUNDED'
    | 'FINAL';

const ApplicationStateConst = {
    DRAFT: 'DRAFT',
    PENDING: 'PENDING',
    SUBMITTED: 'SUBMITTED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    CONTRACT_PENDING: 'CONTRACT_PENDING',
    CONTRACTS_OUT: 'CONTRACTS_OUT',
    SIGNED_CONTRACTS: 'SIGNED_CONTRACTS',
    FUNDING_CALL: 'FUNDING_CALL',
    DISBURSMENT: 'DISBURSMENT',
    FUNDED: 'FUNDED',
    FINAL: 'FINAL',
} as const satisfies Record<ApplicationState, ApplicationState>;

const applicationStateApiToPrisma: Record<string, ApplicationState> = {
    Draft: 'DRAFT',
    New: 'DRAFT',
    Submitted: 'SUBMITTED',
    'In Progress': 'IN_PROGRESS',
    In_Progress: 'IN_PROGRESS',
    IN_PROGRESS: 'IN_PROGRESS',
    Pending: 'PENDING',
    Completed: 'COMPLETED',
    Approved: 'COMPLETED',
    Cancelled: 'CANCELLED',
    Contract_Pending: 'CONTRACT_PENDING',
    Contracts_Out: 'CONTRACTS_OUT',
    'Contracts Out': 'CONTRACTS_OUT',
    Contracted: 'CONTRACTS_OUT',
    Signed_Contracts: 'SIGNED_CONTRACTS',
    'Funding Call': 'FUNDING_CALL',
    Disbursment: 'DISBURSMENT',
    Disbursement: 'DISBURSMENT',
    DISBURSEMENT: 'DISBURSMENT',
    Funded: 'FUNDED',
    FUNDED: 'FUNDED',
    FINAL: 'FINAL',
    Final: 'FINAL',
};

/** Queue labels used by deal-pipeline filters (aligned with application list aliases). */
export const dashboardStateQueueAliases: Record<string, string[]> = {
    Contract_Pending: ['Contract Pending', 'Contract_Pending'],
    Contracted: ['Contracted', 'Contract Out', 'Contracts Out', 'Contracts_Out', 'Contract_Out'],
    'Contract Out': ['Contract Out', 'Contract_Out', 'Contracted', 'Contracts Out', 'Contracts_Out'],
    'Contracts Out': ['Contracts Out', 'Contracts_Out', 'Contract Out', 'Contract_Out', 'Contracted'],
    Contracts_Out: ['Contracts Out', 'Contracts_Out', 'Contract Out', 'Contract_Out'],
    Signed_Contracts: [
        'Signed Contracts',
        'Signed_Contracts',
        'Contract Signed',
        'Contract_Signed',
    ],
    'Funding Call': ['Funding Call', 'Funding_Call'],
    Disbursment: ['Disbursment', 'Disbursement'],
    Funded: ['Funded', 'Completed'],
};

export const normalizeOperationsStatusKey = (value: string): string => {
    const normalized = value.trim().replace(/[\s-]+/g, '_');
    if (!normalized) return normalized;
    return normalized
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('_');
};

/** Umbrella deal-pipeline stage: contract out + contract signed (not contracts-out only). */
export const isContractedPipelineKey = (value: string): boolean => {
    const canonical = normalizeOperationsStatusKey(value);
    return canonical === 'Contracted';
};

export const isContractedOpsKey = (value: string): boolean => {
    const canonical = normalizeOperationsStatusKey(value);
    return canonical === 'Contracted' || canonical === 'Contracts_Out';
};

export const toPrismaApplicationState = (value: unknown): ApplicationState | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    const upper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
    const normalizedKey = trimmed.replace(/[\s-]+/g, '_');
    const canonicalized = normalizedKey
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('_');

    if (upper === 'FUNDING_CALL' || upper === 'FUNDINGCALL') return ApplicationStateConst.FUNDING_CALL;
    if (upper === 'DISBURSMENT' || upper === 'DISBURSEMENT') return ApplicationStateConst.DISBURSMENT;
    if (upper === 'PENDING') return ApplicationStateConst.PENDING;
    if (upper === 'IN_PROGRESS') return ApplicationStateConst.IN_PROGRESS;

    return (
        applicationStateApiToPrisma[trimmed] ||
        applicationStateApiToPrisma[normalizedKey] ||
        applicationStateApiToPrisma[canonicalized]
    );
};

const applicationStatePrismaToApi: Record<ApplicationState, string> = {
    [ApplicationStateConst.DRAFT]: 'Draft',
    [ApplicationStateConst.PENDING]: 'Pending',
    [ApplicationStateConst.SUBMITTED]: 'Submitted',
    [ApplicationStateConst.IN_PROGRESS]: 'In Progress',
    [ApplicationStateConst.COMPLETED]: 'Completed',
    [ApplicationStateConst.CANCELLED]: 'Cancelled',
    [ApplicationStateConst.CONTRACT_PENDING]: 'Contract_Pending',
    [ApplicationStateConst.CONTRACTS_OUT]: 'Contract Out',
    [ApplicationStateConst.SIGNED_CONTRACTS]: 'Signed_Contracts',
    [ApplicationStateConst.FUNDING_CALL]: 'Funding Call',
    [ApplicationStateConst.DISBURSMENT]: 'Disbursment',
    [ApplicationStateConst.FUNDED]: 'Funded',
    [ApplicationStateConst.FINAL]: 'FINAL',
};

/** Queue labels for “contract out” only (excludes generic workflow queue `Contracted`). */
const CONTRACT_OUT_QUEUE_STRICT = [
    'Contract Out',
    'Contract_Out',
    'Contracts Out',
    'Contracts_Out',
    'ContractOut',
];

/**
 * Strict contract-out: `currentState` in CONTRACTS_OUT spellings **or** `currentQueue` is
 * explicitly Contract(s) Out — not plain `Contracted` queue alone.
 */
export function contractsOutStrictMatchWhere(): Prisma.ApplicationWhereInput {
    return {
        OR: [
            { currentState: { in: expandStoredCurrentStateValues('CONTRACTS_OUT') } },
            { currentQueue: { in: CONTRACT_OUT_QUEUE_STRICT } },
        ],
    };
}

/** Queue labels for “contract signed” / signed-contracts stage (strict list). */
const CONTRACT_SIGNED_QUEUE_STRICT = [
    'Contract Signed',
    'Contract_Signed',
    'Signed Contracts',
    'Signed_Contracts',
    'SignedContracts',
];

/**
 * Strict contract-signed: `currentState` in SIGNED_CONTRACTS spellings **or** `currentQueue`
 * matches explicit signed-contract labels (operations “Contract Signed” card drill-down).
 */
export function signedContractsStrictMatchWhere(): Prisma.ApplicationWhereInput {
    return {
        OR: [
            { currentState: { in: expandStoredCurrentStateValues('SIGNED_CONTRACTS') } },
            { currentQueue: { in: CONTRACT_SIGNED_QUEUE_STRICT } },
        ],
    };
}

/** Broader signed-contract bucket for `operationsStatus=Signed_Contracts` (mixed queue/state rows). */
function signedContractsBroadMatchWhere(): Prisma.ApplicationWhereInput {
    const canonical = normalizeOperationsStatusKey('Signed_Contracts');
    const aliases =
        dashboardStateQueueAliases[canonical] ||
        dashboardStateQueueAliases[canonical.replace(/_/g, ' ')] ||
        [];
    const queueValues = Array.from(
        new Set([canonical, canonical.replace(/_/g, ' '), ...aliases]),
    );
    return {
        OR: [
            { currentState: { in: expandStoredCurrentStateValues('SIGNED_CONTRACTS') } },
            { currentQueue: { in: queueValues } },
        ],
    };
}

/**
 * Broader “contracted / contracts out” bucket (includes `Contracted` queue) for deal-pipeline
 * `operationsStatus=Contracted` and mixed legacy rows.
 */
function contractsOutBroadMatchWhere(): Prisma.ApplicationWhereInput {
    const canonical = normalizeOperationsStatusKey('Contracted');
    const aliases =
        dashboardStateQueueAliases['Contract Out'] ||
        dashboardStateQueueAliases[canonical] ||
        [];
    const queueValues = Array.from(
        new Set([canonical, canonical.replace(/_/g, ' '), ...aliases]),
    );
    return {
        OR: [
            { currentState: { in: expandStoredCurrentStateValues('CONTRACTS_OUT') } },
            { currentQueue: { in: queueValues } },
        ],
    };
}

/**
 * Deal-pipeline `operationsStatus=Contracted`: both contract-out and contract-signed rows.
 */
export function contractedCombinedMatchWhere(): Prisma.ApplicationWhereInput {
    return {
        OR: [contractsOutBroadMatchWhere(), signedContractsBroadMatchWhere()],
    };
}

/** DB `currentState` may store Prisma enum strings, API labels, or legacy spellings. */
function expandStoredCurrentStateValues(mappedState: ApplicationState): string[] {
    const out = new Set<string>([mappedState]);
    const api = applicationStatePrismaToApi[mappedState];
    if (api) {
        out.add(api);
        out.add(api.replace(/ /g, '_'));
        out.add(api.replace(/ /g, ''));
    }
    if (mappedState === 'FUNDING_CALL') {
        out.add('FUNDING CALL');
        out.add('Funding Call');
    }
    if (mappedState === 'DISBURSMENT') {
        out.add('DISBURSEMENT');
        out.add('Disbursement');
    }
    return Array.from(out);
}

export type OperationsStatusFilterMode = 'legacy' | 'state' | 'queue';

/**
 * Filters applications for operations pipeline URLs.
 * - `legacy`: match either `currentState` (enum) or `currentQueue` (human labels) — default for non–ops-dashboard roles.
 * - `state`: OPERATIONS — match by `currentState` when the label maps to an enum; pipeline queue-only labels
 *   (e.g. Agent, Underwriter) fall back to `currentQueue` so `/applications` matches operations dashboard stage counts.
 * - `queue`: SUPER_ADMIN — counts and lists by `currentQueue` only.
 */
export function buildOperationsStatusFilterWhere(
    rawValue: string,
    mode: OperationsStatusFilterMode,
): Prisma.ApplicationWhereInput {
    const canonical = normalizeOperationsStatusKey(rawValue);
    if (canonical === 'Contract_Out') {
        return contractsOutStrictMatchWhere();
    }
    if (canonical === 'Contract_Signed') {
        return signedContractsStrictMatchWhere();
    }
    const mappedState =
        isContractedPipelineKey(canonical) || canonical === 'Contracts_Out'
            ? undefined
            : toPrismaApplicationState(canonical);
    const aliases =
        dashboardStateQueueAliases[canonical] ||
        dashboardStateQueueAliases[canonical.replace(/_/g, ' ')] ||
        [];

    const queueValues = Array.from(
        new Set([canonical, canonical.replace(/_/g, ' '), ...aliases]),
    );

    if (mode === 'queue') {
        if (isContractedPipelineKey(canonical)) {
            return contractedCombinedMatchWhere();
        }
        if (canonical === 'Contracts_Out') {
            return contractsOutBroadMatchWhere();
        }
        return { currentQueue: { in: queueValues } };
    }

    if (mode === 'state') {
        if (isContractedPipelineKey(canonical)) {
            return contractedCombinedMatchWhere();
        }
        if (canonical === 'Contracts_Out') {
            return contractsOutBroadMatchWhere();
        }
        if (canonical === 'Signed_Contracts') {
            return signedContractsBroadMatchWhere();
        }
        const stateKey: ApplicationState | undefined = mappedState;
        if (!stateKey) {
            // Same as legacy when the param is a workflow queue name, not an ApplicationState — avoids empty lists
            // while dashboard `caseStageCounts` still includes those rows (chart uses legacy matching).
            return { currentQueue: { in: queueValues } };
        }
        return { currentState: { in: expandStoredCurrentStateValues(stateKey) } };
    }

    // legacy
    if (isContractedPipelineKey(canonical)) {
        return contractedCombinedMatchWhere();
    }
    if (canonical === 'Contracts_Out') {
        return contractsOutBroadMatchWhere();
    }
    if (canonical === 'Signed_Contracts') {
        return signedContractsBroadMatchWhere();
    }
    if (!mappedState) {
        return { currentQueue: { in: queueValues } };
    }
    return {
        OR: [{ currentState: mappedState }, { currentQueue: { in: queueValues } }],
    };
}

export function resolveOperationsListFilterMode(
    role: string | null | undefined,
): OperationsStatusFilterMode {
    const r = String(role ?? '')
        .trim()
        .toUpperCase()
        .replace(/-/g, '_');
    if (r === 'OPERATIONS') return 'state';
    if (r === 'SUPER_ADMIN' || r === 'SUPERADMIN') return 'queue';
    return 'legacy';
}
