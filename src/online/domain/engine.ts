import { randomInt, randomUUID } from "node:crypto";
import Majiang from "@kobalab/majiang-core";
import { AppError } from "./errors";
import type { Choice, ChoiceType, DrawInfo, GameMode, GameView, Settlement } from "./types";

type Rule = Parameters<typeof Majiang.rule>[0];
export type EngineOptions = { dealer?: number; wallFactory?: (rule: NonNullable<Rule>) => InstanceType<typeof Majiang.Shan> };
type WinMessage = { l: number; shoupai: string; baojia: number | null; fubaopai: string[] | null; fu?: number; fanshu?: number; defen: number; hupai: { name: string; fanshu: number | string }[]; fenpei: number[] };
type DrawMessage = { name: string; shoupai: string[]; fenpei: number[] };

export function concealedTiles(hand: string): string[] {
  return [...hand.split(",")[0].matchAll(/([mpsz])(\d+)/g)].flatMap(match => [...match[2]].map(n => match[1] + n));
}

function secureWall(rule: NonNullable<Rule>) {
  // Avoid Math.random even though the upstream constructor normally uses it.
  const wall = Object.create(Majiang.Shan.prototype) as InstanceType<typeof Majiang.Shan>;
  const red = rule["赤牌"] as Record<string, number>;
  wall._pai = [];
  for (const suit of ["m", "p", "s", "z"]) {
    for (let n = 1; n <= (suit === "z" ? 7 : 9); n++) {
      for (let i = 0; i < 4; i++) wall._pai.push(suit + (n === 5 && i < (red[suit] ?? 0) ? 0 : n));
    }
  }
  for (let i = wall._pai.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [wall._pai[i], wall._pai[j]] = [wall._pai[j], wall._pai[i]];
  }
  Object.assign(wall, { _rule: rule, _baopai: [wall._pai[4]], _fubaopai: [wall._pai[9]], _weikaigang: false, _closed: false });
  return wall;
}

/** One synchronous, server-authoritative game. No timers or upstream players.
 * The driver stops at each human decision, retaining all multi-player replies.
 */
export class RiichiGame extends Majiang.Game {
  private readonly gameId = randomUUID();
  private handId = 0;
  private initialHands: string[][] | null = null;
  private step = 0;
  private pending = new Map<number, Choice[]>();
  private settlement: Settlement | null = null;
  private readonly wallFactory: typeof secureWall;

  constructor(mode: GameMode, names: string[], options: EngineOptions = {}) {
    super([], null, Majiang.rule({ "場数": mode === "east" ? 1 : 2, "延長戦方式": 0 }), "有归 · 日本麻将");
    if (names.length !== 4) throw new AppError(400, "four_players_required", "需要四位玩家");
    this._model.player = names.slice();
    this.wallFactory = options.wallFactory ?? secureWall;
    this._sync = true;
    this.kaiju(options.dealer ?? randomInt(4));
    this.advance();
  }

  override qipai() {
    const wall = this.wallFactory(this._rule), dealt: string[] = [];
    const original = wall.zimo, descriptor = Object.getOwnPropertyDescriptor(wall, "zimo");
    // Observe the actual 52 draws before Shoupai normalizes their order. Restore
    // the wall method even on failure; no extra draws or RNG calls are made.
    Object.defineProperty(wall, "zimo", { configurable: true, value: () => {
      const tile = original.call(wall); dealt.push(tile); return tile;
    } });
    this.initialHands = null;
    try { super.qipai(wall); }
    finally {
      if (descriptor) Object.defineProperty(wall, "zimo", descriptor);
      else Reflect.deleteProperty(wall, "zimo");
    }
    this.initialHands = [];
    this._model.player_id.forEach((seat, wind) => {
      this.initialHands![seat] = dealt.slice(wind * 13, wind * 13 + 13);
    });
  }
  override delay(callback: () => void) { callback(); }
  override notify_players() { /* DTOs are built explicitly; no raw engine messages. */ }

