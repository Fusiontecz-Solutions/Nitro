import prisma from '../config/prismaClient';

/**
 * SendGrid Event Webhook integration
 * ----------------------------------------------------------------------------
 * SendGrid POSTs an array of event objects to our webhook endpoint whenever an
 * outbound message changes engagement state (processed, delivered, open, click,
 * bounce, dropped, spamreport, ...). Each event carries the custom arg `ocid`
 * we attached at send time (see `config/nodemailer.ts` -> X-SMTPAPI) which is
 * the originating `OutboundCommunication.id`.
 *
 * We translate the raw event into a stable, display-friendly status, store the
 * engagement timeline on the row's `metadata`, and propagate the latest status
 * onto the linked `ApplicationActivityLog` so the deal Mail Log reflects the
 * real delivery/open state instead of a static "sent".
 */

/** Raw event shape (only the fields we read). SendGrid sends many more. */
export interface SendGridEvent {
  email?: string;
  timestamp?: number;
  event?: string;
  ocid?: string;
  sg_event_id?: string;
  sg_message_id?: string;
  reason?: string;
  type?: string;
  url?: string;
  useragent?: string;
  ip?: string;
  // Custom args may also arrive nested under `unique_args` for some configs.
  unique_args?: { ocid?: string } | null;
  [key: string]: unknown;
}

/** Normalised, UI-facing status stored on the mail-log row. */
export type DeliveryStatus =
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'deferred'
  | 'bounced'
  | 'dropped'
  | 'spam'
  | 'unsubscribed'
  | 'failed';

/**
 * Monotonic rank so out-of-order webhook deliveries (e.g. an `open` arriving
 * before its `delivered`) never downgrade the visible status. Terminal failure
 * states outrank engagement so a bounce is not masked by a stale open.
 */
const STATUS_RANK: Record<DeliveryStatus, number> = {
  sent: 1,
  deferred: 1,
  delivered: 2,
  unsubscribed: 2,
  opened: 3,
  clicked: 4,
  bounced: 5,
  dropped: 5,
  failed: 5,
  spam: 6,
};

function mapEventToStatus(event: string): DeliveryStatus | null {
  switch (event.toLowerCase()) {
    case 'processed':
    case 'queued':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'open':
    case 'opened':
      return 'opened';
    case 'click':
    case 'clicked':
      return 'clicked';
    case 'deferred':
      return 'deferred';
    case 'bounce':
    case 'blocked':
      return 'bounced';
    case 'dropped':
      return 'dropped';
    case 'spamreport':
      return 'spam';
    case 'unsubscribe':
    case 'group_unsubscribe':
      return 'unsubscribed';
    default:
      return null;
  }
}

function resolveOcid(event: SendGridEvent): string | null {
  const direct = typeof event.ocid === 'string' ? event.ocid.trim() : '';
  if (direct) return direct;
  const nested = event.unique_args?.ocid;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  return null;
}

function normalizeSgMessageId(raw: string): string {
  return raw.trim().replace(/^<|>$/g, '').split('.')[0];
}

/** Fallback when `ocid` is missing: match recent outbound rows by SendGrid message id. */
async function resolveOutboundIdFromEvent(event: SendGridEvent): Promise<string | null> {
  const ocid = resolveOcid(event);
  if (ocid) return ocid;

  const sgRaw = typeof event.sg_message_id === 'string' ? event.sg_message_id.trim() : '';
  if (!sgRaw) return null;

  const sgBase = normalizeSgMessageId(sgRaw);
  const candidates = await prisma.outboundCommunication.findMany({
    where: {
      channel: { in: ['EMAIL', 'TEMPLATE'] },
      createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, metadata: true },
  });

  for (const row of candidates) {
    const meta = asObject(row.metadata);
    const stored =
      typeof meta.sgMessageId === 'string' ? normalizeSgMessageId(meta.sgMessageId) : '';
    if (!stored) continue;
    if (sgBase === stored || sgBase.startsWith(stored) || stored.startsWith(sgBase)) {
      return row.id;
    }
  }
  return null;
}

function eventTimestampIso(event: SendGridEvent): string {
  const ts = typeof event.timestamp === 'number' ? event.timestamp : null;
  if (ts && Number.isFinite(ts)) {
    return new Date(ts * 1000).toISOString();
  }
  return new Date().toISOString();
}

