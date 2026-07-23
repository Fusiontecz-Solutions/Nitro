import {
  normalizeComparableText,
  normalizeIncorporationDate,
  normalizeStateCode,
  parseUsAddressBlob,
} from "./opencorporatesComparison";
import type { ClearBusinessHit, ClearPersonHit } from "./clearTypes";

export type ComparisonStatus = "match" | "mismatch" | "neutral";

export type ClearBusinessSyncFieldKey =
  | "businessName"
  | "businessEinNumber"
  | "address1"
  | "city"
  | "state"
  | "zipCode";

export type ClearPersonSyncFieldKey =
  | "firstName"
  | "middleName"
  | "lastName"
  | "dateOfBirth"
  | "ssn"
  | "address1"
  | "city"
  | "state"
  | "zipCode"
  | "email"
  | "mobileNumber";

export type ClearComparisonRow = {
  key: string;
  label: string;
  applicationValue: string;
  clearValue: string;
  status: ComparisonStatus;
  syncField?: ClearBusinessSyncFieldKey | ClearPersonSyncFieldKey;
};

export type ApplicationBusinessSnapshot = {
  businessName: string;
  businessEinNumber: string;
  address1: string;
  city: string;
  state: string;
  zipCode: string;
};

export type ApplicationOwnerSnapshot = {
  ownerId?: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  ssn: string;
  email: string;
  mobileNumber: string;
  address1: string;
  city: string;
  state: string;
  zipCode: string;
};

function formatDisplay(value: string): string {
  return value.trim() || "—";
}

function hasDisplayValue(value: string): boolean {
  const trimmed = String(value ?? "").trim();
  return Boolean(trimmed) && trimmed !== "—";
}

function compareText(appValue: string, clearValue: string): ComparisonStatus {
  const app = normalizeComparableText(appValue);
  const clear = normalizeComparableText(clearValue);
  if (!app && !clear) return "neutral";
  if (!app || !clear) return "neutral";
  return app === clear ? "match" : "mismatch";
}

function compareDate(appValue: string, clearValue: string): ComparisonStatus {
  const app = normalizeIncorporationDate(appValue);
  const clear = normalizeIncorporationDate(clearValue);
  if (!app && !clear) return "neutral";
  if (!app || !clear) return "neutral";
  return app === clear ? "match" : "mismatch";
}

function compareDigits(appValue: string, clearValue: string): ComparisonStatus {
  const app = String(appValue ?? "").replace(/\D/g, "");
  const clear = String(clearValue ?? "").replace(/\D/g, "");
  if (!app && !clear) return "neutral";
  if (!app || !clear) return "neutral";
  // Allow last-4 matches when CLEAR returns truncated SSN.
  if (app.length === 9 && clear.length === 4) {
    return app.slice(-4) === clear ? "match" : "mismatch";
  }
  if (clear.length === 9 && app.length === 4) {
    return clear.slice(-4) === app ? "match" : "mismatch";
  }
  return app === clear ? "match" : "mismatch";
}

function resolveHitAddress(hit: {
  address1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  addressBlob?: string;
}) {
  if (hit.address1 && hit.city && hit.state && hit.zipCode) {
    return {
      address1: hit.address1,
      city: hit.city,
      state: normalizeStateCode(hit.state) || hit.state,
      zipCode: hit.zipCode,
    };
  }
  return parseUsAddressBlob(hit.addressBlob || "");
}

export function extractApplicationBusinessSnapshotForClear(
  applicationData: Record<string, unknown> | null | undefined,
): ApplicationBusinessSnapshot {
  const client = applicationData?.client as Record<string, unknown> | undefined;
  const business = client?.business as Record<string, unknown> | undefined;
  const address = business?.address as Record<string, unknown> | undefined;

  return {
    businessName: String(business?.name ?? client?.businessName ?? "").trim(),
    businessEinNumber: String(
      business?.einNumber ?? business?.businessEinNumber ?? client?.businessEinNumber ?? "",
    ).trim(),
    address1: String(address?.address1 ?? client?.businessAddress1 ?? "").trim(),
    city: String(address?.city ?? client?.businessCity ?? "").trim(),
    state: String(address?.state ?? client?.businessState ?? "").trim(),
    zipCode: String(address?.zipCode ?? client?.businessZipCode ?? "").trim(),
  };
}

