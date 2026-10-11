import { randomInt, randomUUID } from "node:crypto";
import Majiang from "@kobalab/majiang-core";
import { AppError } from "./errors";
import { concealedTiles } from "./engine";
import { SanmaWall } from "./sanma-wall";
import { SANMA_HONBA_POINTS, sanmaPayment, scoreSanma, tenpaiPayment } from "./sanma-scoring";
import type { Choice, ChoiceType, GameMode, GameView, Settlement } from "./types";

export type SanmaOptions = {
  dealer?: number;
  wallFactory?: () => SanmaWall
};
type Hand = InstanceType<typeof Majiang.Shoupai>;
type Player = {
  hand: Hand;
  discards: string[];
  nuki: number;
  riichi: 0 | 1 | 2;
  ippatsu: boolean;
  temporaryFuriten: boolean;
  riichiFuriten: boolean;
  kans: number
};
type Reaction = {
  kind: "discard" | "nuki" | "ankan" | "kakan";
  actor: number;
  tile: string;
  meld?: string;
  riichi?: boolean
};
const normalize = (tile: string) => tile.slice(0, 2).replace("0", "5");
const allowedTile = (tile: string) => !/^m[2-8]$/.test(tile);
const waits = (hand: Hand) =>
  Majiang.Util.xiangting(hand) === 0
    ? (Majiang.Util.tingpai(hand) ?? []).filter(allowedTile)
    : [];
// '+' means next seat, '-' previous seat. The scoring library uses these only
// for meld/ron shape recognition; all actual seat arithmetic lives here.
const direction = (from: number, to: number) => (from - to + 3) % 3 === 1 ? "+" : "-";

/** A genuine three-seat synchronous state machine. Fixtures are server-only;
 * no model, wall or opponent hand is returned through the public DTO. */
export class SanmaGame {
  private readonly id = randomUUID();
  private handId = 0;
  private initialHands: string[][] | null = null;
  private step = 0;
  private readonly initialDealer: number;
  private readonly wallFactory: () => SanmaWall;
  private wall!: SanmaWall;
  private players: Player[] = [];
  private scores = [35000, 35000, 35000];
  private dealer: number;
  private round = 0;
  private honba = 0;
  private sticks = 0;
  private turn = 0;
  private phase = "zimo";
  private pending = new Map<number, Choice[]>();
  private replies = new Map<number, Choice>();
  private reaction: Reaction | null = null;
  private uninterrupted = true;
  private settlement: Settlement | null = null;
  private settlements: Settlement[] = [];
  private repeat = false;
  private drawEnd = false;
  private ranking: GameView["ranking"] = null;

  constructor(
    private readonly mode: GameMode,
    names: string[],
    options: SanmaOptions = {}
  ) {
    if (names.length !== 3)
      throw new AppError(400, "three_players_required", "需要三位玩家");
    if (mode !== "east" && mode !== "hanchan") throw new Error("Invalid Sanma mode");
    this.dealer = options.dealer ?? randomInt(3);
    if (!Number.isInteger(this.dealer) || this.dealer < 0 || this.dealer > 2)
      throw new Error("Invalid dealer");
    this.initialDealer = this.dealer;
    this.wallFactory = options.wallFactory ?? (() => new SanmaWall());
    this.startHand();
  }

  private wind(seat: number) {
    return (seat - this.dealer + 3) % 3;
  }

  private startHand() {
    this.handId++;
    this.wall = this.wallFactory();
    this.uninterrupted = true;
    this.settlement = null;
    this.reaction = null;
    this.players = Array.from({
      length: 3
    }, () => ({
      hand: new Majiang.Shoupai(),
      discards: [],
      nuki: 0,
      riichi: 0,
      ippatsu: false,
      temporaryFuriten: false,
      riichiFuriten: false,
      kans: 0
    }));
    this.initialHands = [];
    for (let wind = 0; wind < 3; wind++) {
      const seat = (this.dealer + wind) % 3;
      const dealt = Array.from({ length: 13 }, () => this.wall.draw());
      this.initialHands[seat] = dealt;
      this.players[seat].hand = new Majiang.Shoupai(dealt);
    }
    this.turn = this.dealer;
    this.draw("zimo");
  }

