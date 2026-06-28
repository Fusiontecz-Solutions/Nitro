export type CommissionRecipientType = 'iso' | 'underwriter';

export function getUnderwriterIdFromApplication(app: unknown): string | null {
    const r = app as Record<string, unknown>;
    const assigned = r?.assignedUnderwriter as Record<string, unknown> | undefined;
    const approved = r?.approvedByUnderwriter as Record<string, unknown> | undefined;
    const claimed = r?.claimedByUnderwriter as Record<string, unknown> | undefined;
    const raw =
        r?.assignedUnderwriterId ??
        assigned?.id ??
        assigned?._id ??
        r?.approvedByUnderwriterId ??
        approved?.id ??
        approved?._id ??
        r?.claimedByUnderwriterId ??
        claimed?.id ??
        claimed?._id;
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw).trim();
}

export function getUnderwriterNameFromApplication(app: unknown): string {
    const r = app as Record<string, unknown>;
    const pickName = (u: Record<string, unknown> | undefined) => {
        if (!u) return '';
        const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        return full || String(u.email ?? '').trim();
    };
    const assigned = r?.assignedUnderwriter as Record<string, unknown> | undefined;
    const approved = r?.approvedByUnderwriter as Record<string, unknown> | undefined;
    const claimed = r?.claimedByUnderwriter as Record<string, unknown> | undefined;
    return (
        pickName(assigned) ||
        pickName(approved) ||
        pickName(claimed) ||
        '—'
    );
}

export function getStoredCommissionPctForRecipient(
    app: unknown,
    recipient: CommissionRecipientType,
): number | null {
    const r = app as Record<string, unknown>;
    const key =
        recipient === 'underwriter'
            ? 'underwriterCommissionPercentage'
            : 'commissionPercentage';
    const raw = r?.[key];
    if (raw == null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(n) ? n : null;
}

export function commissionPctPayloadField(
    recipient: CommissionRecipientType,
): 'commissionPercentage' | 'underwriterCommissionPercentage' {
    return recipient === 'underwriter'
        ? 'underwriterCommissionPercentage'
        : 'commissionPercentage';
}