interface TrackingMeta {
  status: DeliveryStatus;
  statusRank: number;
  lastEvent: string;
  lastEventAt: string;
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  bouncedAt?: string;
  spamAt?: string;
  openCount: number;
  clickCount: number;
  bounceReason?: string;
  lastClickedUrl?: string;
  sgMessageId?: string;
  /** Recent processed `sg_event_id`s for idempotency (capped). */
  processedEventIds: string[];
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/** Drop `undefined` values — Prisma's Json input does not accept them. */
function pruneUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function readTrackingMeta(metadata: unknown): TrackingMeta {
  const meta = asObject(metadata);
  const existing = asObject(meta.tracking);
  return {
    status: (existing.status as DeliveryStatus) ?? 'sent',
    statusRank: typeof existing.statusRank === 'number' ? existing.statusRank : 0,
    lastEvent: typeof existing.lastEvent === 'string' ? existing.lastEvent : '',
    lastEventAt: typeof existing.lastEventAt === 'string' ? existing.lastEventAt : '',
    sentAt: existing.sentAt as string | undefined,
    deliveredAt: existing.deliveredAt as string | undefined,
    openedAt: existing.openedAt as string | undefined,
    clickedAt: existing.clickedAt as string | undefined,
    bouncedAt: existing.bouncedAt as string | undefined,
    spamAt: existing.spamAt as string | undefined,
    openCount: typeof existing.openCount === 'number' ? existing.openCount : 0,
    clickCount: typeof existing.clickCount === 'number' ? existing.clickCount : 0,
    bounceReason: existing.bounceReason as string | undefined,
    lastClickedUrl: existing.lastClickedUrl as string | undefined,
    sgMessageId: existing.sgMessageId as string | undefined,
    processedEventIds: Array.isArray(existing.processedEventIds)
      ? (existing.processedEventIds as string[]).filter((v) => typeof v === 'string')
      : [],
  };
}

const MAX_PROCESSED_EVENT_IDS = 100;

/** Apply a single event onto an accumulating tracking snapshot. Returns false when ignored (duplicate). */
function applyEvent(meta: TrackingMeta, event: SendGridEvent): boolean {
  const rawEvent = String(event.event ?? '').trim();
  const status = mapEventToStatus(rawEvent);
  if (!status) return false;

  const eventId = typeof event.sg_event_id === 'string' ? event.sg_event_id : '';
  if (eventId && meta.processedEventIds.includes(eventId)) {
    return false; // already applied — keep counts idempotent
  }

  const at = eventTimestampIso(event);
  meta.lastEvent = rawEvent;
  meta.lastEventAt = at;
  if (typeof event.sg_message_id === 'string' && event.sg_message_id) {
    meta.sgMessageId = event.sg_message_id;
  }

  switch (status) {
    case 'sent':
      meta.sentAt = meta.sentAt ?? at;
      break;
    case 'delivered':
      meta.deliveredAt = meta.deliveredAt ?? at;
      break;
    case 'opened':
      meta.openCount += 1;
      meta.openedAt = meta.openedAt ?? at;
      break;
    case 'clicked':
      meta.clickCount += 1;
      meta.clickedAt = meta.clickedAt ?? at;
      if (typeof event.url === 'string') meta.lastClickedUrl = event.url;
      break;
    case 'bounced':
    case 'dropped':
    case 'failed':
      meta.bouncedAt = meta.bouncedAt ?? at;
      if (typeof event.reason === 'string') meta.bounceReason = event.reason;
      break;
    case 'spam':
      meta.spamAt = meta.spamAt ?? at;
      break;
    default:
      break;
  }

  const rank = STATUS_RANK[status] ?? 0;
  if (rank >= meta.statusRank) {
    meta.status = status;
    meta.statusRank = rank;
  }

  if (eventId) {
    meta.processedEventIds.push(eventId);
    if (meta.processedEventIds.length > MAX_PROCESSED_EVENT_IDS) {
      meta.processedEventIds = meta.processedEventIds.slice(-MAX_PROCESSED_EVENT_IDS);
    }
  }
  return true;
}

function trackingMetaToPlain(meta: TrackingMeta): Record<string, unknown> {
  return {
    status: meta.status,
    statusRank: meta.statusRank,
    lastEvent: meta.lastEvent,
    lastEventAt: meta.lastEventAt,
    sentAt: meta.sentAt,
    deliveredAt: meta.deliveredAt,
    openedAt: meta.openedAt,
    clickedAt: meta.clickedAt,
    bouncedAt: meta.bouncedAt,
    spamAt: meta.spamAt,
    openCount: meta.openCount,
    clickCount: meta.clickCount,
    bounceReason: meta.bounceReason,
    lastClickedUrl: meta.lastClickedUrl,
    sgMessageId: meta.sgMessageId,
    processedEventIds: meta.processedEventIds,
  };
}

/**
 * Persist the merged tracking snapshot for a single OutboundCommunication and
 * fan the latest status out to its linked deal activity-log entry.
 */
async function applyEventsToOutbound(ocid: string, events: SendGridEvent[]): Promise<boolean> {
  const outbound = await prisma.outboundCommunication.findUnique({ where: { id: ocid } });
  if (!outbound) {
    console.warn('[sendgridWebhook] outbound row not found for ocid:', ocid);
    return false;
  }

  const meta = readTrackingMeta(outbound.metadata);
  let changed = false;
  for (const event of events) {
    if (applyEvent(meta, event)) {
      changed = true;
    }
  }
  if (!changed) {
    return true;
  }

  const mergedMetadata = pruneUndefined({
    ...asObject(outbound.metadata),
    tracking: trackingMetaToPlain(meta),
  });

  await prisma.outboundCommunication.update({
    where: { id: ocid },
    data: {
      status: meta.status,
      metadata: mergedMetadata as object,
    },
  });

  await propagateToActivityLog(ocid, meta);
  return true;
}

/**
 * The deal Mail Log reads `metadata.status` off the ApplicationActivityLog row.
 * We locate the activity entry that references this OutboundCommunication and
 * mirror the resolved delivery status + key timestamps onto it.
 */
async function propagateToActivityLog(ocid: string, meta: TrackingMeta): Promise<void> {
  try {
    const log = await prisma.applicationActivityLog.findFirst({
      where: {
        metadata: {
          path: ['outboundCommunicationId'],
          equals: ocid,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!log) {
      console.warn('[sendgridWebhook] activity log not found for ocid:', ocid);
      return;
    }

    const mergedMetadata = pruneUndefined({
      ...asObject(log.metadata),
      status: meta.status,
      delivery: {
        status: meta.status,
        deliveredAt: meta.deliveredAt,
        openedAt: meta.openedAt,
        clickedAt: meta.clickedAt,
        bouncedAt: meta.bouncedAt,
        openCount: meta.openCount,
        clickCount: meta.clickCount,
        bounceReason: meta.bounceReason,
        lastEvent: meta.lastEvent,
        lastEventAt: meta.lastEventAt,
      },
    });

    await prisma.applicationActivityLog.update({
      where: { id: log.id },
      data: { metadata: mergedMetadata as object },
    });

  } catch (err) {
    console.error('[sendgridWebhook] activity-log propagation failed:', { ocid, err });
  }
}

export interface ProcessSendGridEventsResult {
  received: number;
  matched: number;
  unmatched: number;
}

/**
 * Entry point for the webhook controller. Groups events by `ocid` so a batch of
 * events for one message is written in a single read/merge/write cycle.
 */
export async function processSendGridEvents(
  events: SendGridEvent[],
): Promise<ProcessSendGridEventsResult> {
  if (!Array.isArray(events) || events.length === 0) {
    return { received: 0, matched: 0, unmatched: 0 };
  }

  const grouped = new Map<string, SendGridEvent[]>();
  let unmatched = 0;

  for (const event of events) {
    const outboundId = await resolveOutboundIdFromEvent(event);
    if (!outboundId) {
      unmatched += 1;
      continue;
    }
    const bucket = grouped.get(outboundId);
    if (bucket) bucket.push(event);
    else grouped.set(outboundId, [event]);
  }

  let matched = 0;
  for (const [ocid, group] of grouped) {
    try {
      const found = await applyEventsToOutbound(ocid, group);
      if (found) matched += 1;
      else unmatched += group.length;
    } catch (err) {
      console.error('[sendgridWebhook] failed to apply events for ocid:', { ocid, err });
    }
  }

  return { received: events.length, matched, unmatched };
}
