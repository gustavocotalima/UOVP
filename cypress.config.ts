import { defineConfig } from "cypress";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "redis";

async function clearCypressMarketMetadataCache(provider: "BRAPI" | "YAHOO", symbol: string) {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;
  const digest = createHash("sha256")
    .update(JSON.stringify([provider, symbol]))
    .digest("base64url")
    .slice(0, 32);
  const namespace = process.env.SHARED_CACHE_NAMESPACE?.trim() || "uovp:shared:v1";
  const client = createClient({ url: redisUrl });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.del(`${namespace}:market:metadata:v2:${digest}`);
  } catch {
    // Redis is optional; PostgreSQL remains sufficient for this browser test.
  } finally {
    if (client.isOpen) await client.quit().catch(() => undefined);
  }
}

async function cleanupCypressUsers() {
  const prisma = new PrismaClient();
  try {
    await prisma.authRateLimit.deleteMany({
      where: {
        scope: {
          in: ["register-global", "register-ip", "login-global", "login-ip"],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          {
            email: {
              startsWith: "cypress-",
              endsWith: "@example.com",
            },
          },
          { email: "cypress-invite-admin@example.com" },
        ],
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    viewportWidth: 1440,
    viewportHeight: 900,
    video: false,
    setupNodeEvents(on) {
      on("before:run", cleanupCypressUsers);
      on("after:run", cleanupCypressUsers);
      on("task", {
        async createRegistrationInvite({ email }: { email: string }) {
          const prisma = new PrismaClient();
          try {
            const admin = await prisma.user.upsert({
              where: { email: "cypress-invite-admin@example.com" },
              update: {},
              create: { email: "cypress-invite-admin@example.com", name: "Admin Cypress" },
            });
            const token = randomBytes(32).toString("base64url");
            await prisma.registrationInvite.create({
              data: {
                email: email.trim().toLowerCase(),
                tokenHash: createHash("sha256").update(token).digest("base64url"),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
                createdByUserId: admin.id,
              },
            });
            return token;
          } finally {
            await prisma.$disconnect();
          }
        },
        async seedDailyExpenses({ email }: { email: string }) {
          if (!/^cypress-[^@]+@example\.com$/.test(email)) throw new Error("Only Cypress users may be seeded");
          const prisma = new PrismaClient();
          try {
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const account = await prisma.financialAccount.create({
              data: { userId: user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta calendário", currencyCode: "BRL", balance: 1220.78, balanceBrl: 1220.78 },
            });
            const common = {
              userId: user.id,
              accountId: account.id,
              source: "MANUAL" as const,
              kind: "EXPENSE" as const,
              currencyCode: "BRL",
              date: new Date("2026-09-08T12:00:00Z"),
              referenceYear: 2026,
              referenceMonth: 9,
            };
            await prisma.financeTransaction.createMany({ data: [
              { ...common, description: "Despesa do dia", amount: -635.15, reportingAmountBrl: -635.15 },
              { ...common, description: "Dividendo", kind: "INCOME", amount: 540.60, reportingAmountBrl: 540.60, budgetCategory: "FINANCIAL_FREEDOM" },
              { ...common, description: "Reinvestimento", amount: -540.60, reportingAmountBrl: -540.60, budgetCategory: "FINANCIAL_FREEDOM" },
              { ...common, description: "Parcela fora do mês", amount: -44.25, reportingAmountBrl: -44.25, date: new Date("2026-08-15T12:00:00Z"), installmentNumber: 2, installmentTotal: 3 },
              { ...common, description: "Oculta do relatório", amount: -100, reportingAmountBrl: -100, ignored: true },
              { ...common, description: "Transferência interna", amount: -200, reportingAmountBrl: -200, internalTransfer: true },
              { ...common, description: "Entrada disponível", kind: "INCOME", amount: 20.46, reportingAmountBrl: 20.46 },
            ] });
            return null;
          } finally {
            await prisma.$disconnect();
          }
        },
        async seedFinanceClassification({ email }: { email: string }) {
          const prisma = new PrismaClient();
          try {
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const now = new Date();
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
            const account = await prisma.financialAccount.create({
              data: {
                userId: user.id,
                source: "PLUGGY",
                externalId: `cypress-account-${suffix}`,
                type: "BANK_ACCOUNT",
                name: "Conta Pluggy Cypress",
                institutionName: "Banco Cypress",
              },
            });
            const foodTag = await prisma.financeTag.findFirstOrThrow({
              where: { userId: user.id, systemKey: "FOOD" },
            });
            const common = {
              userId: user.id,
              accountId: account.id,
              source: "PLUGGY" as const,
              kind: "EXPENSE" as const,
              currencyCode: "BRL",
              date: now,
              referenceYear: now.getFullYear(),
              referenceMonth: now.getMonth() + 1,
            };
            await prisma.financeTransaction.create({
              data: {
                ...common,
                externalId: `cypress-grocery-${suffix}`,
                description: "Mercado classificado",
                merchantName: "Mercado Cypress",
                providerCategory: "Groceries",
                providerCategoryId: "groceries",
                amount: -125,
                budgetCategory: "FIXED_COSTS",
                budgetCategorySource: "PROVIDER_DEFAULT",
                tagAssignmentSource: "PROVIDER_DEFAULT",
                classifiedAt: now,
                tags: { create: { tagId: foodTag.id, source: "PROVIDER_DEFAULT" } },
              },
            });
            await prisma.financeTransaction.create({
              data: {
                ...common,
                externalId: `cypress-pix-${suffix}`,
                description: "PIX sem classificação",
                counterpartyName: "Pessoa terceira",
                providerCategory: "Transfer - PIX",
                providerCategoryId: "transfer-pix",
                paymentMethod: "PIX",
                amount: -50,
                classifiedAt: now,
              },
            });
            const previousPeriod = new Date(
              now.getFullYear(),
              now.getMonth() - 1,
              15,
              12,
            );
            await prisma.financeTransaction.create({
              data: {
                ...common,
                externalId: `cypress-pix-previous-${suffix}`,
                description: "PIX sem classificação do mês anterior",
                counterpartyName: "Pessoa terceira anterior",
                providerCategory: "Transfer - PIX",
                providerCategoryId: "transfer-pix",
                paymentMethod: "PIX",
                amount: -75,
                date: previousPeriod,
                referenceYear: previousPeriod.getFullYear(),
                referenceMonth: previousPeriod.getMonth() + 1,
                classifiedAt: now,
              },
            });
            await prisma.financeTransaction.create({
              data: {
                ...common,
                externalId: `cypress-internal-${suffix}`,
                description: "PIX entre minhas contas",
                counterpartyName: "Usuário Cypress",
                providerCategory: "Same person transfer - PIX",
                providerCategoryId: "same-person-pix",
                paymentMethod: "PIX",
                amount: -200,
                internalTransfer: true,
                internalTransferSource: "PROVIDER_DEFAULT",
                classifiedAt: now,
              },
            });
            for (const [index, description] of ["Loja semelhante A", "Loja semelhante B"].entries()) {
              await prisma.financeTransaction.create({
                data: {
                  ...common,
                  externalId: `cypress-similar-${index}-${suffix}`,
                  description,
                  merchantName: "Loja Cypress",
                  merchantBusinessName: "Loja Cypress S.A.",
                  merchantCnpj: "12.345.678/0001-90",
                  providerCategory: "Shopping",
                  providerCategoryId: "shopping",
                  amount: -(70 + index * 10),
                  budgetCategory: "COMFORT",
                  budgetCategorySource: "PROVIDER_DEFAULT",
                  classifiedAt: now,
                },
              });
            }
            return null;
          } finally {
            await prisma.$disconnect();
          }
        },
        async seedBrokenMarketLogo({ email }: { email: string }) {
          const prisma = new PrismaClient();
          try {
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const portfolio = await prisma.portfolio.upsert({
              where: { userId: user.id },
              update: {},
              create: { userId: user.id },
            });
            const asset = await prisma.asset.upsert({
              where: {
                portfolioId_investmentClass_ticker: {
                  portfolioId: portfolio.id,
                  investmentClass: "BRAZILIAN_STOCKS",
                  ticker: "EMBJ3",
                },
              },
              update: { instrumentType: "STOCK", name: "Embraer S.A.", score: 5 },
              create: {
                portfolioId: portfolio.id,
                investmentClass: "BRAZILIAN_STOCKS",
                instrumentType: "STOCK",
                ticker: "EMBJ3",
                name: "Embraer S.A.",
                score: 5,
              },
            });
            await prisma.assetHolding.deleteMany({ where: { assetId: asset.id } });
            await prisma.assetHolding.create({
              data: {
                assetId: asset.id,
                issuer: "Embraer S.A.",
                productName: "Embraer S.A.",
                pricingSource: "BRAPI",
                ticker: "EMBJ3",
                currency: "BRL",
                quantity: 1,
                unitPrice: 80,
                investedValue: 80,
                logoUrl: "https://icons.brapi.dev/icons/EMBJ3.svg",
              },
            });
            await prisma.marketAssetMetadata.deleteMany({
              where: { provider: "BRAPI", symbol: "EMBJ3" },
            });
            await clearCypressMarketMetadataCache("BRAPI", "EMBJ3");
            return null;
          } finally {
            await prisma.$disconnect();
          }
        },
        async seedBinanceWallet({ email }: { email: string }) {
          const prisma = new PrismaClient();
          try {
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const portfolio = await prisma.portfolio.upsert({
              where: { userId: user.id },
              update: {},
              create: { userId: user.id },
            });
            const asset = await prisma.asset.upsert({
              where: {
                portfolioId_investmentClass_ticker: {
                  portfolioId: portfolio.id,
                  investmentClass: "CRYPTO",
                  ticker: "ADA",
                },
              },
              update: { name: "Cardano", instrumentType: "CRYPTO", score: 5 },
              create: {
                portfolioId: portfolio.id,
                investmentClass: "CRYPTO",
                instrumentType: "CRYPTO",
                ticker: "ADA",
                name: "Cardano",
                score: 5,
              },
            });
            await prisma.assetHolding.deleteMany({ where: { assetId: asset.id } });
            const holding = await prisma.assetHolding.create({
              data: {
                assetId: asset.id,
                issuer: "Binance",
                productName: "ADA · Binance",
                pricingSource: "BINANCE",
                positionSource: "BINANCE",
                ticker: "ADA",
                providerSymbol: "ADAUSDT",
                marketExchange: "BINANCE",
                marketQuoteType: "SPOT",
                currency: "USDT",
                quantity: "10.5",
                unitPrice: "0.5",
                fxRateToBrl: "5",
                includedInTotals: true,
                fractional: true,
                priceUpdatedAt: new Date(),
              },
            });
            await prisma.binanceConnection.deleteMany({ where: { userId: user.id } });
            const connection = await prisma.binanceConnection.create({
              data: {
                userId: user.id,
                apiKeyCiphertext: "test-encrypted-key",
                apiKeyLastFour: "ABCD",
                apiSecretCiphertext: "test-encrypted-secret",
                status: "CONNECTED",
                ipRestricted: true,
                readEnabled: true,
                lastSyncAt: new Date(),
                syncPending: false,
              },
            });
            await prisma.binanceWalletAsset.createMany({
              data: [
                { connectionId: connection.id, symbol: "ADA", status: "TRACKED", spotQuantity: "10.5", holdingId: holding.id, lastSeenAt: new Date(), lastSyncAt: new Date() },
                { connectionId: connection.id, symbol: "BTC", status: "NEEDS_REVIEW", spotQuantity: "0.01", lastSeenAt: new Date(), lastSyncAt: new Date() },
                { connectionId: connection.id, symbol: "ETH", status: "AVAILABLE", earnFlexibleQuantity: "0.2", valuationSupported: false, valuationError: "Sem cotação suportada pela Binance.", lastSeenAt: new Date(), lastSyncAt: new Date() },
                { connectionId: connection.id, symbol: "BNB", status: "IGNORED", fundingQuantity: "1.5", valuationSupported: true, valuationMethod: "DIRECT", lastSeenAt: new Date(), lastSyncAt: new Date() },
              ],
            });
            return null;
          } finally {
            await prisma.$disconnect();
          }
        },
        async seedPluggyReservedBalance({ email }: { email: string }) {
          const prisma = new PrismaClient();
          try {
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
            const item = await prisma.pluggyItem.create({
              data: {
                userId: user.id,
                pluggyItemId: `cypress-reserved-item-${suffix}`,
                connectorName: "Mercado Pago",
                institutionName: "Mercado Pago",
                status: "UPDATED",
                syncPending: false,
                lastSyncAt: new Date(),
              },
            });
            const account = await prisma.pluggyAccount.create({
              data: {
                pluggyItemDbId: item.id,
                pluggyAccountId: `cypress-reserved-account-${suffix}`,
                type: "BANK",
                subtype: "PAYMENT_ACCOUNT",
                name: "Conta Mercado Pago",
                marketingName: "Mercado Pago",
                balance: 25,
                currencyCode: "BRL",
              },
            });
            const investment = await prisma.pluggyInvestment.create({
              data: {
                pluggyItemDbId: item.id,
                pluggyInvestmentId: `cypress-reserved-investment-${suffix}`,
                source: "ACCOUNT_RESERVED_BALANCE",
                pluggyAccountDbId: account.id,
                providerReference: `cypress-reserved-${suffix}`,
                name: "Reserva de emergência",
                type: "FIXED_INCOME",
                subtype: "RESERVED_BALANCE",
                balance: 250,
                amountWithdrawal: 250,
                currencyCode: "BRL",
                rateType: "CDI",
                status: "ACTIVE",
                providerAvailable: true,
              },
            });
            await prisma.pluggyInvestmentDiagramLink.create({
              data: {
                userId: user.id,
                pluggyInvestmentDbId: investment.id,
                status: "NEEDS_REVIEW",
                suggestedInstrumentType: "FIXED_INCOME",
                suggestedInvestmentClass: "FIXED_INCOME",
                suggestedIndexation: "POST_FIXED",
                reviewReason: "Confirme o grupo e a indexação deste saldo reservado antes de incluí-lo na carteira.",
                lastReconciledAt: new Date(),
              },
            });
            return null;
          } finally {
            await prisma.$disconnect();
          }
        },
        async seedPluggyEditableInvestment({ email }: { email: string }) {
          if (!/^cypress-[^@]+@example\.com$/.test(email)) throw new Error("Only Cypress users may be seeded");
          const prisma = new PrismaClient();
          try {
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const portfolio = await prisma.portfolio.upsert({
              where: { userId: user.id },
              update: {},
              create: { userId: user.id },
            });
            await prisma.fixedIncomeFamily.upsert({
              where: { code: "BANK_DEPOSITS_FGC" },
              update: {},
              create: {
                code: "BANK_DEPOSITS_FGC",
                name: "Depósitos bancários com FGC",
                shortCode: "CDB/RDB/LC",
                sortOrder: 10,
              },
            });
            await prisma.assetCatalogItem.upsert({
              where: { id: 5 },
              update: {},
              create: {
                id: 5,
                category: "Renda fixa",
                name: "CDB",
                summary: "Certificado de depósito bancário.",
                taxPF: "Conforme legislação vigente.",
                taxPJ: "Conforme legislação vigente.",
                howToBuy: "Instituição financeira.",
                costs: "Conforme instituição.",
                risks: "Risco de crédito.",
                guarantees: "Conforme elegibilidade ao FGC.",
                familyCode: "BANK_DEPOSITS_FGC",
              },
            });
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
            const item = await prisma.pluggyItem.create({
              data: {
                userId: user.id,
                pluggyItemId: `cypress-metadata-item-${suffix}`,
                connectorName: "Banco Inter",
                institutionName: "Inter",
                status: "UPDATED",
                syncPending: false,
                lastSyncAt: new Date(),
              },
            });
            const investment = await prisma.pluggyInvestment.create({
              data: {
                pluggyItemDbId: item.id,
                pluggyInvestmentId: `cypress-metadata-investment-${suffix}`,
                name: "CDB ORIGINAL CYPRESS",
                issuer: "BANCO ORIGINAL CYPRESS S.A.",
                issuerCnpj: "00.000.000/0001-00",
                type: "FIXED_INCOME",
                subtype: "CDB",
                balance: 1_000,
                amount: 950,
                quantity: 1,
                value: 1_000,
                currencyCode: "BRL",
                rate: 0,
                rateType: "CDI",
                fixedAnnualRate: 8.95,
                purchaseDate: new Date("2026-06-15T12:00:00.000Z"),
                dueDate: new Date("2027-08-24T12:00:00.000Z"),
                status: "ACTIVE",
                providerAvailable: true,
              },
            });
            const asset = await prisma.asset.create({
              data: {
                portfolioId: portfolio.id,
                investmentClass: "FIXED_INCOME",
                instrumentType: "FIXED_INCOME",
                ticker: `CYP-META-${suffix}`,
                name: "Depósitos bancários com FGC · Pós-fixado",
                fixedIncomeFamilyCode: "BANK_DEPOSITS_FGC",
                indexation: "POST_FIXED",
                score: 5,
              },
            });
            const holding = await prisma.assetHolding.create({
              data: {
                assetId: asset.id,
                catalogItemId: 5,
                issuer: "BANCO ORIGINAL CYPRESS S.A.",
                productName: "CDB ORIGINAL CYPRESS",
                pricingSource: "PLUGGY",
                positionSource: "PLUGGY",
                currency: "BRL",
                quantity: 1,
                unitPrice: 1_000,
                investedValue: 950,
                currentValue: 1_000,
                providerCurrentValue: 1_000,
                rateConvention: "PERCENT_OF_INDEXER",
                benchmark: "CDI",
                rateValue: 100,
                purchaseDate: new Date("2026-06-15T12:00:00.000Z"),
                maturityDate: new Date("2027-08-24T12:00:00.000Z"),
              },
            });
            await prisma.pluggyInvestmentDiagramLink.create({
              data: {
                userId: user.id,
                pluggyInvestmentDbId: investment.id,
                assetHoldingId: holding.id,
                status: "MAPPED",
                lastReconciledAt: new Date(),
              },
            });
            return null;
          } finally {
            await prisma.$disconnect();
          }
        },
        async getMarketLogoMetadata({
          provider,
          symbol,
        }: {
          provider: "BRAPI" | "YAHOO";
          symbol: string;
        }) {
          const prisma = new PrismaClient();
          try {
            return await prisma.marketAssetMetadata.findUnique({
              where: { provider_symbol: { provider, symbol } },
              select: { status: true, logoUrl: true, source: true },
            });
          } finally {
            await prisma.$disconnect();
          }
        },
      });
    },
  },
  screenshotsFolder: "cypress/screenshots",
  videosFolder: "cypress/videos",
});