export function extractApplicationOwnersForClear(
  applicationData: Record<string, unknown> | null | undefined,
): ApplicationOwnerSnapshot[] {
  const client = applicationData?.client as Record<string, unknown> | undefined;
  const owners = Array.isArray(client?.owners)
    ? (client?.owners as Record<string, unknown>[])
    : [];

  if (owners.length > 0) {
    return owners.map((owner) => {
      const address = (owner.address as Record<string, unknown> | undefined) ?? {};
      return {
        ownerId: String(owner.id ?? owner._id ?? "").trim() || undefined,
        firstName: String(owner.firstName ?? "").trim(),
        middleName: String(owner.middleName ?? "").trim(),
        lastName: String(owner.lastName ?? "").trim(),
        dateOfBirth: String(owner.dateOfBirth ?? "").trim(),
        ssn: String(owner.ssn ?? "").trim(),
        email: String(owner.email ?? "").trim(),
        mobileNumber: String(owner.mobileNumber ?? "").trim(),
        address1: String(address.address1 ?? owner.address1 ?? "").trim(),
        city: String(address.city ?? owner.city ?? "").trim(),
        state: String(address.state ?? owner.state ?? "").trim(),
        zipCode: String(address.zipCode ?? owner.zipCode ?? "").trim(),
      };
    });
  }

  const primary = (client?.owner as Record<string, unknown> | undefined) ?? {};
  if (!primary.firstName && !client?.ownerFirstName) return [];
  return [
    {
      ownerId: undefined,
      firstName: String(primary.firstName ?? client?.ownerFirstName ?? "").trim(),
      middleName: String(primary.middleName ?? client?.ownerMiddleName ?? "").trim(),
      lastName: String(primary.lastName ?? client?.ownerLastName ?? "").trim(),
      dateOfBirth: String(primary.dateOfBirth ?? client?.ownerDateOfBirth ?? "").trim(),
      ssn: String(primary.ssn ?? client?.ownerSsn ?? "").trim(),
      email: String(primary.email ?? client?.ownerEmail ?? "").trim(),
      mobileNumber: String(primary.mobileNumber ?? client?.ownerMobileNumber ?? "").trim(),
      address1: String(
        (primary.address as Record<string, unknown> | undefined)?.address1 ??
          client?.ownerAddress1 ??
          "",
      ).trim(),
      city: String(
        (primary.address as Record<string, unknown> | undefined)?.city ?? client?.ownerCity ?? "",
      ).trim(),
      state: String(
        (primary.address as Record<string, unknown> | undefined)?.state ??
          client?.ownerState ??
          "",
      ).trim(),
      zipCode: String(
        (primary.address as Record<string, unknown> | undefined)?.zipCode ??
          client?.ownerZipCode ??
          "",
      ).trim(),
    },
  ];
}

export function buildClearBusinessComparisonRows(
  hit: ClearBusinessHit,
  application: ApplicationBusinessSnapshot,
): ClearComparisonRow[] {
  const parsed = resolveHitAddress(hit);
  const clearAddress1 = parsed?.address1 || hit.address1 || "";
  const clearCity = parsed?.city || hit.city || "";
  const clearState = parsed?.state || hit.state || "";
  const clearZip = parsed?.zipCode || hit.zipCode || "";

  return [
    {
      key: "businessName",
      label: "Legal name",
      applicationValue: formatDisplay(application.businessName),
      clearValue: formatDisplay(hit.name),
      status: compareText(application.businessName, hit.name),
      syncField: "businessName",
    },
    {
      key: "businessEinNumber",
      label: "FEIN / EIN",
      applicationValue: formatDisplay(application.businessEinNumber),
      clearValue: formatDisplay(hit.fein),
      status: compareDigits(application.businessEinNumber, hit.fein),
      syncField: "businessEinNumber",
    },
    {
      key: "address",
      label: "Address",
      applicationValue: formatDisplay(
        [application.address1, application.city, application.state, application.zipCode]
          .filter(Boolean)
          .join(", "),
      ),
      clearValue: formatDisplay(
        [clearAddress1, clearCity, clearState, clearZip].filter(Boolean).join(", ") ||
          hit.addressBlob,
      ),
      status:
        clearAddress1 || clearCity || clearState || clearZip
          ? compareText(
              [application.address1, application.city, normalizeStateCode(application.state), application.zipCode]
                .filter(Boolean)
                .join(" "),
              [clearAddress1, clearCity, normalizeStateCode(clearState), clearZip]
                .filter(Boolean)
                .join(" "),
            )
          : "neutral",
      syncField: clearAddress1 && clearCity && clearState && clearZip ? "address1" : undefined,
    },
  ];
}

