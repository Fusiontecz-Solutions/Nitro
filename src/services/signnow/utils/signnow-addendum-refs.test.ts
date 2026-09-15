jest.mock('../../../config/prismaClient', () => ({
  __esModule: true,
  default: { funderProfile: { findMany: jest.fn().mockResolvedValue([]) } },
}));

import {
  expandAddendumRefsAllowingDuplicates,
  resolveSignNowAddendaFromRefs,
} from './signnow-addendum-templates';

describe('Exhibit C attachment count', () => {
  it('attaches exactly one Exhibit C when it is selected once', () => {
    const rows = resolveSignNowAddendaFromRefs(['exhibit_c']);
    const exhibits = rows.filter((row) => /exhibit c/i.test(row.name));
    expect(exhibits).toHaveLength(1);
    expect(exhibits[0].name).toBe('Exhibit C');
    expect(exhibits[0].name).not.toMatch(/\(\d+\)/);
  });

  it('still supports an intentional Exhibit C x N selection', () => {
    const rows = resolveSignNowAddendaFromRefs(['exhibit_c', 'exhibit_c', 'exhibit_c']);
    expect(rows.map((row) => row.name)).toEqual(['Exhibit C', 'Exhibit C (2)', 'Exhibit C (3)']);
  });

  it('does not duplicate other addendums when a ref repeats', () => {
    const rows = resolveSignNowAddendaFromRefs(['ach_daily', 'ach_daily', 'monthly_fee']);
    expect(rows.map((row) => row.layoutKey)).toEqual(['ach_daily', 'monthly_fee']);
  });

  it('keeps ACH Daily out of the Exhibit C instance numbering', () => {
    const rows = resolveSignNowAddendaFromRefs(['exhibit_c', 'ach_daily']);
    expect(rows.map((row) => row.name)).toEqual(['Exhibit C', 'ACH Daily']);
  });

  it('expand() collapses a repeated non-multi ref but keeps Exhibit C copies', () => {
    expect(expandAddendumRefsAllowingDuplicates(['ach_daily', 'ach_daily'])).toEqual([
      'ach_daily',
    ]);
    expect(expandAddendumRefsAllowingDuplicates(['exhibit_c', 'exhibit_c'])).toEqual([
      'exhibit_c',
      'exhibit_c',
    ]);
  });
});
