import { parentPort } from "node:worker_threads";
import { getHeapStatistics } from "node:v8";
import { chooseBotChoice } from "./bot-strategy";
import type { GameVariant, GameView } from "./types";

if (!parentPort) throw new Error("Computer strategy requires a worker");
const port = parentPort;
port.on("message", (job: { id: number; view: GameView; variant: GameVariant; seat: number }) => {
  const started = performance.now();
  try {
    const choiceId = chooseBotChoice(job.view, job.variant, job.seat);
    port.postMessage({ type: "result", id: job.id, choiceId, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss });
  } catch {
    port.postMessage({ type: "failure", id: job.id });
  }
});
port.postMessage({ type: "ready", heapLimitBytes: getHeapStatistics().heap_size_limit, rssBytes: process.memoryUsage().rss });