  override call_players(type: string, messages: unknown[]) {
    this._status = type;
    this._reply = [{}, {}, {}, {}];
    this.step++;
    if (type === "qipai") this.handId++;
    this.pending.clear();
    const model = this._model;
    if (type === "qipai") this.settlement = null;
    if (type === "hule") {
      const win = (messages[0] as { hule: WinMessage }).hule;
      const winningTile = win.baojia === null ? model.shoupai[win.l]._zimo?.slice(0, 2)
        : this._hule_option === "qianggang" ? this._gang![0] + this._gang!.slice(-1)
        : this._dapai!.slice(0, 2);
      this.settlement = {
        kind: "win", name: "和了", winnerSeat: model.player_id[win.l], hand: win.shoupai,
        winMethod: win.baojia === null ? "tsumo" : "ron", ...(winningTile ? { winningTile } : {}),
        yaku: win.hupai.map(y => ({ name: y.name, han: y.fanshu })), fu: win.fu, han: win.fanshu,
        points: win.defen, delta: this.mapBySeat(win.fenpei), uraIndicators: win.fubaopai ?? [],
      };
    } else if (type === "pingju") {
      const draw = (messages[0] as { pingju: DrawMessage }).pingju;
      const kind: DrawInfo["kind"] = draw.name === "流し満貫" ? "nagashi" : draw.name === "荒牌平局" ? "exhaustive" : "abort";
      const revealedHands = draw.shoupai.flatMap((hand, wind) => hand ? [{
        seat: model.player_id[wind], hand,
        waits: kind === "abort" ? [] : [...new Set(Majiang.Util.tingpai(model.shoupai[wind].clone()) ?? [])],
      }] : []);
      // These are the fixed per-seat partitions used by majiang-core 1.4.1's
      // pingju. They describe the existing native payment; they never apply it.
      const nagashiResults = kind !== "nagashi" ? [] : model.he.flatMap((river, wind) =>
        river._pai.every(tile => !/[+=-]$/.test(tile) && /^(?:z|[mps][19])/.test(tile)) ? [{
          seat: model.player_id[wind], points: wind === 0 ? 12000 : 8000,
          delta: this.mapBySeat([0,1,2,3].map(payer => payer === wind ? wind === 0 ? 12000 : 8000 : wind === 0 || payer === 0 ? -4000 : -2000)),
        }] : []);
      const delta = this.mapBySeat(draw.fenpei);
      if (kind === "nagashi" && !delta.every((amount, seat) => nagashiResults.reduce((sum, result) => sum + result.delta[seat], 0) === amount)) throw Error("Native nagashi partition mismatch");
      this.settlement = { kind: "draw", name: draw.name, yaku: [], delta, uraIndicators: [],
        tenpaiSeats: kind === "abort" ? [] : revealedHands.map(hand => hand.seat), drawInfo: {kind, revealedHands, nagashiResults, ...(kind === "abort" ? {abortPresentation: {
          ...(draw.name !== "九種九牌" && this._dapai?.endsWith("*") ? {riichiSeat: model.player_id[model.lunban]} : {}),
          ronSeats: draw.name === "三家和" ? revealedHands.map(hand => hand.seat) : [],
        }} : {})} };
    }
    for (let wind = 0; wind < 4; wind++) {
      const choices = this.legalChoices(wind);
      if (choices.length) this.pending.set(model.player_id[wind], choices);
    }
  }

  private mapBySeat(values: number[]) {
    const result = [0, 0, 0, 0];
    this._model.player_id.forEach((seat, wind) => { result[seat] = values[wind]; });
    return result;
  }

