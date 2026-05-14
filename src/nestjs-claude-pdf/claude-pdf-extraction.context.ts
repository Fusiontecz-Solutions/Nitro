import type { ConfigService } from "@nestjs/config";
import { ClaudePdfExtractionService } from "./claude-pdf-extraction.service";

let singleton: ClaudePdfExtractionService | undefined;

/**
 * Express-compatible accessor: constructs {@link ClaudePdfExtractionService} directly.
 * Avoids NestFactory.createApplicationContext (heavy DI bootstrap; has been observed to kill
 * the ts-node/nodemon child process mid-Gmail cron with no JS stack on some Windows setups).
 */
export function getClaudePdfExtractionService(): ClaudePdfExtractionService {
  if (!singleton) {
    const envCfg = {
      get: <T = string>(key: string): T | undefined => {
        let v = process.env[key];
        if (v == null || v === "") {
          const bomKey = Object.keys(process.env).find(
            (k) => k.replace(/^\ufeff/, "") === key,
          );
          if (bomKey) v = process.env[bomKey];
        }
        return (v ?? undefined) as T | undefined;
      },
    } as Pick<ConfigService, "get">;
    singleton = new ClaudePdfExtractionService(envCfg as ConfigService);
  }
  return singleton;
}
