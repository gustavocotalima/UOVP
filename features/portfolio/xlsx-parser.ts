const MAX_WORKBOOK_BYTES = 2 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 8_000;

type WorkerResult =
  | { ok: true; rows: unknown[][] }
  | { ok: false; error: string };

export async function parseXlsxFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Selecione uma planilha no formato .xlsx.");
  }
  if (file.size < 1 || file.size > MAX_WORKBOOK_BYTES) {
    throw new Error("A planilha precisa ter no máximo 2 MB.");
  }

  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("./xlsx-parser.worker.ts", import.meta.url), { type: "module" });

  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const finish = () => worker.terminate();
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error("A leitura da planilha excedeu o limite de tempo."));
    }, WORKER_TIMEOUT_MS);

    worker.onerror = () => {
      window.clearTimeout(timeout);
      finish();
      reject(new Error("Não foi possível processar a planilha com segurança."));
    };
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      window.clearTimeout(timeout);
      finish();
      if (!event.data.ok) {
        reject(new Error(event.data.error));
        return;
      }

      const [headerRow = [], ...dataRows] = event.data.rows;
      const headers = headerRow.map((value) => String(value ?? "").trim());
      if (!headers.some(Boolean)) {
        reject(new Error("A planilha não possui cabeçalhos."));
        return;
      }
      const rows = dataRows
        .filter((row) => row.some((value) => value !== null && value !== undefined && value !== ""))
        .map((row) => Object.fromEntries(
          headers.flatMap((header, index) => header ? [[header, row[index] ?? null] as const] : []),
        ));
      resolve(rows);
    };

    worker.postMessage(buffer, [buffer]);
  });
}
