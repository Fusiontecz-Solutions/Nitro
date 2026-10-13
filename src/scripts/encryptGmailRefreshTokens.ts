/**
 * Encrypt legacy plain-text Google refresh tokens on User rows.
 *
 *   npm run encrypt:gmail-tokens             # encrypt
 *   npm run encrypt:gmail-tokens -- --dry-run
 *
 * Idempotent: already-encrypted values (`enc:v1:`) are skipped. Each row is
 * updated only if its token is unchanged since it was read (a concurrent
 * reconnect wins). Prints counts and user ids only — never a token.
 * Requires FIELD_ENCRYPTION_KEY (the same key the app uses to decrypt).
 */
import 'dotenv/config';
import prisma from '../config/prismaClient';
import { decryptRefreshToken, encryptRefreshToken, isEncryptedToken } from '../services/gmail/gmailTokenCrypto';

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    if (!process.env.FIELD_ENCRYPTION_KEY) throw new Error('FIELD_ENCRYPTION_KEY is not set — refusing to run.');

    const users = await prisma.user.findMany({
        where: { googleRefreshToken: { not: null } },
        select: { id: true, googleRefreshToken: true },
    });

    let encrypted = 0;
    let alreadyEncrypted = 0;
    let undecryptable = 0;
    let skippedChanged = 0;
    for (const user of users) {
        const stored = String(user.googleRefreshToken ?? '').trim();
        if (!stored) continue;
        if (isEncryptedToken(stored)) {
            if (!decryptRefreshToken(stored)) {
                undecryptable += 1;
                console.warn(`user ${user.id}: encrypted token does not decrypt with the current key (user must reconnect Gmail)`);
            } else {
                alreadyEncrypted += 1;
            }
            continue;
        }
        if (dryRun) {
            encrypted += 1;
            continue;
        }
        const result = await prisma.user.updateMany({
            where: { id: user.id, googleRefreshToken: stored },
            data: { googleRefreshToken: encryptRefreshToken(stored) },
        });
        if (result.count === 1) encrypted += 1;
        else skippedChanged += 1;
    }

    console.log(
        `${dryRun ? '[dry-run] would encrypt' : 'encrypted'}: ${encrypted}, already encrypted: ${alreadyEncrypted}, ` +
            `undecryptable: ${undecryptable}, changed during run: ${skippedChanged}, total with a token: ${users.length}`,
    );
}

main()
    .catch((error) => {
        console.error('encryptGmailRefreshTokens failed:', (error as Error)?.message);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
