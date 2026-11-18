jest.mock('../../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    funderProfile: {
      findMany: jest.fn().mockResolvedValue([
        {
          signnowAddendumTemplates: [
            { name: 'Nitro Custom Rider', link: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' },
          ],
          signnowDisclosureTemplates: [],
        },
      ]),
    },
  },
}));

import {
  getSignNowDisclosureTemplates,
  resolveSignNowSupplementalTemplateByDocumentName,
  signNowAchWeeklyTemplateId,
  signNowExhibitCTemplateId,
} from './signnow-addendum-templates';

/**
 * A resend rebuilds every document from the template it was copied from, so a
 * live document name has to map back to that template — including the copy
 * suffix SignNow adds when the same layout is attached twice.
 */
describe('supplemental template by live document name', () => {
  it('matches a catalog addendum by its document name', async () => {
    const row = await resolveSignNowSupplementalTemplateByDocumentName('ACH Weekly');
    expect(row?.templateId).toBe(signNowAchWeeklyTemplateId());
  });

  it('ignores the copy suffix and file extension', async () => {
    const row = await resolveSignNowSupplementalTemplateByDocumentName('Exhibit C (2).pdf');
    expect(row?.templateId).toBe(signNowExhibitCTemplateId());
  });

  it('matches the disclosure', async () => {
    const row = await resolveSignNowSupplementalTemplateByDocumentName('State Disclosure');
    expect(row?.templateId).toBe(getSignNowDisclosureTemplates()[0].templateId);
  });

  it('falls back to a funder Settings template', async () => {
    const row = await resolveSignNowSupplementalTemplateByDocumentName('Nitro Custom Rider');
    expect(row?.templateId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1');
  });

  it('returns null for a document no template matches', async () => {
    expect(await resolveSignNowSupplementalTemplateByDocumentName('Totally Unknown')).toBeNull();
  });
});
