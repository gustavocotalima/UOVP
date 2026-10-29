import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { pendingPluggyQuantityChange } from "@/features/open-finance/investment-quantity-override";
import { pluggyQuantityChangeDto } from "@/features/open-finance/investment-quantity-change-dto";

function fixture() {
  return {
    link: {
      id: "link-a", status: "MAPPED", updatedAt: new Date("2026-10-14T12:00:00Z"),
      metadataOverrideFields: ["QUANTITY"], overrideQuantity: new Prisma.Decimal(110),
      overrideQuantityProviderQuantity: new Prisma.Decimal(0) as Prisma.Decimal | null,
      overrideQuantityAcknowledgedAt: new Date("2026-10-14T10:00:00Z") as Date | null,
    },
    investment: {
      source: "INVESTMENTS_API", providerAvailable: true, quantity: new Prisma.Decimal(120),
      item: { status: "UPDATED", disconnectedAt: null as Date | null, displayName: "Meu Inter" },
    },
    holding: { positionSource: "PLUGGY", productName: "ITUB3", ticker: "ITUB3", asset: { instrumentType: "STOCK" } },
  };
}

describe("avisos de mudanças na quantidade da instituição", () => {
  it("mostra quantidade anterior, atual e manual sem alterar a correção", () => {
    const f = fixture();
    expect(pluggyQuantityChangeDto(f)).toEqual({
      linkId: "link-a", expectedUpdatedAt: "2026-10-14T12:00:00.000Z", name: "ITUB3", ticker: "ITUB3",
      institution: "Meu Inter",
      previousProviderQuantity: "0", providerQuantity: "120", manualQuantity: "110",
    });
    expect(f.link.overrideQuantity.toString()).toBe("110");
  });

  it("não repete a mesma alteração reconhecida, mas avisa em uma mudança posterior", () => {
    const f = fixture();
    f.link.overrideQuantityProviderQuantity = new Prisma.Decimal(120);
    expect(pluggyQuantityChangeDto(f)).toBeNull();
    f.investment.quantity = new Prisma.Decimal(130);
    expect(pluggyQuantityChangeDto(f)?.providerQuantity).toBe("130");
  });

  it("também avisa quando o novo valor coincide com o manual", () => {
    const f = fixture();
    f.investment.quantity = new Prisma.Decimal(110);
    expect(pluggyQuantityChangeDto(f)?.providerQuantity).toBe("110");
  });

  it("compara decimais sem depender da escala e não confunde null com zero", () => {
    const f = fixture();
    expect(pendingPluggyQuantityChange(new Prisma.Decimal("0.0000000000"), f.link)).toBeNull();
    expect(pendingPluggyQuantityChange(null, f.link)?.providerQuantity).toBeNull();
    f.link.overrideQuantityProviderQuantity = null;
    expect(pendingPluggyQuantityChange(null, f.link)).toBeNull();
    expect(pendingPluggyQuantityChange(new Prisma.Decimal(0), f.link)?.previousProviderQuantity).toBeNull();
  });

  it("quantidade manual zero continua sendo revisável", () => {
    const f = fixture();
    f.link.overrideQuantity = new Prisma.Decimal(0);
    expect(pluggyQuantityChangeDto(f)?.manualQuantity).toBe("0");
  });

  it.each(["no-override", "uninitialized", "excluded", "unavailable", "disconnected"])("não avisa para %s", (state) => {
    const f = fixture();
    if (state === "no-override") f.link.metadataOverrideFields = [];
    if (state === "uninitialized") f.link.overrideQuantityAcknowledgedAt = null;
    if (state === "excluded") f.link.status = "EXCLUDED";
    if (state === "unavailable") f.investment.providerAvailable = false;
    if (state === "disconnected") f.investment.item.disconnectedAt = new Date();
    expect(pluggyQuantityChangeDto(f)).toBeNull();
  });
});
