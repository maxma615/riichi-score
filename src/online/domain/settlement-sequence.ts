import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import type { GameView, MahjongGame, PublicWinDeclaration, Settlement, SettlementFlow } from "./types";

type Page = { stage: SettlementFlow["stage"]; settlement: Settlement; detailIndex: number };

type Sequence = {
  id: string;
  snapshots: GameView[];
  pages: Page[];
  detailCount: number;
  oldScores: number[];
  delta: number[];
  indices: number[];
  startedAt: number[];
  confirmed: Set<number>;
  winDeclarations?: PublicWinDeclaration[];
};

/** Native engines calculate their usual payments. This adapter keeps the next
 * native hand private while all seats traverse one shared result presentation. */
export class SettlementSequenceGame implements MahjongGame {
  private sequence: Sequence | null = null;
  private readonly now: () => number;

  constructor(private readonly engine: MahjongGame, private readonly seatCount: 3 | 4, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.collectResult();
  }

  private seats() { return Array.from({ length: this.seatCount }, (_, seat) => seat); }

  private collectResult() {
    const first = this.engine.view(0);
    if (first.ranking || !first.settlement) return;
    if (first.handId === undefined || !first.gameInstanceId) throw Error("Result sequence requires native hand identity");
    const snapshots = this.seats().map(seat => structuredClone(this.engine.view(seat)));
    const oldScores = this.seats().map(seat => {
      const player = first.players.find(player => player.seat === seat);
      if (!player) throw Error("Result sequence has an incomplete seat map");
      return player.score;
    });
    const details: Settlement[] = [];
    for (let page = 0; page < this.seatCount; page++) {
      const current = this.engine.view(0);
      if (current.gameInstanceId !== first.gameInstanceId || current.handId !== first.handId || current.ranking || current.settlement?.kind !== first.settlement.kind) {
        throw Error("Unexpected native result boundary");
      }
      if (current.settlement.delta.length !== this.seatCount || !current.settlement.delta.every(Number.isFinite)) throw Error("Invalid native result delta");
      details.push(structuredClone(current.settlement));
      for (const seat of this.seats()) {
        const view = this.engine.view(seat);
        const ack = view.choices.find(choice => choice.type === "ack");
        if (view.decisionId !== current.decisionId || !ack) throw Error("Native result requires all legal ACKs");
        this.engine.respond(seat, view.decisionId, ack.id);
      }
      const next = this.engine.view(0);
      if (next.gameInstanceId !== first.gameInstanceId || next.decisionId === current.decisionId) throw Error("Native result failed to advance");
      if (next.ranking || next.handId !== first.handId) break;
      if (page === this.seatCount - 1) throw Error("Native result exceeded seat bound");
    }
    const delta = this.seats().map(seat => details.reduce((sum, detail) => sum + detail.delta[seat], 0));
    const pages: Page[] = [];
    // All native winners have already declared at this boundary. Expose only
    // their public declarations, independently of each viewer's detail cursor.
    const winDeclarations: PublicWinDeclaration[] | undefined = first.settlement.kind === "win" ? details.map(detail => {
      const seat = detail.winnerSeat, winMethod = detail.winMethod;
      if (seat === undefined || !Number.isInteger(seat) || seat < 0 || seat >= this.seatCount || (winMethod !== "ron" && winMethod !== "tsumo")) throw Error("Invalid native winning declaration");
      return {seat, winMethod};
    }) : undefined;
    if (winDeclarations && (new Set(winDeclarations.map(d => d.seat)).size !== winDeclarations.length || (winDeclarations.length > 1 && winDeclarations.some(d => d.winMethod !== "ron")))) throw Error("Inconsistent native winning declarations");
    let detailCount = details.length;
    if (first.settlement.kind === "win") details.forEach((settlement, detailIndex) => pages.push({stage: "detail", settlement, detailIndex}));
    else {
      const result = details[0], draw = result.drawInfo;
      if (details.length !== 1 || !draw) throw Error("Native draw result metadata is required");
      pages.push({stage: "draw", settlement: result, detailIndex: 0});
      detailCount = draw.nagashiResults.length;
      draw.nagashiResults.forEach((winner, detailIndex) => pages.push({stage: "detail", detailIndex, settlement: {
        ...result, winnerSeat: winner.seat, points: winner.points, delta: winner.delta,
        hand: draw.revealedHands.find(hand => hand.seat === winner.seat)?.hand,
      }}));
    }
    if (first.settlement.kind === "win" || first.settlement.drawInfo?.kind !== "abort") {
      pages.push({stage: "scores", detailIndex: detailCount, settlement: {...details[details.length - 1], delta}});
    }
    this.sequence = { id: randomUUID(), snapshots, pages, detailCount, oldScores, delta, winDeclarations, indices: this.seats().map(() => 0), startedAt: this.seats().map(() => this.now()), confirmed: new Set() };
  }

  respond(seat: number, decisionId: string, choiceId: string) {
    const sequence = this.sequence;
    if (!sequence) {
      this.engine.respond(seat, decisionId, choiceId);
      this.collectResult();
      return;
    }
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seatCount) throw new AppError(403, "seat_required", "你没有牌桌席位");
    const index = sequence.indices[seat];
    if (decisionId !== `${sequence.id}:${index}`) throw new AppError(409, "stale_decision", "牌局已更新，请按当前牌面操作");
    if (choiceId !== "ack" || sequence.confirmed.has(seat)) throw new AppError(409, "illegal_choice", "当前不能执行这个操作");
    if (index === sequence.pages.length - 1) {
      sequence.confirmed.add(seat);
      if (sequence.confirmed.size === this.seatCount) this.sequence = null;
    } else {
      // Detail navigation belongs to this viewer. The only table-wide barrier
      // is after everyone confirms the final score or abort-reason page.
      sequence.indices[seat]++;
      sequence.startedAt[seat] = this.now();
    }
  }

  view(seat: number): GameView {
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seatCount) throw new AppError(403, "seat_required", "你没有牌桌席位");
    const sequence = this.sequence;
    if (!sequence) return this.engine.view(seat);
    const index = sequence.indices[seat];
    const page = sequence.pages[index];
    const view = structuredClone(sequence.snapshots[seat]);
    view.decisionId = `${sequence.id}:${index}`;
    view.phase = page.stage === "scores" ? "score_change" : page.stage === "draw" ? "pingju" : "hule";
    view.ranking = null;
    view.settlement = structuredClone(page.settlement);
    view.choices = sequence.confirmed.has(seat) ? [] : [{ id: "ack", type: "ack" }];
    view.settlementFlow = {
      id: sequence.id, stage: page.stage, detailIndex: page.detailIndex, detailCount: sequence.detailCount,
      elapsedMs: Math.max(0, this.now() - sequence.startedAt[seat]), oldScores: sequence.oldScores.slice(), delta: sequence.delta.slice(),
      newScores: sequence.oldScores.map((score, seat) => score + sequence.delta[seat]),
      ...(sequence.winDeclarations ? {winDeclarations: sequence.winDeclarations.map(declaration => ({...declaration}))} : {}),
    };
    return view;
  }
}
