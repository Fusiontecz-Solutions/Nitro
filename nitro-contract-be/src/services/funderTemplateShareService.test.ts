const findUnique = jest.fn();
const findMany = jest.fn();
const update = jest.fn((args: unknown) => ({ __update: args }));
const $transaction = jest.fn(async (ops: unknown[]) => ops);

jest.mock('../config/prismaClient', () => ({
  __esModule: true,
  default: {
    funderProfile: { findUnique, findMany, update },
    $transaction,
  },
}));

import {
  describeShareResult,
  funderTemplateColumn,
  funderTemplateIdentity,
  isFunderTemplateKind,
  mergeFunderTemplates,
  readFunderTemplateList,
  shareFunderTemplates,
} from './funderTemplateShareService';

const PAYOFF_ID = '3aa4e0ff1ab04ef2b1ba6de3a4d5f3b0c2f1a8d7';
const EXHIBIT_C_ID = '9f2b1c0d4e5a6b7c8d9e0f1a2b3c4d5e6f708192';
const PAYOFF_URL = `https://app.signnow.com/webapp/document/${PAYOFF_ID}?route=fieldinvite`;

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
  update.mockClear();
  $transaction.mockClear();
});

describe('template identity and parsing', () => {
  it('keys off the SignNow template id, not the link wrapper', () => {
    expect(funderTemplateIdentity({ name: 'PayOff', link: PAYOFF_URL })).toBe(
      `signnow:${PAYOFF_ID}`,
    );
    expect(funderTemplateIdentity({ name: 'Payoff', link: PAYOFF_ID.toUpperCase() })).toBe(
      `signnow:${PAYOFF_ID}`,
    );
  });

  it('falls back to the raw link, then the name, for unparseable rows', () => {
    expect(funderTemplateIdentity({ name: 'X', link: ' Some/Link ' })).toBe('link:some/link');
    expect(funderTemplateIdentity({ name: ' Flex ', link: '' })).toBe('name:flex');
  });

  it('reads a Json column that holds an array, a JSON string, or junk', () => {
    expect(readFunderTemplateList([{ name: 'A', link: PAYOFF_ID }])).toEqual([
      { name: 'A', link: PAYOFF_ID },
    ]);
    expect(readFunderTemplateList(JSON.stringify([{ name: 'A', url: PAYOFF_ID }]))).toEqual([
      { name: 'A', link: PAYOFF_ID },
    ]);
    expect(readFunderTemplateList(null)).toEqual([]);
    expect(readFunderTemplateList('not json')).toEqual([]);
    expect(readFunderTemplateList([{ name: '  ', link: '  ' }, 5, null])).toEqual([]);
  });

  it('maps each kind to its column', () => {
    expect(funderTemplateColumn('addendum')).toBe('signnowAddendumTemplates');
    expect(funderTemplateColumn('disclosure')).toBe('signnowDisclosureTemplates');
    expect(isFunderTemplateKind('addendum')).toBe(true);
    expect(isFunderTemplateKind('contract')).toBe(false);
  });
});

