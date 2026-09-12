import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { PluggyAccountResponse } from "./pluggy";

export type AccountInvestmentSource =
  | "ACCOUNT_RESERVED_BALANCE"
  | "ACCOUNT_AUTOMATIC_BALANCE";

export type AccountInvestmentSnapshot = {
  source: AccountInvestmentSource;
  pluggyInvestmentId: string;
  providerReference: string;
  name: string;
  balance: string;
  currencyCode: string;
  rateType: string | null;
  providerCreatedAt: string | null;
  providerUpdatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type AccountInvestmentExtraction = {
  managed: boolean;
  complete: boolean;
  mode: "DETAILED" | "AUTOMATIC" | "EMPTY" | "UNAVAILABLE";
  snapshots: AccountInvestmentSnapshot[];
};

function decimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function currency(value: string | null | undefined, fallback: string | null | undefined) {
  return (value?.trim() || fallback?.trim() || "BRL").toUpperCase();
}

function normalizedName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function stableReference(
  accountId: string,
  source: AccountInvestmentSource,
  identity: string,
  currencyCode: string,
) {
  return createHash("sha256")
    .update(source)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(identity)
    .update("\0")
    .update(currencyCode)
    .digest("hex");
}

function snapshotId(source: AccountInvestmentSource, providerReference: string) {
  return `uovp:${source.toLowerCase()}:${providerReference}`;
}

export function extractAccountInvestmentSnapshots(
  account: PluggyAccountResponse,
): AccountInvestmentExtraction {
  const bankData = account.bankData;
  if (!bankData) {
    return { managed: false, complete: true, mode: "UNAVAILABLE", snapshots: [] };
  }

  const detailedProvided = Array.isArray(bankData.reservedBalances);
  const automaticProvided = bankData.automaticallyInvestedBalance !== null
    && bankData.automaticallyInvestedBalance !== undefined;
  const declaresReservedBalances = bankData.hasReservedBalance === true;

  if (detailedProvided && bankData.reservedBalances!.length > 0) {
    let complete = true;
    const snapshots: AccountInvestmentSnapshot[] = [];

    bankData.reservedBalances!.forEach((reservedBalance) => {
      const amounts = reservedBalance.availableAmounts;
      if (!Array.isArray(amounts) || amounts.length === 0) {
        complete = false;
        return;
      }

      const identity = reservedBalance.identification === null
        || reservedBalance.identification === undefined
        || String(reservedBalance.identification).trim() === ""
        ? `name:${normalizedName(reservedBalance.name)}`
        : `id:${String(reservedBalance.identification).trim()}`;
      const grouped = new Map<string, {
        amount: Decimal;
        remunerations: Array<Record<string, unknown>>;
      }>();

      for (const availableAmount of amounts) {
        const amount = decimal(availableAmount.amount);
        if (!amount) {
          complete = false;
          continue;
        }
        const currencyCode = currency(availableAmount.currencyCode, account.currencyCode);
        const current = grouped.get(currencyCode) ?? {
          amount: new Decimal(0),
          remunerations: [],
        };
        current.amount = current.amount.add(amount);
        if (availableAmount.remuneration) {
          current.remunerations.push(
            JSON.parse(JSON.stringify(availableAmount.remuneration)) as Record<string, unknown>,
          );
        }
        grouped.set(currencyCode, current);
      }

      for (const [currencyCode, groupedAmount] of grouped) {
        const providerReference = stableReference(
          account.id,
          "ACCOUNT_RESERVED_BALANCE",
          identity,
          currencyCode,
        );
        const indexers = [...new Set(groupedAmount.remunerations.flatMap((remuneration) => {
          const indexer = remuneration.indexer;
          return typeof indexer === "string" && indexer.trim()
            ? [indexer.trim().toUpperCase()]
            : [];
        }))];

        snapshots.push({
          source: "ACCOUNT_RESERVED_BALANCE",
          pluggyInvestmentId: snapshotId("ACCOUNT_RESERVED_BALANCE", providerReference),
          providerReference,
          name: reservedBalance.name,
          balance: groupedAmount.amount.toString(),
          currencyCode,
          rateType: indexers.length === 1 ? indexers[0]! : null,
          providerCreatedAt: account.createdAt ?? null,
          providerUpdatedAt: account.updatedAt ?? null,
          metadata: {
            origin: "ACCOUNT_RESERVED_BALANCE",
            accountName: account.marketingName ?? account.name,
            remuneration: groupedAmount.remunerations.length <= 1
              ? groupedAmount.remunerations[0] ?? null
              : { entries: groupedAmount.remunerations },
          },
        });
      }
    });

    return {
      managed: true,
      complete,
      mode: "DETAILED",
      snapshots,
    };
  }

  if (automaticProvided) {
    const amount = decimal(bankData.automaticallyInvestedBalance);
    if (!amount) {
      return {
        managed: true,
        complete: false,
        mode: "UNAVAILABLE",
        snapshots: [],
      };
    }
    if (amount.lte(0)) {
      return { managed: true, complete: true, mode: "EMPTY", snapshots: [] };
    }
    const currencyCode = currency(account.currencyCode, "BRL");
    const providerReference = stableReference(
      account.id,
      "ACCOUNT_AUTOMATIC_BALANCE",
      "automatic",
      currencyCode,
    );
    return {
      managed: true,
      complete: true,
      mode: "AUTOMATIC",
      snapshots: [{
        source: "ACCOUNT_AUTOMATIC_BALANCE",
        pluggyInvestmentId: snapshotId("ACCOUNT_AUTOMATIC_BALANCE", providerReference),
        providerReference,
        name: "Saldo investido automaticamente",
        balance: amount.toString(),
        currencyCode,
        rateType: null,
        providerCreatedAt: account.createdAt ?? null,
        providerUpdatedAt: account.updatedAt ?? null,
        metadata: {
          origin: "ACCOUNT_AUTOMATIC_BALANCE",
          accountName: account.marketingName ?? account.name,
        },
      }],
    };
  }

  if (
    bankData.hasReservedBalance === false
    || (detailedProvided && bankData.reservedBalances!.length === 0 && !declaresReservedBalances)
  ) {
    return { managed: true, complete: true, mode: "EMPTY", snapshots: [] };
  }

  if (declaresReservedBalances || detailedProvided) {
    return { managed: true, complete: false, mode: "UNAVAILABLE", snapshots: [] };
  }

  return { managed: false, complete: true, mode: "UNAVAILABLE", snapshots: [] };
}
