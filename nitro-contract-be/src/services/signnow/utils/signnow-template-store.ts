import prisma from '../../../config/prismaClient';

/**
 * Durable store for SignNow template documents.
 *
 * The in-process `templateDocumentCache` already removes repeat GETs inside one
 * request, but it is cold on every deploy, restart and additional instance —
 * and the agreement template is a 22-page document with hundreds of widgets that
 * the prefill field-face overlay reads on nearly every Review. Persisting the
 * payload moves that cost from "once per process" to "once per TTL, globally".
 *
 * Templates only change when someone edits them in SignNow, so the TTL is long
 * and there is an explicit invalidation for when a funder's template link is
 * repointed.
 */

/** Default 24h — templates are edited by hand, not by the app. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function signNowTemplateStoreTtlMs(): number {
  const raw = Number(process.env.SIGNNOW_TEMPLATE_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

/**
 * Cached template payload, or null when absent/expired.
 * Never throws: a cache miss must degrade to a live SignNow fetch, not fail the send.
 */
export async function readStoredTemplateDocument(
  templateId: string,
  ttlMs = signNowTemplateStoreTtlMs(),
): Promise<any | null> {
  const id = String(templateId || '').trim();
  if (!id) return null;
  try {
    const row = await prisma.signNowTemplateCache.findUnique({
      where: { templateId: id },
      select: { document: true, fetchedAt: true },
    });
    if (!row) return null;
    if (Date.now() - new Date(row.fetchedAt).getTime() > ttlMs) return null;
    return row.document ?? null;
  } catch (err) {
    console.warn('[SignNow] template cache read failed; falling back to API', {
      templateId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Write through after a live fetch. Best-effort — never blocks or fails the send. */
export async function writeStoredTemplateDocument(
  templateId: string,
  document: unknown,
): Promise<void> {
  const id = String(templateId || '').trim();
  if (!id || document == null) return;
  const documentName =
    String(
      (document as any)?.document_name ||
        (document as any)?.name ||
        (document as any)?.original_filename ||
        '',
    ).trim() || null;
  try {
    await prisma.signNowTemplateCache.upsert({
      where: { templateId: id },
      create: { templateId: id, documentName, document: document as any, fetchedAt: new Date() },
      update: { documentName, document: document as any, fetchedAt: new Date() },
    });
  } catch (err) {
    console.warn('[SignNow] template cache write failed', {
      templateId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Drop a stored template — call when a funder repoints a template link. */
export async function invalidateStoredTemplateDocument(templateId: string): Promise<void> {
  const id = String(templateId || '').trim();
  if (!id) return;
  try {
    await prisma.signNowTemplateCache.deleteMany({ where: { templateId: id } });
  } catch (err) {
    console.warn('[SignNow] template cache invalidation failed', {
      templateId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