describe('mergeFunderTemplates', () => {
  it('appends new templates and keeps the target rows already there', () => {
    const result = mergeFunderTemplates(
      [{ name: 'Exhibit C', link: EXHIBIT_C_ID }],
      [{ name: 'PayOff Addendum', link: PAYOFF_ID }],
    );
    expect(result.merged).toEqual([
      { name: 'Exhibit C', link: EXHIBIT_C_ID },
      { name: 'PayOff Addendum', link: PAYOFF_ID },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('is idempotent and never renames the target existing copy', () => {
    const existing = [{ name: 'Payoff (theirs)', link: PAYOFF_ID }];
    const result = mergeFunderTemplates(existing, [{ name: 'PayOff Addendum', link: PAYOFF_URL }]);
    expect(result.merged).toEqual(existing);
    expect(result.added).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('drops duplicates inside the incoming selection itself', () => {
    const result = mergeFunderTemplates([], [
      { name: 'PayOff Addendum', link: PAYOFF_ID },
      { name: 'Payoff copy', link: PAYOFF_URL },
    ]);
    expect(result.merged).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
});

describe('shareFunderTemplates', () => {
  const sourceRow = {
    id: 'src',
    name: 'Tiberian Funding',
    signnowAddendumTemplates: [
      { name: 'PayOff Addendum', link: PAYOFF_ID },
      { name: 'Exhibit C', link: EXHIBIT_C_ID },
    ],
  };

  it('writes only the targets that gain something, in one transaction', async () => {
    findUnique.mockResolvedValue(sourceRow);
    findMany.mockResolvedValue([
      { id: 'a', name: 'Obsidian Capital Group', signnowAddendumTemplates: null },
      {
        id: 'b',
        name: 'Nitro Advance',
        signnowAddendumTemplates: [{ name: 'Payoff', link: PAYOFF_URL }],
      },
    ]);

    const result = await shareFunderTemplates({
      sourceFunderId: 'src',
      kind: 'addendum',
      templates: [{ name: 'PayOff Addendum', link: PAYOFF_ID }],
      targetFunderIds: ['a', 'b'],
    });

    expect(result.updated.map((entry) => entry.funderId)).toEqual(['a']);
    expect(result.unchanged.map((entry) => entry.funderId)).toEqual(['b']);
    expect(result.addedCount).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { signnowAddendumTemplates: [{ name: 'PayOff Addendum', link: PAYOFF_ID }] },
    });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('merges against the target live row, preserving templates it already had', async () => {
    findUnique.mockResolvedValue(sourceRow);
    findMany.mockResolvedValue([
      {
        id: 'a',
        name: 'Obsidian Capital Group',
        signnowAddendumTemplates: [{ name: 'Their own', link: 'abc' }],
      },
    ]);

    await shareFunderTemplates({
      sourceFunderId: 'src',
      kind: 'addendum',
      templates: [{ name: 'Exhibit C', link: EXHIBIT_C_ID }],
      targetFunderIds: ['a'],
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: {
        signnowAddendumTemplates: [
          { name: 'Their own', link: 'abc' },
          { name: 'Exhibit C', link: EXHIBIT_C_ID },
        ],
      },
    });
  });

  it('writes disclosures to the disclosure column', async () => {
    findUnique.mockResolvedValue({
      id: 'src',
      name: 'Tiberian Funding',
      signnowDisclosureTemplates: [{ name: 'Tiberian Disclosure', link: PAYOFF_ID }],
    });
    findMany.mockResolvedValue([{ id: 'a', name: 'Obsidian', signnowDisclosureTemplates: null }]);

    await shareFunderTemplates({
      sourceFunderId: 'src',
      kind: 'disclosure',
      templates: [{ name: 'Tiberian Disclosure', link: PAYOFF_ID }],
      targetFunderIds: ['a'],
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: {
        signnowDisclosureTemplates: [{ name: 'Tiberian Disclosure', link: PAYOFF_ID }],
      },
    });
  });

  it('never shares onto the source funder itself', async () => {
    findUnique.mockResolvedValue(sourceRow);
    await expect(
      shareFunderTemplates({
        sourceFunderId: 'src',
        kind: 'addendum',
        templates: [{ name: 'PayOff Addendum', link: PAYOFF_ID }],
        targetFunderIds: ['src'],
      }),
    ).rejects.toThrow(/at least one other funder/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a template that is not saved on the source funder', async () => {
    findUnique.mockResolvedValue(sourceRow);
    await expect(
      shareFunderTemplates({
        sourceFunderId: 'src',
        kind: 'addendum',
        templates: [{ name: 'Someone elses', link: 'ffffffffffffffffffffffffffffffffffffffff' }],
        targetFunderIds: ['a'],
      }),
    ).rejects.toThrow(/is not a saved addendum on this funder/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('404s when the source funder does not exist', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      shareFunderTemplates({
        sourceFunderId: 'nope',
        kind: 'addendum',
        templates: [{ name: 'PayOff Addendum', link: PAYOFF_ID }],
        targetFunderIds: ['a'],
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects the whole request when a target funder does not exist', async () => {
    findUnique.mockResolvedValue(sourceRow);
    findMany.mockResolvedValue([{ id: 'a', name: 'Obsidian', signnowAddendumTemplates: null }]);
    await expect(
      shareFunderTemplates({
        sourceFunderId: 'src',
        kind: 'addendum',
        templates: [{ name: 'PayOff Addendum', link: PAYOFF_ID }],
        targetFunderIds: ['a', 'ghost'],
      }),
    ).rejects.toThrow(/not found: ghost/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an empty selection', async () => {
    await expect(
      shareFunderTemplates({
        sourceFunderId: 'src',
        kind: 'addendum',
        templates: [],
        targetFunderIds: ['a'],
      }),
    ).rejects.toThrow(/at least one addendum/i);
  });

  it('summarises what was copied and what was already there', async () => {
    findUnique.mockResolvedValue(sourceRow);
    findMany.mockResolvedValue([
      { id: 'a', name: 'Obsidian Capital Group', signnowAddendumTemplates: null },
      {
        id: 'b',
        name: 'Nitro Advance',
        signnowAddendumTemplates: [{ name: 'Payoff', link: PAYOFF_ID }],
      },
    ]);
    const result = await shareFunderTemplates({
      sourceFunderId: 'src',
      kind: 'addendum',
      templates: [{ name: 'PayOff Addendum', link: PAYOFF_ID }],
      targetFunderIds: ['a', 'b'],
    });
    expect(describeShareResult(result)).toBe(
      'Shared 1 addendum with Obsidian Capital Group. 1 funder already had them.',
    );
  });
});
