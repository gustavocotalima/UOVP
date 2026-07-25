import { describe, expect, it } from "vitest";
import { pluggyConnectErrorMessage } from "@/features/open-finance/pluggy-connect-error";

describe("erros do Pluggy Connect", () => {
  it("mantém uma mensagem legível do conector", () => {
    expect(pluggyConnectErrorMessage({ message: "Falha ao conectar." })).toBe("Falha ao conectar.");
    expect(pluggyConnectErrorMessage(null)).toBe("A Pluggy não concluiu a conexão.");
  });
});
