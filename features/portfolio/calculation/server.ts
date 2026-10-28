import "server-only";
import { Worker } from "node:worker_threads";
import { allocateCerrado } from "./cerrado";
import { improvedCalculation } from "./improved";
import { balancePurchases, type BalanceModel, type BalanceSolution } from "./balanced-search";
import type { AllocationInput, AllocationMethod } from "./types";
import { AllocationAdmission } from "./admission";

type Pool = { running: number; waiting: Array<() => void>; admission: AllocationAdmission };
const allocationGlobal = globalThis as unknown as { allocationPoolV1?: Pool };
const pool = allocationGlobal.allocationPoolV1 ??= { running: 0, waiting: [], admission: new AllocationAdmission() };
async function solve(model: BalanceModel): Promise<BalanceSolution> {
  if (pool.waiting.length >= 16) throw new Error("Há muitos cálculos em andamento. Tente novamente em instantes.");
  if (pool.running >= 2) await new Promise<void>((resolve) => pool.waiting.push(resolve));
  else pool.running++;
  try {
    return await new Promise<BalanceSolution>((resolve, reject) => {
      const worker = new Worker(`const {parentPort, workerData}=require('node:worker_threads');
        const __name=(f)=>f; const search=(${balancePurchases.toString()});
        try { parentPort.postMessage({result:search(workerData)}); }
        catch(e) { parentPort.postMessage({error:e.message}); }`, {
        eval: true, workerData: model, resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error("O cálculo excedeu o tempo máximo. Tente novamente.")); }, model.timeLimitMs + 3000);
      worker.once("message", (message: { result?: BalanceSolution; error?: string }) => {
        clearTimeout(timer); void worker.terminate();
        if (message.result) resolve(message.result); else reject(new Error(message.error ?? "Falha no cálculo."));
      });
      worker.once("error", (error) => { clearTimeout(timer); reject(error); });
      worker.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new Error("O processo de cálculo foi encerrado.")); });
    });
  } finally { const next = pool.waiting.shift(); if (next) next(); else pool.running--; }
}

export function calculateContribution(input: AllocationInput, algorithm: AllocationMethod, userId: string) {
  return pool.admission.run(userId, async () => {
    if (algorithm === "CERRADO") return allocateCerrado(input);
    const calculation = improvedCalculation(input);
    let step = calculation.next();
    while (!step.done) step = calculation.next(await solve(step.value));
    return step.value;
  });
}
