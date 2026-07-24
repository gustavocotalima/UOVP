import { defineConfig } from "cypress";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    viewportWidth: 1440,
    viewportHeight: 900,
    video: false,
    setupNodeEvents(on) {
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
      });
    },
  },
  screenshotsFolder: "cypress/screenshots",
  videosFolder: "cypress/videos",
});
