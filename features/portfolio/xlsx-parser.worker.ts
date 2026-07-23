/// <reference lib="webworker" />

import { readSheet } from "read-excel-file/web-worker";

const MAX_ROWS = 1_001;
const MAX_COLUMNS = 40;

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const rows = await readSheet(event.data);
    if (rows.length > MAX_ROWS) throw new Error("A planilha excede o limite de 1.000 linhas.");
    if (rows.some((row) => row.length > MAX_COLUMNS)) {
      throw new Error("A planilha excede o limite de 40 colunas.");
    }
    self.postMessage({ ok: true, rows });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível ler a planilha.",
    });
  }
};

export {};
