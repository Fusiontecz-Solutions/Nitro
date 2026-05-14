import cron, { validate as validateCronExpression } from 'node-cron';
import prisma from '../config/prismaClient';
import oAuth2Client from '../config/gmail';
import { autoCreateApplicationsFromEmails } from '../services/gmail.service';

/** Default matches historical behavior (every minute). Override with `GMAIL_PDF_INBOX_CRON` (validated). */
const DEFAULT_GMAIL_INBOX_CRON = '* * * * *';

let gmailSweepInProgress = false;

function resolveGmailInboxCronExpression(): string {
  const raw = String(process.env.GMAIL_PDF_INBOX_CRON ?? '').trim();
  if (!raw) return DEFAULT_GMAIL_INBOX_CRON;
  if (!validateCronExpression(raw)) {
    console.warn(
      `[gmail-auto-create] invalid GMAIL_PDF_INBOX_CRON="${raw}"; using default ${DEFAULT_GMAIL_INBOX_CRON}`,
    );
    return DEFAULT_GMAIL_INBOX_CRON;
  }
  return raw;
}

async function runGmailPdfInboxSweep(): Promise<void> {
  if (gmailSweepInProgress) {
    console.warn('[gmail-auto-create] previous sweep still running; skipping this tick');
    return;
  }
  gmailSweepInProgress = true;
  try {
    const gmailUsers = await prisma.user.findMany({
      where: {
        googleRefreshToken: {
          not: null,
        },
      },
      select: {
        id: true,
        email: true,
        googleRefreshToken: true,
      },
    });

    if (gmailUsers.length === 0) {
      return;
    }

    console.log('[gmail-auto-create] checking Gmail PDF emails', new Date().toISOString());

    for (const user of gmailUsers) {
      const refreshToken = String(user.googleRefreshToken || '').trim();
      if (!refreshToken) continue;
      try {
        oAuth2Client.setCredentials({ refresh_token: refreshToken });
        const accessTokenResponse = await oAuth2Client.getAccessToken();
        const accessToken = accessTokenResponse?.token;
        if (!accessToken) continue;
        const created = await autoCreateApplicationsFromEmails(accessToken, user.id);
        if (created.length > 0) {
          console.log(
            `[gmail-auto-create] user=${user.email || user.id} created=${created.length}`,
          );
        }
      } catch (userError) {
        console.error(`[gmail-auto-create] failed for user=${user.email || user.id}:`, userError);
      }
    }
  } finally {
    gmailSweepInProgress = false;
  }
}

export function startCronJob(): void {
  const expression = resolveGmailInboxCronExpression();
  console.log(`[gmail-auto-create] cron scheduled: "${expression}"`);
  cron.schedule(expression, () => {
    void runGmailPdfInboxSweep().catch((err) => {
      console.error('[gmail-auto-create] cron promise rejected (would otherwise crash the process):', err);
    });
  });
}
