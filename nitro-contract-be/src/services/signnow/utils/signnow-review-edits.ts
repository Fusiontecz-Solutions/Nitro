/**
 * Edits made inside SignNow Review must reach the merchant's copy.
 *
 * Send re-fills every document from the CRM and, by design, the CRM value beats
 * whatever is already on a widget (see `existingValuesBeneathCrmValues`) — that is
 * what clears stale warm placeholders. It also threw away anything the preparer
 * changed in the Review screen.
 *
 * Review now records what each widget showed the moment its documents were filled
 * and verified (`snapshotSignNowWidgetValues`). At Send, a widget whose value on
 * the page differs from that snapshot was changed in SignNow, and that value wins
 * over the CRM (`signNowReviewEdits`). A widget nobody touched still follows the
 * CRM exactly as before.
 */

const SKIP_TYPES = new Set([
  'signature',
  'initials',
  'stamp',
  'checkmark',
  'checkbox',
  'radiobutton',
  'attachment',
  'date',
  'datepicker',
  'datetime',
]);

function attrsOf(field: any): Record<string, any> {
  let attrs = field?.json_attributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      attrs = {};
    }
  }
  return attrs && typeof attrs === 'object' ? (attrs as Record<string, any>) : {};
}

function clean(value: unknown): string {
  const v = String(value ?? '').trim();
  return /^enter text$/i.test(v) ? '' : v;
}

/**
 * Current value of every named text widget on a SignNow document JSON.
 *
 * A value typed into a widget during a signing / review session can be stored as
 * a `texts[]` element the field points at (`element_id`), not on the field itself,
 * so that link is followed first; then the field's own `data` / `prefilled_text`.
 */
export function snapshotSignNowWidgetValues(remote: any): Record<string, string> {
  const out: Record<string, string> = {};
  const texts = Array.isArray(remote?.texts) ? remote.texts : [];
  const textById = new Map<string, string>();
  for (const t of texts) {
    const id = String(t?.id ?? t?.unique_id ?? '').trim();
    const data = clean(t?.data ?? t?.text);
    if (id && data) textById.set(id, data);
  }
  for (const container of ['fields', 'fillable_fields']) {
    const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
    for (const field of rows) {
      if (!field || typeof field !== 'object') continue;
      const attrs = attrsOf(field);
      const type = String(field.type || attrs.type || '').toLowerCase();
      if (type && SKIP_TYPES.has(type)) continue;
      const name = String(attrs.name || field.name || field.field_name || '').trim();
      if (!name) continue;
      const linked = textById.get(String(field.element_id ?? attrs.element_id ?? '').trim());
      const value =
        linked ||
        clean(field.data) ||
        clean(attrs.data) ||
        clean(attrs.prefilled_text) ||
        clean(field.prefilled_text);
      if (value && !(name in out)) out[name] = value;
    }
  }
  return out;
}

/**
 * Widgets changed in SignNow since Review opened: on the page now, different from
 * the snapshot, and the snapshot had a value for them (a box the CRM left empty is
 * already kept by the existing send logic). A box cleared in SignNow is not treated
 * as an edit, so a widget that cannot be read never blanks a CRM value.
 */
export function signNowReviewEdits(
  reviewSnapshot: Record<string, string> | null | undefined,
  current: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!reviewSnapshot) return out;
  for (const [name, before] of Object.entries(reviewSnapshot)) {
    const was = clean(before);
    const now = clean(current[name]);
    if (!was || !now) continue;
    if (now !== was) out[name] = now;
  }
  return out;
}

/** Stored on `Document.reviewWidgetValues`. */
export type SignNowReviewWidgetSnapshot = {
  groupId: string;
  documents: Record<string, Record<string, string>>;
};

export function readSignNowReviewSnapshot(
  raw: unknown,
  groupId: string,
): SignNowReviewWidgetSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (String(r.groupId ?? '').trim() !== String(groupId ?? '').trim()) return null;
  const docs = r.documents;
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return null;
  return { groupId: String(r.groupId), documents: docs as Record<string, Record<string, string>> };
}