  private setChoices(phase: string, choices: Map<number, Choice[]>) {
    this.phase = phase;
    this.step++;
    this.pending = choices;
    this.replies.clear();
  }

  private choice(type: ChoiceType, value?: string): Choice {
    return {
      id: type + (value ? ":" + value : ""),
      type,
      ...(value ? {
        value
      } : {})
    };
  }

  private cancelFirstTurn() {
    this.uninterrupted = false;
    for (const p of this.players) p.ippatsu = false;
  }

  private draw(kind: "zimo" | "gangzimo" | "nukizimo", revealKanIndicator = kind === "gangzimo") {
    const p = this.players[this.turn];
    p.temporaryFuriten = false;
    p.hand.zimo(kind === "zimo" ? this.wall.draw() : this.wall.replace(kind === "gangzimo", revealKanIndicator));
    this.phase = kind;
    this.ownChoices();
  }

  private score(seat: number, ron?: Reaction) {
    const p = this.players[seat];
    return scoreSanma(p.hand, ron ? ron.tile + direction(ron.actor, seat) : null, {
      zhuangfeng: Math.floor(this.round / 3),
      menfeng: this.wind(seat),
      lizhi: p.riichi,
      yifa: p.ippatsu,
      qianggang: ron?.kind === "kakan",
      lingshang: !ron && (this.phase === "gangzimo" || this.phase === "nukizimo"),
      haidi: this.wall.remaining === 0 ? (ron?.kind === "discard" ? 2 : !ron && this.phase === "zimo" ? 1 : 0 ): 0,
      tianhu: !ron && this.uninterrupted && p.discards.length === 0 ? (seat === this.dealer ? 1 : 2 ): 0,
      baopai: this.wall.dora,
      fubaopai: p.riichi ? this.wall.ura : [],
      nuki: p.nuki
    ,});
  }

  private ownChoices() {
    const p = this.players[this.turn],
      hand = p.hand,
      choices: Choice[] = [];
    const drawn = !!hand._zimo && hand._zimo.length === 2;
    for (const tile of hand.get_dapai() ?? []) {
      choices.push(this.choice("discard", tile));
      if (
        drawn && !p.riichi && hand.menqian &&
        this.scores[this.turn] >= 1000 && this.wall.remaining >= 3 &&
        waits(hand.clone().dapai(tile)).length
      ) choices.push(this.choice("riichi", tile));
    }
    if (drawn) {
      if (this.score(this.turn)) choices.push(this.choice("tsumo"));
      if (
        this.uninterrupted && !p.discards.length &&
        new Set(concealedTiles(hand.toString()).filter(t => /^z|^[mps][19]$/.test(t))).size >= 9
      ) choices.push(this.choice("abort"));
      if (
        this.wall.canReplace && hand._bingpai.z[4] > 0 &&
        (!p.riichi || hand._zimo === "z4")
      ) choices.push(this.choice("nuki"));
      if (this.wall.canKan) for (const meld of hand.get_gang_mianzi() ?? []) {
        if (p.riichi) {
          const before = waits(hand.clone().dapai(hand._zimo!)).sort().join();
          const after = waits(hand.clone().gang(meld)).sort().join();
          if (!before || before !== after) continue;
        }
        choices.push(this.choice("kan", meld));
      }
    }
    this.setChoices(this.phase, new Map([[this.turn, choices]]));
  }

  private canRon(seat: number, reaction: Reaction) {
    const p = this.players[seat];
    if (p.temporaryFuriten || p.riichiFuriten) return false;
    const waiting = waits(p.hand);
    if (p.discards.some(tile => waiting.includes(normalize(tile)))) return false;
    if (
      reaction.kind === "ankan" &&
      Majiang.Util.xiangting_guoshi(p.hand.clone().zimo(reaction.tile)) !== -1
    ) return false;
    return !!this.score(seat, reaction);
  }

