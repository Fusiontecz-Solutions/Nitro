import {
  orderSignNowGroupDocuments,
  sameSignNowDocumentOrder,
  signNowDocumentIdsInOrder,
  signNowDocumentOrderRank,
  sortSignNowSupplementalsForPackage,
  SIGNNOW_ORDER_ADDENDUM,
  SIGNNOW_ORDER_CONTRACT,
  SIGNNOW_ORDER_DISCLOSURE,
} from './signnow-document-order';

describe('signNowDocumentOrderRank', () => {
  it('prefers assembled id hints over document names', () => {
    const rank = signNowDocumentOrderRank(
      { id: 'a1', document_name: 'Nitro Advance Agreement' },
      { addendumIds: ['A1'] },
    );
    expect(rank).toBe(SIGNNOW_ORDER_ADDENDUM);
  });

  it('classifies disclosure, agreement and addenda by name', () => {
    expect(signNowDocumentOrderRank({ id: '1', document_name: 'State Disclosure' })).toBe(
      SIGNNOW_ORDER_DISCLOSURE,
    );
    expect(signNowDocumentOrderRank({ id: '2', document_name: 'PCM_CONTRACT' })).toBe(
      SIGNNOW_ORDER_CONTRACT,
    );
    expect(signNowDocumentOrderRank({ id: '3', document_name: 'Exhibit C' })).toBe(
      SIGNNOW_ORDER_ADDENDUM,
    );
    expect(signNowDocumentOrderRank({ id: '4', document_name: 'ACH Daily' })).toBe(
      SIGNNOW_ORDER_ADDENDUM,
    );
  });

  it('keeps an unrecognized template copy with the contract', () => {
    expect(signNowDocumentOrderRank({ id: '5', document_name: 'Schedule 1' })).toBe(
      SIGNNOW_ORDER_CONTRACT,
    );
  });
});

describe('sortSignNowSupplementalsForPackage', () => {
  it('puts the disclosure first and keeps addendum selection order', () => {
    const sorted = sortSignNowSupplementalsForPackage([
      { name: 'Exhibit C', type: 'addendum' },
      { name: 'ACH Daily', type: 'addendum' },
      { name: 'State Disclosure', type: 'disclosure' },
      { name: 'Monthly Fee', type: 'addendum' },
    ]);
    expect(sorted.map((row) => row.name)).toEqual([
      'State Disclosure',
      'Exhibit C',
      'ACH Daily',
      'Monthly Fee',
    ]);
  });

  it('is stable for multiple addendums and independent of input order', () => {
    const a = sortSignNowSupplementalsForPackage([
      { name: 'Addendum 1', type: 'addendum' },
      { name: 'Addendum 2', type: 'addendum' },
      { name: 'Addendum 3', type: 'addendum' },
      { name: 'Disclosure', type: 'disclosure' },
    ]);
    const b = sortSignNowSupplementalsForPackage([
      { name: 'Disclosure', type: 'disclosure' },
      { name: 'Addendum 1', type: 'addendum' },
      { name: 'Addendum 2', type: 'addendum' },
      { name: 'Addendum 3', type: 'addendum' },
    ]);
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name));
    expect(a.map((r) => r.name)).toEqual([
      'Disclosure',
      'Addendum 1',
      'Addendum 2',
      'Addendum 3',
    ]);
  });
});

describe('orderSignNowGroupDocuments', () => {
  it('orders Disclosure -> Contract -> Addendums', () => {
    const ordered = orderSignNowGroupDocuments([
      { id: 'c', document_name: 'PCM_CONTRACT Agreement' },
      { id: 'x1', document_name: 'Exhibit C' },
      { id: 'd', document_name: 'State Disclosure' },
      { id: 'x2', document_name: 'ACH Daily' },
    ]);
    expect(signNowDocumentIdsInOrder(ordered)).toEqual(['d', 'c', 'x1', 'x2']);
  });

  it('is deterministic regardless of the order SignNow returned members in', () => {
    const docs = [
      { id: 'd', document_name: 'State Disclosure' },
      { id: 'c', document_name: 'Nitro Advance Agreement' },
      { id: 'a1', document_name: 'Addendum 1' },
      { id: 'a2', document_name: 'Addendum 2' },
    ];
    const shuffled = [docs[2], docs[0], docs[3], docs[1]];
    expect(signNowDocumentIdsInOrder(orderSignNowGroupDocuments(docs))).toEqual(
      signNowDocumentIdsInOrder(orderSignNowGroupDocuments(shuffled)),
    );
  });

  it('keeps multiple addendums in their attached order', () => {
    const ordered = orderSignNowGroupDocuments(
      [
        { id: 'a3', document_name: 'Addendum 3' },
        { id: 'd', document_name: 'Disclosure' },
        { id: 'a1', document_name: 'Addendum 1' },
        { id: 'c', document_name: 'Agreement' },
        { id: 'a2', document_name: 'Addendum 2' },
      ],
      { disclosureIds: ['d'], contractIds: ['c'], addendumIds: ['a1', 'a2', 'a3'] },
    );
    // Stable sort preserves relative addendum order as attached.
    expect(signNowDocumentIdsInOrder(ordered)).toEqual(['d', 'c', 'a3', 'a1', 'a2']);
  });
});

describe('sameSignNowDocumentOrder', () => {
  it('compares case-insensitively and by position', () => {
    expect(sameSignNowDocumentOrder(['A', 'b'], ['a', 'B'])).toBe(true);
    expect(sameSignNowDocumentOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSignNowDocumentOrder(['a'], ['a', 'b'])).toBe(false);
  });
});
