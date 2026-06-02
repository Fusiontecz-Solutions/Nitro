import type { Application, BankDetail, Client, ClientBankInfo } from "@prisma/client";
import prisma from "../config/prismaClient";
import { NotFoundError } from "../utils/errors";
import { decryptSensitiveField } from "../utils/fieldEncryption";

export type DecisionLogicBusinessOwner = {
  email: string;
  firstName: string;
  middleName: string;
  lastName: string;
  nameSuffix: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  mobile: string;
  ssn: string;
  dob: Date;
  driverLicenseID: string;
  driverLicenseState: string;
  bankAccounts: Array<{ id: number }>;
};

type ClientWithBankRows = Client & {
  ClientBankInfo: ClientBankInfo[];
  applications: Array<
    Pick<Application, "id" | "createdAt"> & {
      bankDetails: Array<Pick<BankDetail, "id" | "bankName" | "accountNumber" | "routingNumber" | "createdAt">>;
    }
  >;
};

type DecisionLogicBankRow = {
  bankName: string;
  accountNumber: string;
  routingNumber: string | null;
  createdAt: Date;
};

function resolvePreferredBankRows(client: ClientWithBankRows): DecisionLogicBankRow[] {
  const appRows = [...(client.applications ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  // Prefer the newest application's BankDetail rows (same source used by Eligibility Analysis UI).
  for (const app of appRows) {
    const details = [...(app.bankDetails ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    if (details.length) {
      return details.map((d) => ({
        bankName: String(d.bankName ?? ""),
        accountNumber: String(
          decryptSensitiveField(d.accountNumber ?? undefined) ?? d.accountNumber ?? "",
        ),
        routingNumber:
          decryptSensitiveField(d.routingNumber ?? undefined) ?? d.routingNumber ?? null,
        createdAt: d.createdAt,
      }));
    }
  }

  // Backward compatibility for tenants still using ClientBankInfo.
  const legacyRows = [...(client.ClientBankInfo ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  return legacyRows.map((row) => ({
    bankName: String(row.bankName ?? ""),
    accountNumber: String(row.accountNumber ?? ""),
    routingNumber: row.routingNumber ?? null,
    createdAt: row.createdAt,
  }));
}

function mapClientToDecisionLogicOwner(
  client: ClientWithBankRows
): DecisionLogicBusinessOwner {
  const banks = resolvePreferredBankRows(client);
  return {
    // email: client.ownerEmail ?? "",
    email: client.ownerEmail || client.businessEmail || '', 
    firstName: client.ownerFirstName,
    middleName: client.ownerMiddleName ?? "",
    lastName: client.ownerLastName,
    nameSuffix: "",
    address1: client.ownerAddress1 ?? "",
    city: client.ownerCity ?? "",
    state: client.ownerState ?? "",
    zip: client.ownerZipCode ?? "",
    mobile: client.ownerMobileNumber ?? "",
    ssn: client.ownerSsn ?? "",
    dob: client.ownerDateOfBirth ?? new Date(0),
    driverLicenseID: "",
    driverLicenseState: "",
    bankAccounts: banks.map((_b, index) => ({ id: index + 1 })),
  };
}

export const clientService = {
  async fetchBusinessOwner(
    businessOwnerId: number
  ): Promise<DecisionLogicBusinessOwner> {
    const client = await prisma.client.findUnique({
      where: { clientId: businessOwnerId },
      include: {
        ClientBankInfo: true,
        applications: {
          select: {
            id: true,
            createdAt: true,
            bankDetails: {
              select: {
                id: true,
                bankName: true,
                accountNumber: true,
                routingNumber: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!client) {
      throw new NotFoundError("Client not found for the given business owner id.");
    }
    return mapClientToDecisionLogicOwner(client as ClientWithBankRows);
  },

  async fetchBankAccount(
    bankAccountId: number,
    businessOwnerId: number
  ) {
    const client = await prisma.client.findUnique({
      where: { clientId: businessOwnerId },
      include: {
        ClientBankInfo: true,
        applications: {
          select: {
            id: true,
            createdAt: true,
            bankDetails: {
              select: {
                id: true,
                bankName: true,
                accountNumber: true,
                routingNumber: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!client) {
      throw new NotFoundError("Client not found for the given business owner id.");
    }
    const c = client as ClientWithBankRows;
    const banks = resolvePreferredBankRows(c);
    const row = banks[bankAccountId - 1];
    if (!row) {
      throw new NotFoundError("Bank account not found for the given id.");
    }
    return {
      id: bankAccountId,
      bankName: row.bankName,
      accountNumber: row.accountNumber,
      routingNumber: row.routingNumber,
    };
  },
};