  private react(reaction: Reaction) {
    this.reaction = reaction;
    const choices = new Map<number, Choice[]>();
    for (let i = 1; i < 3; i++) {
      const seat = (reaction.actor + i) % 3,
        hand = this.players[seat].hand,
        options: Choice[] = [];
      if (this.canRon(seat, reaction)) options.push(this.choice("ron"));
      if (reaction.kind === "discard" && this.wall.remaining > 0) {
        const tile = reaction.tile + direction(reaction.actor, seat);
        for (const meld of hand.get_peng_mianzi(tile) ?? []) options.push(this.choice("pon", meld));
        if (this.wall.canKan) for (const meld of hand.get_gang_mianzi(tile) ?? []) options.push(this.choice("kan", meld));
      }
      if (options.length) {
        options.push(this.choice("pass"));
        choices.set(seat, options);
      }
    }
    this.setChoices(reaction.kind === "discard" ? "dapai" : reaction.kind === "nuki" ? "nuki" : "gang", choices);
    if (!choices.size) this.finishReaction();
  }

  private finishReaction() {
    const r = this.reaction!;
    const winners = [1, 2]
      .map(i => (r.actor + i) % 3)
      .filter(s => this.replies.get(s)?.type === "ron");
    if (winners.length) {
      this.win(winners, r);
      return;
    }
    if (r.kind !== "discard") {
      const p = this.players[r.actor];
      if (r.kind === "nuki") {
        p.hand.dapai("z4");
        p.nuki++;
        this.draw("nukizimo");
      } else {
        p.hand.gang(r.meld!);
        p.kans++;
        this.draw("gangzimo", r.kind === "ankan");
      }
      this.reaction = null;
      return;
    }
    if (r.riichi) {
      this.scores[r.actor] -= 1000;
      this.sticks++;
    }
    if (this.players.reduce((sum, p) => sum + p.kans, 0) === 4 && this.players.every(p => p.kans < 4)) {
      this.endDraw("四開槓", true);
      return;
    }
    if (!this.wall.remaining) {
      this.endDraw("荒牌平局");
      return;
    }
    for (let i = 1; i < 3; i++) {
      const seat = (r.actor + i) % 3,
        reply = this.replies.get(seat);
      if (reply?.type === "pon" || reply?.type === "kan") {
        this.cancelFirstTurn();
        this.players[r.actor].discards[this.players[r.actor].discards.length - 1] += direction(seat, r.actor);
        this.turn = seat;
        this.players[seat].hand.fulou(reply.value!);
        this.reaction = null;
        if (reply.type === "kan") {
          this.players[seat].kans++;
          this.draw("gangzimo", false);
        } else {
          this.phase = "fulou";
          this.ownChoices();
        }
        return;
      }
    }
    this.reaction = null;
    this.turn = (r.actor + 1) % 3;
    this.draw("zimo");
  }

  private win(winners: number[], ron?: Reaction) {
    this.repeat = winners.includes(this.dealer);
    this.drawEnd = false;
    this.settlements = winners.map((seat, index) => {
      const result = this.score(seat, ron)!;
      const pao = result.yaku.filter(y => y.baojia).map(y => ({
        seat: (seat + (y.baojia === "+" ? 1 : 2)) % 3,
        base: 8000 * String(y.fanshu).length
      }));
      const delta = sanmaPayment({
        base: result.base,
        winner: seat,
        dealer: this.dealer,
        loser: ron?.actor,
        honba: this.honba,
        sticks: index === 0 ? this.sticks : 0,
        pao
      });
      return {
        kind: "win",
        name: "和了",
        winnerSeat: seat,
        hand: this.players[seat].hand.toString(),
        winMethod: ron ? "ron" : "tsumo",
        winningTile: ron?.tile ?? this.players[seat].hand._zimo!.slice(0, 2),
        yaku: result.yaku.map(y => ({
          name: y.name,
          han: y.fanshu
        })),
        fu: result.fu,
        han: result.han,
        points: delta[seat] - (index === 0 ? this.sticks * 1000 : 0) - (ron ? this.honba * SANMA_HONBA_POINTS : this.honba * 200),
        delta,
        uraIndicators: this.players[seat].riichi ? this.wall.ura : []
      } satisfies Settlement;
    });
    this.showSettlement();
  }

