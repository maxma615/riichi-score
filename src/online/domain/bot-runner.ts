import {ROUND_OPENING,isOpeningGame} from "./round-opening";
import { randomInt } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fallbackBotChoice } from "./bot-strategy";
import type { BotDecision, RoomStore } from "./rooms";
import type { ChoiceType } from "./types";

export const BOT_WORKER_LIMITS = {
  maxOldGenerationSizeMb: 48,
  maxYoungGenerationSizeMb: 8,
  codeRangeSizeMb: 4,
  stackSizeMb: 2,
};
const QUEUE_LIMIT = 32;
const DECISION_TIMEOUT_MS = 200;
const STARTUP_TIMEOUT_MS = 5000;

class Cancelled extends Error {}
class TimedOut extends Error {}
type Result = { type: "result"; id: number; choiceId: string; elapsedMs: number; rssBytes: number };
type Message = Result | { type: "failure"; id: number } | { type: "ready"; heapLimitBytes: number; rssBytes: number };
type Options = {
  visualDelayMs?: number;
  workerFactory?: () => Worker;
  onDecision?: (event: { roomId: string; seat: number; choiceType: ChoiceType; fallback: boolean }) => void;
  onChange?: () => void;
};
type WorkerSession = {
  worker: Worker;
  ready: Promise<void>;
  stop: (reason: Error) => void;
  request?: {
    id: number;
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
  };
};

function strategyWorker() {
  return new Worker(new URL("./bot-worker.js", import.meta.url), {execArgv: [], resourceLimits: BOT_WORKER_LIMITS});
}

/** All tables share one worker and one bounded queue. Mutations invalidate jobs
 * synchronously; only the final checked RoomStore response can change a game. */
