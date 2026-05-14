import type { Prisma } from '@prisma/client';

/**
 * Scalars on `Application` that belong in `application.create` data but may be missing from
 * an outdated `@prisma/client` until `npx prisma generate` is run.
 */
type ApplicationCreateScalarExtensions = {
  commissionPercentage?: number;
  commissionAmount?: number | null;
  dealDisplayName?: string | null;
  dealId?: string | null;
};

type ApplicationUncheckedCreateBase = Omit<
  Prisma.ApplicationUncheckedCreateInput,
  keyof ApplicationCreateScalarExtensions
>;

/**
 * Application.create `data` for unchecked (FK id) style creates.
 *
 * Uses `Omit` + extension so `commissionPercentage` is a known key even when the generated
 * `ApplicationUncheckedCreateInput` lags behind `schema.prisma`.
 */
export type ApplicationUncheckedCreateData = ApplicationUncheckedCreateBase &
  ApplicationCreateScalarExtensions;

export function applicationCreateUncheckedData(
  data: ApplicationUncheckedCreateData,
): Prisma.ApplicationUncheckedCreateInput {
  return data as Prisma.ApplicationUncheckedCreateInput;
}
