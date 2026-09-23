/**
 * PATCH /integration-settings/funders/:id must be a genuine partial update.
 *
 * `parseFunderProfileBody` previously emitted `name: ''` and
 * `docusignAccountProfileId: null` whether or not the caller sent those keys, so
 * any partial patch (for example one that only rewrites a funder's SignNow
 * template list) blanked the funder's name and unlinked its DocuSign account.
 * These tests pin the field-by-field partiality down.
 */
import { parseFunderProfileBody } from './funderProfileBodyParser';

describe('parseFunderProfileBody', () => {
  it('omits every key the caller did not send', () => {
    const parsed = parseFunderProfileBody({
      signnowAddendumTemplates: [{ name: 'PayOff', link: 'abc' }],
    });
    expect(parsed.name).toBeUndefined();
    expect(parsed.docusignAccountProfileId).toBeUndefined();
    expect('name' in parsed ? parsed.name : undefined).toBeUndefined();
    expect(parsed.isActive).toBeUndefined();
    expect(parsed.displayName).toBeUndefined();
    expect(parsed.allowedStates).toBeUndefined();
    expect(parsed.signnowAddendumTemplates).toEqual([{ name: 'PayOff', link: 'abc' }]);
  });

  it('still reads the fields the caller did send', () => {
    const parsed = parseFunderProfileBody({
      name: '  Tiberian Funding  ',
      isActive: 'true',
      docusignAccountProfileId: 'acct-1',
    });
    expect(parsed.name).toBe('Tiberian Funding');
    expect(parsed.isActive).toBe(true);
    expect(parsed.docusignAccountProfileId).toBe('acct-1');
  });

  it('treats an explicitly empty docusign account id as "unlink"', () => {
    expect(parseFunderProfileBody({ docusignAccountProfileId: '' }).docusignAccountProfileId).toBeNull();
    expect(
      parseFunderProfileBody({ docusignAccountProfileId: null }).docusignAccountProfileId,
    ).toBeNull();
  });

  it('parses template lists sent as multipart JSON strings', () => {
    const parsed = parseFunderProfileBody({
      signnowDisclosureTemplates: JSON.stringify([{ name: 'Texas Daily', link: 'xyz' }]),
    });
    expect(parsed.signnowDisclosureTemplates).toEqual([{ name: 'Texas Daily', link: 'xyz' }]);
  });
});
