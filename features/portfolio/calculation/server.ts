import "server-only";
import { Worker } from "node:worker_threads";
import { allocateCerrado } from "./cerrado";
import { improvedCalculation } from "./improved";
import { searchIntegers, type IntegerModel, type IntegerSolution } from "./integer-search";
import type { AllocationInput, AllocationMethod } from "./types";

let running = 0;
const waiting: Array<() => void> = [];
async function solve(model: IntegerModel): Promise<IntegerSolution> {
  if (waiting.length >= 16) throw new Error("Há muitos cálculos em andamento. Tente novamente em instantes.");
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await new Promise<IntegerSolution>((resolve, reject) => {
      const worker = new Worker(`const {parentPort, workerData}=require('node:worker_threads');
        const __name=(f)=>f; const search=(${searchIntegers.toString()});
        try { parentPort.postMessage({result:search(workerData)}); }
        catch(e) { parentPort.postMessage({error:e.message}); }`, {
        eval: true, workerData: model, resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error("O cálculo excedeu o tempo máximo. Tente novamente.")); }, model.timeLimitMs + 3000);
      worker.once("message", (message: { result?: IntegerSolution; error?: string }) => {
        clearTimeout(timer); void worker.terminate();
        if (message.result) resolve(message.result); else reject(new Error(message.error ?? "Falha no cálculo."));
      });
      worker.once("error", (error) => { clearTimeout(timer); reject(error); });
      worker.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new Error("O processo de cálculo foi encerrado.")); });
    });
  } finally { const next = waiting.shift(); if (next) next(); else running--; }
}

export async function calculateContribution(input: AllocationInput, algorithm: AllocationMethod) {
  if (algorithm === "CERRADO") return allocateCerrado(input);
  const calculation = improvedCalculation(input);
  let step = calculation.next();
  while (!step.done) step = calculation.next(await solve(step.value));
  return step.value;
}
