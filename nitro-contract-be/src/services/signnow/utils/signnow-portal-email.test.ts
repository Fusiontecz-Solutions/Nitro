import { buildSigningPortalEmailHtml } from './signnow-portal-email';

describe('buildSigningPortalEmailHtml', () => {
  const base = {
    contractLabel: 'Obsidian Capital Group RE-NEW-IT RENOVATIONS, LLC $4,000.00',
    signingLink: 'https://crm.example.com/sign?t=abc',
  };

  it("brands the header with the funder's name, not Nitro Advance", () => {
    const html = buildSigningPortalEmailHtml({ ...base, funderName: 'Obsidian Capital Group' });
    expect(html).toContain('Obsidian Capital Group');
    expect(html).not.toContain('Nitro Advance');
  });

  it('falls back to the house brand when no funder is known', () => {
    const html = buildSigningPortalEmailHtml({ ...base, funderName: '  ' });
    expect(html).toContain('Nitro Advance');
  });
});