export class BotRunner {
  readonly metrics = {
    completed: 0, computed: 0, fallbacks: 0, failures: 0, timeouts: 0,
    cancellations: 0, workerStarts: 0, workerStops: 0, maxQueue: 0, peakWorkers: 0, unexpectedErrors: 0,
    heapLimitBytes: 0, rssBytes: 0, decisionMs: [] as number[], roundTripMs: [] as number[],
  };
  private queue: BotDecision[] = [];
  private active?: { job: BotDecision; cancelled: boolean; wake?: () => void };
  private session?: WorkerSession;
  private stopping: Promise<unknown> = Promise.resolve();
  private running?: Promise<void>;
  private closed = false;
  private failuresInARow = 0;
  private serial = 0;
  private liveWorkers = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly rooms: RoomStore, private readonly options: Options = {}) {
    this.unsubscribe = rooms.subscribe(() => this.refresh());
    this.refresh();
  }

  get workerRunning() { return !!this.session || this.liveWorkers > 0; }
  get queueSize() { return this.queue.length; }

  private refresh() {
    if (this.closed) return;
    if (this.active && !this.rooms.isBotDecisionCurrent(this.active.job)) {
      this.active.cancelled = true;
      this.active.wake?.();
      if (this.session?.request) this.stopWorker(new Cancelled());
    }
    this.queue = this.rooms.botDecisions().filter(job => !this.active || !sameDecision(job, this.active.job)).slice(0, QUEUE_LIMIT);
    this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.queue.length);
    if (!this.rooms.hasOnlineBotTable) this.stopWorker(new Cancelled());
    if (!this.running && this.queue.length) {
      // Defer to let the current RoomStore mutation finish before pumping.
      this.running = Promise.resolve().then(() => this.pump()).catch(() => {
        // Fail closed on a room/observer programming error without an unhandled
        // rejection or an endless retry loop. Worker failures use legal fallback.
        this.metrics.unexpectedErrors++;
        this.closed = true;
        this.unsubscribe();
        this.queue = [];
        this.stopWorker(new Error("Computer runner stopped"));
      }).finally(() => {
        this.running = undefined;
        if (!this.closed && this.queue.length) this.refresh();
      });
    }
  }

  private stopWorker(reason: Error) {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    session.stop(reason);
    this.metrics.workerStops++;
    // Await termination before creating the next worker: no overlapping heaps.
    this.stopping = session.worker.terminate().catch(() => undefined).finally(() => { this.liveWorkers--; });
  }

  private async worker(): Promise<WorkerSession> {
    await this.stopping;
    if (this.closed || this.active?.cancelled) throw new Cancelled();
    if (this.session) return this.session;
    const worker = (this.options.workerFactory ?? strategyWorker)();
    this.metrics.workerStarts++;
    this.metrics.peakWorkers = Math.max(this.metrics.peakWorkers, ++this.liveWorkers);
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // Attach immediately, including when close happens before pump awaits ready.
    void ready.catch(() => undefined);
    const startupTimer = setTimeout(() => readyReject(new Error("Computer worker startup timed out")), STARTUP_TIMEOUT_MS);
    const session: WorkerSession = {
      worker, ready,
      stop: error => {
        clearTimeout(startupTimer);
        readyReject(error);
        session.request?.reject(error);
        session.request = undefined;
      },
    };
    worker.on("message", (message: Message) => {
      if (this.session !== session) return;
      if (message.type === "ready") {
        clearTimeout(startupTimer);
        if (!Number.isFinite(message.heapLimitBytes) || message.heapLimitBytes > 64 * 1024 * 1024 || message.heapLimitBytes <= 0) {
          readyReject(new Error("Computer worker heap limit exceeds budget"));
          return;
        }
        this.metrics.heapLimitBytes = message.heapLimitBytes;
        this.metrics.rssBytes = Math.max(this.metrics.rssBytes, message.rssBytes);
        readyResolve();
      } else if (session.request?.id === message.id) {
        if (message.type === "result") session.request.resolve(message);
        else session.request.reject(new Error("Computer strategy failed"));
      }
    });
    worker.on("error", error => session.stop(error instanceof Error ? error : new Error("Computer worker error")));
    worker.on("exit", () => session.stop(new Error("Computer worker exited")));
    this.session = session;
    return session;
  }

  private async compute(job: BotDecision) {
    const session = await this.worker();
    await session.ready;
    if (this.active?.cancelled || this.closed) throw new Cancelled();
    const id = ++this.serial;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await new Promise<Result>((resolve, reject) => {
        session.request = { id, resolve, reject };
        timer = setTimeout(() => reject(new TimedOut()), DECISION_TIMEOUT_MS);
        session.worker.postMessage({ id, view: job.view, variant: job.variant, seat: job.seat });
      });
      if (performance.now() - started > DECISION_TIMEOUT_MS) throw new TimedOut();
      if (!job.view.choices.some(c => c.id === result.choiceId)) throw new Error("Computer returned an illegal choice");
      this.metrics.computed++;
      this.metrics.rssBytes = Math.max(this.metrics.rssBytes, result.rssBytes);
      boundedSample(this.metrics.decisionMs, result.elapsedMs);
      boundedSample(this.metrics.roundTripMs, performance.now() - started);
      this.failuresInARow = 0;
      return result.choiceId;
    } finally {
      if (timer) clearTimeout(timer);
      session.request = undefined;
    }
  }

  private async pump() {
    while (!this.closed && this.queue.length) {
      const job = this.queue.shift()!;
      if (!this.rooms.isBotDecisionCurrent(job)) continue;
      const presentationStarted=performance.now();
      const active = { job, cancelled: false, wake: undefined as (() => void) | undefined };
      this.active = active;
      let choiceId: string;
      let fallback = this.failuresInARow >= 3;
      try {
        choiceId = fallback ? fallbackBotChoice(job.view) : await this.compute(job);
      } catch (error) {
        if (error instanceof Cancelled || active.cancelled || this.closed) {
          this.metrics.cancellations++;
          this.active = undefined;
          continue;
        }
        this.metrics.failures++;
        this.failuresInARow++;
        if (error instanceof TimedOut) this.metrics.timeouts++;
        this.stopWorker(error instanceof Error ? error : new Error("Computer failed"));
        fallback = true;
        choiceId = fallbackBotChoice(job.view);
      }
      if (fallback) this.metrics.fallbacks++;
      // Production opening animation must finish before a computer answers.
      // Explicit visualDelayMs is the existing simulation/test override.
      const delay = this.options.visualDelayMs ?? Math.max(randomInt(250, 451),isOpeningGame(job.view,job.variant)?ROUND_OPENING.operationsMs-(performance.now()-presentationStarted):0);
      if (delay > 0 && !active.cancelled && !this.closed) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, delay);
          active.wake = () => { clearTimeout(timer); resolve(); };
        });
      }
      this.active = undefined;
      if (!active.cancelled && !this.closed && this.rooms.respondBot(job, choiceId)) {
        this.metrics.completed++;
        this.options.onDecision?.({ roomId: job.roomId, seat: job.seat, choiceType: job.view.choices.find(c => c.id === choiceId)!.type, fallback });
        this.options.onChange?.();
      }
      // Also regenerate after cancellation: versions of other replies may change.
      this.queue = this.rooms.botDecisions().slice(0, QUEUE_LIMIT);
      this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.queue.length);
    }
  }

  async close() {
    this.closed = true;
    this.unsubscribe();
    this.queue = [];
    if (this.active) {
      this.active.cancelled = true;
      this.active.wake?.();
    }
    this.stopWorker(new Cancelled());
    await this.running;
    await this.stopping;
  }
}

function sameDecision(a: BotDecision, b: BotDecision) {
  return a.roomId === b.roomId && a.version === b.version && a.decisionId === b.decisionId && a.seat === b.seat;
}
function boundedSample(values: number[], value: number) {
  if (values.length === 1024) values.shift();
  values.push(value);
}
