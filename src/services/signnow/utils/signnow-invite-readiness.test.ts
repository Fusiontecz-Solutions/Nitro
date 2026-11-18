import {
  describeSignNowDocumentReadiness,
  findUnloadableSignNowDocuments,
  isSignNowGroupAlreadySent,
} from './signnow-invite-readiness';

describe('isSignNowGroupAlreadySent', () => {
  it('treats a portal send as sent', () => {
    expect(isSignNowGroupAlreadySent({ status: 'sent', portalSentAt: new Date() })).toBe(true);
  });

  it('treats a stamped sentAt as sent even when status lags', () => {
    expect(isSignNowGroupAlreadySent({ status: 'created', sentAt: new Date() })).toBe(true);
  });

  it('treats status "Sent" case-insensitively', () => {
    expect(isSignNowGroupAlreadySent({ status: 'Sent' })).toBe(true);
  });

  it('keeps an open draft reusable', () => {
    expect(isSignNowGroupAlreadySent({ status: 'created', sentAt: null, portalSentAt: null })).toBe(
      false,
    );
  });

  it('keeps a group with no Document row reusable (e.g. an unlinked warm)', () => {
    expect(isSignNowGroupAlreadySent(null)).toBe(false);
    expect(isSignNowGroupAlreadySent(undefined)).toBe(false);
  });
});

describe('findUnloadableSignNowDocuments', () => {
  const readable = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    document_name: `Doc ${id}`,
    remote: { page_count: '3', ...extra },
    fieldCount: 12,
  });

  it('passes a group whose every document was read back from SignNow', () => {
    expect(findUnloadableSignNowDocuments([readable('a'), readable('b'), readable('c')])).toEqual(
      [],
    );
  });

  it('flags the document SignNow never returned (deleted / still copying)', () => {
    const bad = findUnloadableSignNowDocuments([
      readable('a'),
      { id: 'b', document_name: 'Addendum' },
      readable('c'),
    ]);
    expect(bad).toEqual([
      { documentId: 'b', name: 'Addendum', readable: false, pageCount: 0, fieldCount: 0 },
    ]);
  });

  it('does not block a readable document whose payload omits page metadata', () => {
    expect(findUnloadableSignNowDocuments([{ id: 'a', remote: {}, fieldCount: 0 }])).toEqual([]);
  });

  it('does not block a field-less document that a merchant publish baked to page text', () => {
    expect(findUnloadableSignNowDocuments([readable('a', { fields: [] })])).toEqual([]);
  });

  it('ignores refs without an id', () => {
    expect(findUnloadableSignNowDocuments([{ id: '' }, { id: '   ' }])).toEqual([]);
  });
});

describe('describeSignNowDocumentReadiness', () => {
  it('reports page and field counts without any document content', () => {
    const [row] = describeSignNowDocumentReadiness([
      {
        id: 'c6b96aa2',
        name: 'Contract',
        remote: { pages: [{}, {}], texts: [{ data: 'secret value' }] },
        fieldCount: 7,
      },
    ]);
    expect(row).toEqual({
      documentId: 'c6b96aa2',
      name: 'Contract',
      readable: true,
      pageCount: 2,
      fieldCount: 7,
    });
    expect(JSON.stringify(row)).not.toContain('secret value');
  });

  it('prefers the larger of page_count and pages[] like the service does', () => {
    const [row] = describeSignNowDocumentReadiness([
      { id: 'x', remote: { page_count: 1, pages: [{}, {}, {}] } },
    ]);
    expect(row.pageCount).toBe(3);
  });
});
