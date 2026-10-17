import "server-only";
import type { Prisma } from "@prisma/client";
import type { PortfolioDto } from "@/features/portfolio/types";
import { accountAutomaticBalanceConflicts } from "./account-investments";

export async function accountInvestmentReviews(tx: Prisma.TransactionClient, userId: string): Promise<PortfolioDto["integrationReview"]> {
  const links = await tx.accountInvestmentLink.findMany({
    where: { enabled: true, status: "NEEDS_REVIEW", account: { userId, active: true, type: "BANK_ACCOUNT", balance: { gt: 0 } } },
    include: { account: true }, orderBy: { createdAt: "asc" },
  });
  return Promise.all(links.map(async (link) => ({
    id: link.id, source: "ACCOUNT_BALANCE" as const,
    investmentName: `Saldo da conta · ${link.account.name}`,
    institution: link.account.institutionName || link.account.name,
    providerType: "ACCOUNT_BALANCE", providerSubtype: null,
    balance: link.account.balance.toString(), currencyCode: link.account.currencyCode,
    code: null, isin: null, value: null, quantity: null, amount: null,
    taxes: null, taxes2: null, amountProfit: null, amountWithdrawal: null, amountOriginal: null,
    lastMonthRate: null, annualRate: null, lastTwelveMonthsRate: null,
    quotaDate: null, owner: null, number: null, institutionNumber: null, insurerName: null, insurerCnpj: null,
    issuer: null, issuerCnpj: null, rate: null, rateType: null, fixedAnnualRate: null,
    purchaseDate: null, dueDate: null, issueDate: null, gracePeriodDate: null, metadata: null,
    status: null, updatedAt: link.updatedAt.toISOString(), transactions: [],
    suggestedInstrumentType: "FIXED_INCOME" as const,
    suggestedInvestmentClass: link.account.currencyCode === "USD" ? "INTERNATIONAL_FIXED_INCOME" as const : "FIXED_INCOME" as const,
    suggestedMarketRegion: null, suggestedFamilyCode: null, suggestedIndexation: null,
    reviewReason: "Este é o mesmo dinheiro exibido em Saldo em conta. Não some os dois valores como patrimônios distintos. Confirme a classificação; não presumimos produto, remuneração nem cobertura FGC.",
    accountBalanceSource: {
      accountId: link.accountId, expectedUpdatedAt: link.updatedAt.toISOString(),
      automaticBalanceConflicts: (await accountAutomaticBalanceConflicts(tx, link.accountId)).map((entry) => entry.investment.name),
    },
  })));
}
