/**
 * The template-face overlay must never shrink a widget box.
 *
 * The face is read through a 24h cache, so its snapshot of the template can be
 * older than the template itself. When a funder enlarges the Owner address
 * widget in SignNow, a live document created afterwards carries the new box —
 * and copying the cached box over it clipped the address back to one line on
 * the Tiberian and Obsidian agreements while Nitro, whose snapshot happened to
 * have been refetched since, rendered correctly.
 *
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports
 * and Jest cannot parse that package's ESM build, so it is stubbed; the template
 * store is stubbed so nothing here touches the database.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { overlayTemplateFieldFace } from './signnow.service';

function liveAddressField(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'text',
    name: 'guarantor_address',
    role: 'Owner',
    page_number: 1,
    x: 121,
    y: 639,
    width: 201,
    height: 67,
    ...overrides,
  };
}

describe('overlayTemplateFieldFace', () => {
  it('keeps the live box when the cached template snapshot is smaller', () => {
    const fields = [liveAddressField()];
    // Tiberian's cached snapshot, taken before the address widget was enlarged.
    const result = overlayTemplateFieldFace(fields, [
      {
        type: 'text',
        name: 'guarantor_address',
        page_number: 1,
        x: 121,
        y: 639,
        width: 184,
        height: 13,
        font: 'Arial',
        size: 14,
      },
    ]);
    expect(fields[0].height).toBe(67);
    expect(fields[0].width).toBe(201);
    // The face itself still comes from the template.
    expect(fields[0].font).toBe('Arial');
    expect(fields[0].size).toBe(14);
    // Reported back so the caller can drop the stale snapshot.
    expect(result.staleBoxes).toBe(2);
  });

  it('restores the template box when the live copy has lost it', () => {
    const fields = [liveAddressField({ width: 12, height: 12 })];
    const result = overlayTemplateFieldFace(fields, [
      {
        type: 'text',
        name: 'guarantor_address',
        page_number: 1,
        x: 121,
        y: 639,
        width: 201,
        height: 67,
      },
    ]);
    expect(fields[0].height).toBe(67);
    expect(fields[0].width).toBe(201);
    expect(result.staleBoxes).toBe(0);
  });

  it('leaves fields the template does not name alone', () => {
    const fields = [liveAddressField({ name: 'only_on_the_document' })];
    const result = overlayTemplateFieldFace(fields, []);
    expect(fields[0].height).toBe(67);
    expect(result.staleBoxes).toBe(0);
  });
});
