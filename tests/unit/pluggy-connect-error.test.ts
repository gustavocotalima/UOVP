import { describe, expect, it } from "vitest";
import {
  duplicatePluggyItemIds,
  pluggyConnectErrorMessage,
} from "@/features/open-finance/pluggy-connect-error";

describe("erros do Pluggy Connect", () => {
  it("extrai e deduplica os itens de uma conexão que já existe", () => {
    expect(duplicatePluggyItemIds({
      message: "There are other items with the same credentials",
      codeDescription: "ITEM_USER_ALREADY_EXISTS",
      data: {
        items: [
          "57fce539-d0bc-45d7-a01e-45b1d783765c",
          "57fce539-d0bc-45d7-a01e-45b1d783765c",
          "inválido",
        ],
      },
    })).toEqual(["57fce539-d0bc-45d7-a01e-45b1d783765c"]);
  });

  it("não recupera IDs de outros tipos de erro", () => {
    expect(duplicatePluggyItemIds({
      message: "item not found",
      data: { items: ["57fce539-d0bc-45d7-a01e-45b1d783765c"] },
    })).toEqual([]);
  });

  it("mantém uma mensagem legível do conector", () => {
    expect(pluggyConnectErrorMessage({ message: "Falha ao conectar." })).toBe("Falha ao conectar.");
    expect(pluggyConnectErrorMessage(null)).toBe("A Pluggy não concluiu a conexão.");
  });
});