export function buildClearPersonComparisonRows(
  hit: ClearPersonHit,
  owner: ApplicationOwnerSnapshot,
): ClearComparisonRow[] {
  const parsed = resolveHitAddress(hit);
  const clearAddress1 = parsed?.address1 || hit.address1 || "";
  const clearCity = parsed?.city || hit.city || "";
  const clearState = parsed?.state || hit.state || "";
  const clearZip = parsed?.zipCode || hit.zipCode || "";

  return [
    {
      key: "firstName",
      label: "First name",
      applicationValue: formatDisplay(owner.firstName),
      clearValue: formatDisplay(hit.firstName),
      status: compareText(owner.firstName, hit.firstName),
      syncField: "firstName",
    },
    {
      key: "middleName",
      label: "Middle name",
      applicationValue: formatDisplay(owner.middleName),
      clearValue: formatDisplay(hit.middleName),
      status: compareText(owner.middleName, hit.middleName),
      syncField: "middleName",
    },
    {
      key: "lastName",
      label: "Last name",
      applicationValue: formatDisplay(owner.lastName),
      clearValue: formatDisplay(hit.lastName),
      status: compareText(owner.lastName, hit.lastName),
      syncField: "lastName",
    },
    {
      key: "dateOfBirth",
      label: "Date of birth",
      applicationValue: formatDisplay(normalizeIncorporationDate(owner.dateOfBirth) || owner.dateOfBirth),
      clearValue: formatDisplay(normalizeIncorporationDate(hit.dateOfBirth) || hit.dateOfBirth),
      status: compareDate(owner.dateOfBirth, hit.dateOfBirth),
      syncField: "dateOfBirth",
    },
    {
      key: "ssn",
      label: "SSN",
      applicationValue: formatDisplay(owner.ssn),
      clearValue: formatDisplay(hit.ssn),
      status: compareDigits(owner.ssn, hit.ssn),
      syncField: "ssn",
    },
    {
      key: "email",
      label: "Email",
      applicationValue: formatDisplay(owner.email),
      clearValue: formatDisplay(hit.email),
      status: compareText(owner.email, hit.email),
      syncField: "email",
    },
    {
      key: "mobileNumber",
      label: "Mobile",
      applicationValue: formatDisplay(owner.mobileNumber),
      clearValue: formatDisplay(hit.phoneNumber),
      status: compareDigits(owner.mobileNumber, hit.phoneNumber),
      syncField: "mobileNumber",
    },
    {
      key: "address",
      label: "Address",
      applicationValue: formatDisplay(
        [owner.address1, owner.city, owner.state, owner.zipCode].filter(Boolean).join(", "),
      ),
      clearValue: formatDisplay(
        [clearAddress1, clearCity, clearState, clearZip].filter(Boolean).join(", ") ||
          hit.addressBlob,
      ),
      status:
        clearAddress1 || clearCity || clearState || clearZip
          ? compareText(
              [owner.address1, owner.city, normalizeStateCode(owner.state), owner.zipCode]
                .filter(Boolean)
                .join(" "),
              [clearAddress1, clearCity, normalizeStateCode(clearState), clearZip]
                .filter(Boolean)
                .join(" "),
            )
          : "neutral",
      syncField: clearAddress1 && clearCity && clearState && clearZip ? "address1" : undefined,
    },
  ];
}

export function canSyncClearComparisonRow(row: ClearComparisonRow): boolean {
  if (!row.syncField) return false;
  if (!hasDisplayValue(row.clearValue)) return false;
  if (row.status === "match") return false;
  if (row.status === "mismatch") return true;
  return row.status === "neutral" && !hasDisplayValue(row.applicationValue);
}

export function syncFieldsForClearComparisonRow(
  row: ClearComparisonRow,
): Array<ClearBusinessSyncFieldKey | ClearPersonSyncFieldKey> {
  if (!canSyncClearComparisonRow(row) || !row.syncField) return [];
  if (row.syncField === "address1") {
    return ["address1", "city", "state", "zipCode"];
  }
  return [row.syncField];
}

export function syncFieldsFromClearComparisonRows(
  rows: ClearComparisonRow[],
): Array<ClearBusinessSyncFieldKey | ClearPersonSyncFieldKey> {
  const fields = new Set<ClearBusinessSyncFieldKey | ClearPersonSyncFieldKey>();
  for (const row of rows) {
    for (const field of syncFieldsForClearComparisonRow(row)) {
      fields.add(field);
    }
  }
  return Array.from(fields);
}

export function buildClearSyncConfirmationLines(rows: ClearComparisonRow[]): string[] {
  return rows
    .filter(canSyncClearComparisonRow)
    .map((row) => `${row.label}: "${row.applicationValue}" → "${row.clearValue}"`);
}
