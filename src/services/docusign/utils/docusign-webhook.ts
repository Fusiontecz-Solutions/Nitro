const INTERNAL_ENVELOPE_STATUS_RANK: Record<string, number> = {
  draft: 0,
  created: 0,
  sent: 1,
  delivered: 2,
  viewed: 2,
  signed: 3,
  completed: 100,
  declined: 40,
  voided: 40,
  revoked: 40,
  expired: 40,
};

function pickRicher(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const ra = INTERNAL_ENVELOPE_STATUS_RANK[a] ?? 0;
  const rb = INTERNAL_ENVELOPE_STATUS_RANK[b] ?? 0;
  return ra >= rb ? a : b;
}

function matchXmlElement(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const m = xml.match(re);
  const v = m?.[1]?.trim();
  return v || null;
}

/** Normalize Connect payloads (JSON body, JSON string, or legacy XML). */
export function parseDocusignWebhookBody(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string') return {};

  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith('<')) {
    const envelopeId =
      matchXmlElement(trimmed, 'EnvelopeID') ||
      matchXmlElement(trimmed, 'EnvelopeId') ||
      matchXmlElement(trimmed, 'envelopeId');
    const status =
      matchXmlElement(trimmed, 'Status') ||
      matchXmlElement(trimmed, 'EnvelopeStatus');
    const statusLower = String(status || '').toLowerCase();
    const pseudoEvent =
      statusLower === 'completed'
        ? 'envelope-completed'
        : statusLower
          ? `envelope-${statusLower}`
          : 'envelope-updated';
    return {
      event: pseudoEvent,
      data: {
        envelopeId,
        status,
        envelopeSummary: { status, envelopeId },
      },
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON */
  }
  return {};
}

/** DocuSign Connect envelope status → internal lowercase status */
export function mapDocusignEnvelopeStatus(status: unknown): string | null {
  if (status == null) return null;
  const k = String(status).trim().toLowerCase();
  const map: Record<string, string> = {
    created: 'draft',
    sent: 'sent',
    delivered: 'viewed',
    signed: 'signed',
    completed: 'completed',
    declined: 'declined',
    voided: 'revoked',
    deleted: 'revoked',
    timedout: 'expired',
    processing: 'sent',
  };
  return map[k] ?? null;
}

/** Exact Connect 2.0 / SIM event names before fuzzy matching. */
const CONNECT_EVENT_EXACT: Record<string, string> = {
  'envelope-sent': 'sent',
  'envelope-delivered': 'viewed',
  'envelope-completed': 'completed',
  'envelope-declined': 'declined',
  'envelope-voided': 'revoked',
  'envelope-removed': 'revoked',
  'envelope-deleted': 'revoked',
  'recipient-sent': 'sent',
  'recipient-delivered': 'viewed',
  'recipient-completed': 'completed',
  'recipient-declined': 'declined',
  'recipient-autoresponded': 'viewed',
  'recipient-finish-later': 'viewed',
};

/** DocuSign Connect event types (envelope-level) */
export function mapDocusignConnectEvent(event: unknown): string | null {
  if (event == null) return null;
  const e = String(event).trim().toLowerCase();
  if (!e || e === '[object object]') return null;

  if (CONNECT_EVENT_EXACT[e]) return CONNECT_EVENT_EXACT[e];

  if (e.includes('voided')) return 'revoked';
  if (e.includes('deleted')) return 'revoked';
  if (e.includes('declined')) return 'declined';
  if (e.includes('completed')) return 'completed';
  if (e.includes('signed')) return 'signed';
  if (e.includes('delivered') || e.includes('viewed')) return 'viewed';
  if (e.endsWith('-sent') || e === 'sent') return 'sent';
  return null;
}

/** `event` may be a string or `{ eventType: "recipient-completed" }` in Connect 2.0. */
export function extractDocusignConnectEventName(body: any): string | null {
  const raw = body?.event ?? body?.eventType ?? body?.data?.event ?? null;
  if (raw == null) return null;
  if (typeof raw === 'object') {
    const nested = raw.eventType ?? raw.type ?? raw.name ?? raw.status;
    return nested != null ? String(nested).trim() : null;
  }
  return String(raw).trim() || null;
}

export function extractDocusignEnvelopeId(body: any): string | null {
  const id =
    body?.data?.envelopeId ||
    body?.data?.envelopeSummary?.envelopeId ||
    body?.envelopeId ||
    body?.EnvelopeId ||
    body?.EnvelopeID ||
    body?.data?.envelopeID;
  const s = id != null ? String(id).trim() : '';
  return s || null;
}

function mapRecipientStatus(status: unknown): string | null {
  if (status == null) return null;
  const k = String(status).trim().toLowerCase();
  const map: Record<string, string> = {
    sent: 'sent',
    delivered: 'viewed',
    completed: 'completed',
    signed: 'signed',
    declined: 'declined',
    autoresponded: 'viewed',
    faxpending: 'sent',
    autorespondedhandled: 'viewed',
  };
  return map[k] ?? null;
}

export function resolveDocusignWebhookEnvelopeStatus(body: any): string | null {
  const eventRaw = extractDocusignConnectEventName(body);

  const fromStatus =
    mapDocusignEnvelopeStatus(body?.data?.envelopeSummary?.status) ??
    mapDocusignEnvelopeStatus(body?.data?.status) ??
    mapDocusignEnvelopeStatus(body?.status) ??
    mapDocusignEnvelopeStatus(body?.EnvelopeStatus) ??
    mapDocusignEnvelopeStatus(body?.data?.envelopeStatus);

  const fromRecipient =
    mapRecipientStatus(body?.data?.recipientStatus) ??
    mapRecipientStatus(body?.data?.recipient?.status) ??
    mapRecipientStatus(body?.recipientStatus);

  const fromEvent = mapDocusignConnectEvent(eventRaw);
  return pickRicher(pickRicher(fromStatus, fromRecipient), fromEvent);
}

export function mergeWithExistingEnvelopeStatus(
  existing: string | null | undefined,
  incoming: string | null,
): string | null {
  const normalized = existing ? String(existing).trim().toLowerCase() : null;
  return pickRicher(normalized, incoming);
}

export function internalEnvelopeStatusToContractStatusDbValue(internal: string): string | null {
  const map: Record<string, string> = {
    draft: 'DRAFT',
    sent: 'SENT',
    viewed: 'VIEWED',
    signed: 'SIGNED',
    completed: 'COMPLETED',
    declined: 'DECLINED',
    revoked: 'REVOKED',
    expired: 'EXPIRED',
  };
  return map[internal] ?? null;
}