  private legalChoices(wind: number): Choice[] {
    const choices: Choice[] = [];
    const add = (type: ChoiceType, value?: string) => choices.push({ id: `${type}${value ? ":" + value : ""}`, type, ...(value ? { value } : {}) });
    const current = this._model.lunban;
    const type = this._status;
    if (type === "hule" || type === "pingju") add("ack");
    if (["zimo", "gangzimo", "fulou"].includes(type) && wind === current && !(type === "fulou" && this._gang)) {
      for (const tile of this.get_dapai()) {
        add("discard", tile);
        if (type !== "fulou" && this.allow_lizhi(tile)) add("riichi", tile);
      }
      if (type !== "fulou") {
        if (this.allow_hule()) add("tsumo");
        if (this.allow_pingju()) add("abort");
        for (const meld of this.get_gang_mianzi() ?? []) add("kan", meld);
      }
    }
    if (wind !== current && (type === "dapai" || type === "gang")) {
      if (type === "gang" && /^[mpsz]\d{4}$/.test(this._gang!)) return choices;
      if (this.allow_hule(wind)) add("ron");
      if (type === "dapai") {
        for (const meld of this.get_chi_mianzi(wind) ?? []) add("chi", meld);
        for (const meld of this.get_peng_mianzi(wind) ?? []) add("pon", meld);
        for (const meld of this.get_gang_mianzi(wind) ?? []) add("kan", meld);
      }
      if (choices.length) add("pass");
    }
    return choices;
  }

  private advance() {
    for (let transitions = 0; transitions < 100; transitions++) {
      if (this.pending.size || this._status === "jieju") return;
      this.next();
    }
    throw new Error("Mahjong engine failed to reach a decision");
  }

  respond(seat: number, decisionId: string, choiceId: string) {
    if (decisionId !== `${this.gameId}:${this.step}`) throw new AppError(409, "stale_decision", "牌局已更新，请按当前牌面操作");
    const choice = this.pending.get(seat)?.find(c => c.id === choiceId);
    if (!choice) throw new AppError(409, "illegal_choice", "当前不能执行这个操作");
    this.initialHands = null;
    const response = choice.type === "discard" ? { dapai: choice.value }
      : choice.type === "riichi" ? { dapai: choice.value + "*" }
      : choice.type === "tsumo" || choice.type === "ron" ? { hule: true }
      : choice.type === "abort" ? { daopai: true }
      : ["chi", "pon"].includes(choice.type) || (choice.type === "kan" && this._status === "dapai") ? { fulou: choice.value }
      : choice.type === "kan" ? { gang: choice.value } : {};
    this._reply[seat] = response;
    this.pending.delete(seat);
    this.advance();
  }

  view(seat: number): GameView {
    if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new AppError(403, "seat_required", "你没有牌桌席位");
    const model = this._model, wind = model.player_id.indexOf(seat);
    const hand = model.shoupai[wind];
    const drawn = hand._zimo && hand._zimo.length === 2 ? hand._zimo : null;
    return {
      gameInstanceId: this.gameId,
      handId: this.handId,
      decisionId: `${this.gameId}:${this.step}`, phase: this._status,
      roundWind: model.zhuangfeng, roundNumber: model.jushu + 1, honba: model.changbang,
      riichiSticks: model.lizhibang, remainingTiles: model.shan.paishu, doraIndicators: model.shan.baopai.slice(),
      turnSeat: model.lunban < 0 ? -1 : model.player_id[model.lunban],
      ronBlocked: !this._neng_rong[wind],
      ownRiichi: { han: this._lizhi[wind] ?? 0, declarationHan: (this.pending.get(seat) ?? []).some(c => c.type === "riichi") ? (this._diyizimo ? 2 : 1) : 0 },
      hand: concealedTiles(hand.toString()), drawnTile: drawn,
      ...(this.initialHands ? { initialDeal: this.initialHands[seat].slice() } : {}),
      players: model.player_id.map((id, l) => ({ seat: id, wind: l, score: model.defen[id], handCount: concealedTiles(model.shoupai[l].toString()).length, hasDrawnTile: !!model.shoupai[l]._zimo && model.shoupai[l]._zimo.length === 2, discards: model.he[l]._pai.slice(), melds: model.shoupai[l]._fulou.slice(), riichi: !!model.shoupai[l].lizhi })),
      choices: (this.pending.get(seat) ?? []).map(c => ({ ...c })),
      settlement: this.settlement ? structuredClone(this.settlement) : null,
      ranking: this._status === "jieju" ? model.defen.map((score, id) => ({ seat: id, score, rank: this._paipu.rank[id] })).sort((a, b) => a.rank - b.rank) : null,
    };
  }
}