  private endDraw(name: string, abort = false) {
    const tenpai = this.players.flatMap((p, s) => waits(p.hand).length ? [s] : []);
    const nagashi = abort ? [] : this.players.flatMap((p, s) =>
      p.discards.length && p.discards.every(t => /^([mps][19]|z[1-7])_?\*?$/.test(t))
        ? [s]
        : []
    );
    let delta = abort ? [0, 0, 0] : tenpaiPayment(tenpai);
    const nagashiResults = nagashi.map(seat => {
      const delta = sanmaPayment({base: 2000, winner: seat, dealer: this.dealer});
      return {seat, points: delta[seat], delta};
    });
    if (nagashi.length) {
      name = "流し満貫";
      delta = [0, 1, 2].map(seat => nagashiResults.reduce((sum, result) => sum + result.delta[seat], 0));
    }
    this.repeat = abort || tenpai.includes(this.dealer);
    this.drawEnd = true;
    this.settlements = [{
      kind: "draw",
      name,
      yaku: [],
      delta,
      uraIndicators: [],
      tenpaiSeats: abort ? [] : tenpai,
      drawInfo: {
        kind: abort ? "abort" : nagashi.length ? "nagashi" : "exhaustive",
        ...(abort ? {abortPresentation: {
          ...(this.reaction?.kind === "discard" && this.reaction.riichi ? {riichiSeat: this.reaction.actor} : {}),
          ronSeats: [],
        }} : {}),
        revealedHands: (abort ? name === "九種九牌" ? [this.turn] : [] : tenpai).map(seat => ({
          seat, hand: this.players[seat].hand.toString(), waits: abort ? [] : waits(this.players[seat].hand),
        })),
        nagashiResults,
      },
    }];
    this.showSettlement();
  }

  private showSettlement() {
    this.settlement = this.settlements.shift()!;
    this.setChoices(this.settlement.kind === "win" ? "hule" : "pingju", new Map([0, 1, 2].map(s => [s, [this.choice("ack")]])));
  }

  private acknowledged() {
    this.settlement!.delta.forEach((v, s) => this.scores[s] += v);
    if (this.settlement!.kind === "win") this.sticks = 0;
    if (this.settlements.length) {
      this.showSettlement();
      return;
    }
    this.honba = this.drawEnd || this.repeat ? this.honba + 1 : 0;
    if (!this.repeat) {
      this.dealer = (this.dealer + 1) % 3;
      this.round++;
    }
    if (this.round >= (this.mode === "east" ? 3 : 6) || this.scores.some(s => s < 0)) {
      const order = [0, 1, 2].sort((a, b) =>
        this.scores[b] - this.scores[a] ||
        ((a - this.initialDealer + 3) % 3 )- ((b - this.initialDealer + 3) % 3
      ));
      this.scores[order[0]] += this.sticks * 1000;
      this.sticks = 0;
      this.ranking = order.map((seat, i) => ({
        seat,
        rank: i + 1,
        score: this.scores[seat]
      }));
      this.setChoices("jieju", new Map());
      return;
    }
    this.startHand();
  }

