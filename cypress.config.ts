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
