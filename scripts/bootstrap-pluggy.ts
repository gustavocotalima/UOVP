import { prisma } from "../lib/prisma";
import { bootstrapLegacyPluggyItem, syncPluggyItemForUser } from "../features/open-finance/sync";

async function main() {
  const email = process.env.PLUGGY_BOOTSTRAP_USER_EMAIL?.trim().toLowerCase();
  const itemIds = (process.env.PLUGGY_BOOTSTRAP_ITEM_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const institutionNames = (process.env.PLUGGY_BOOTSTRAP_INSTITUTION_NAMES ?? "")
    .split(",")
    .map((value) => value.trim());
  if (!email || !itemIds.length) {
    throw new Error("Configure PLUGGY_BOOTSTRAP_USER_EMAIL e PLUGGY_BOOTSTRAP_ITEM_IDS para executar este script.");
  }
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error("Usuário não encontrado.");

  for (const [index, itemId] of itemIds.entries()) {
    const item = await bootstrapLegacyPluggyItem(user.id, itemId);
    if (institutionNames[index]) {
      await prisma.pluggyItem.update({
        where: { id: item.id },
        data: { institutionName: institutionNames[index] },
      });
    }
    const result = await syncPluggyItemForUser(user.id, itemId);
    console.log(
      `${institutionNames[index] || item.connectorName}: ${result.accountCount} conta(s), ${result.transactionCount} transação(ões), ${result.investmentCount} investimento(s).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Falha desconhecida.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
