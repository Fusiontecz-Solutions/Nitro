import type { PDFDocument, PDFFont } from 'pdf-lib';
import * as fs from 'fs';

const ARIAL_FONT_CANDIDATE_PATHS = [
  process.env.DOCUSIGN_ARIAL_FONT_PATH,
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/Library/Fonts/Arial.ttf',
].filter((p): p is string => Boolean(String(p || '').trim()));

/** Embed Arial (or closest available sans) for flattened prefill PDFs. */
export async function embedArialPdfFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  const { StandardFonts } = await import('pdf-lib');

  for (const fontPath of ARIAL_FONT_CANDIDATE_PATHS) {
    try {
      if (!fs.existsSync(fontPath)) continue;
      const fontkit = await import('@pdf-lib/fontkit');
      pdfDoc.registerFontkit(fontkit.default);
      const fontBytes = fs.readFileSync(fontPath);
      return await pdfDoc.embedFont(fontBytes);
    } catch {
      continue;
    }
  }

  console.warn(
    '[DocuSign] Arial font file not found for PDF flatten — falling back to Helvetica. ' +
      'Set DOCUSIGN_ARIAL_FONT_PATH or install Arial on the server.',
  );
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}