  respond(seat: number, decisionId: string, choiceId: string): void {
    if (decisionId !== `${this.id}:${this.step}`) throw new AppError(409, "stale_decision", "牌局已更新，请按当前牌面操作");
    const options = this.pending.get(seat),
      choice = options?.find(c => c.id === choiceId);
    if (!choice) throw new AppError(409, "illegal_choice", "当前不能执行这个操作");
    this.initialHands = null;
    this.pending.delete(seat);
    this.replies.set(seat, choice);
    if (this.phase === "hule" || this.phase === "pingju") {
      if (!this.pending.size) this.acknowledged();
      return;
    }
    if (this.reaction) {
      if (choice.type !== "ron" && options!.some(c => c.type === "ron")) {
        this.players[seat].temporaryFuriten = true;
        if (this.players[seat].riichi) this.players[seat].riichiFuriten = true;
      }
      if (!this.pending.size) this.finishReaction();
      return;
    }
    const p = this.players[seat];
    if (choice.type === "tsumo") {
      this.win([seat]);
      return;
    }
    if (choice.type === "abort") {
      this.endDraw("九種九牌", true);
      return;
    }
    if (choice.type === "nuki") {
      this.cancelFirstTurn();
      this.react({
        kind: "nuki",
        actor: seat,
        tile: "z4"
      });
      return;
    }
    if (choice.type === "kan") {
      this.cancelFirstTurn();
      // The prior open-kan indicator is revealed when a subsequent kan is
      // declared, even if that new added kan is then robbed.
      this.wall.revealPendingKanDora();
      const meld = choice.value!;
      this.react({
        kind: /^[mpsz]\d{4}$/.test(meld) ? "ankan" : "kakan",
        actor: seat,
        tile: meld[0] + meld.slice(-1),
        meld
      });
      return;
    }
    const riichi = choice.type === "riichi",
      tile = choice.value!;
    if (p.riichi) p.ippatsu = false;
    if (riichi) {
      p.riichi = this.uninterrupted && p.discards.length === 0 ? 2 : 1;
      p.ippatsu = true;
    }
    this.wall.revealPendingKanDora();
    p.hand.dapai(tile + (riichi ? "*" : ""));
    p.discards.push(tile + (riichi ? "*" : ""));
    this.react({
      kind: "discard",
      actor: seat,
      tile: tile.slice(0, 2),
      riichi
    });
  }

  view(seat: number): GameView {
    if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new AppError(403, "seat_required", "你没有牌桌席位");
    const hand = this.players[seat].hand;
    return {
      gameInstanceId: this.id,
      handId: this.handId,
      decisionId: `${this.id}:${this.step}`,
      phase: this.phase,
      roundWind: Math.floor(Math.min(this.round, this.mode === "east" ? 2 : 5) / 3),
      roundNumber: Math.min(this.round, this.mode === "east" ? 2 : 5) % 3 + 1,
      honba: this.honba,
      riichiSticks: this.sticks,
      remainingTiles: this.wall.remaining,
      doraIndicators: this.wall.dora,
      turnSeat: this.turn,
      ronBlocked: this.players[seat].temporaryFuriten || this.players[seat].riichiFuriten,
      ownRiichi: { han: this.players[seat].riichi, declarationHan: (this.pending.get(seat) ?? []).some(c => c.type === "riichi") ? (this.uninterrupted && this.players[seat].discards.length === 0 ? 2 : 1) : 0 },
      hand: concealedTiles(hand.toString()),
      ...(this.initialHands ? { initialDeal: this.initialHands[seat].slice() } : {}),
      drawnTile: hand._zimo?.length === 2 ? hand._zimo : null,
      players: this.players.map((p, s) => ({
        seat: s,
        wind: this.wind(s),
        score: this.scores[s],
        handCount: concealedTiles(p.hand.toString()).length,
        hasDrawnTile: p.hand._zimo?.length === 2,
        discards: p.discards.slice(),
        melds: p.hand._fulou.slice(),
        riichi: !!p.riichi,
        nuki: p.nuki
      })),
      choices: (this.pending.get(seat) ?? []).map(c => ({
        ...c
      })),
      settlement: this.settlement ? structuredClone(this.settlement) : null,
      ranking: this.ranking ? structuredClone(this.ranking) : null
    };
  }
}
