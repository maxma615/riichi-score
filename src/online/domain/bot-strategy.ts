import Majiang from "@kobalab/majiang-core";
import type { Choice, GameVariant, GameView } from "./types";

const normal = (tile: string) => tile.slice(0, 2).replace("0", "5");
const meldTiles = (meld: string) => [...meld.matchAll(/\d/g)].map(m => meld[0] + m[0]);
const validTile = (tile: string, variant: GameVariant) => variant !== "sanma" || tile[0] !== "m" || tile[1] === "1" || tile[1] === "9";

/** Constant-work emergency path: never imports or inspects an engine. */
export function fallbackBotChoice(view: GameView): string {
  for (const type of ["tsumo", "ron", "pass", "ack", "discard", "nuki", "riichi", "kan", "pon", "chi", "abort"] as const) {
    const choice = view.choices.find(c => c.type === type);
    if (choice) return choice.id;
  }
  throw new Error("No legal computer choice");
}

function handOf(tiles: string[], melds: string[]) {
  const hand = new Majiang.Shoupai(tiles);
  hand._fulou = melds.slice();
  return hand;
}

function without(tiles: string[], tile: string) {
  const result = tiles.slice();
  const index = result.indexOf(tile.slice(0, 2));
  if (index < 0) throw new Error("Legal choice refers to a missing tile");
  result.splice(index, 1);
  return result;
}

function doraTile(indicator: string, variant: GameVariant) {
  const suit = indicator[0], number = Number(normal(indicator)[1]);
  if (suit === "m" && variant === "sanma") return number === 1 ? "m9" : "m1";
  if (suit === "z") return "z" + (number <= 4 ? number % 4 + 1 : (number - 4) % 3 + 5);
  return suit + (number % 9 + 1);
}

function visibleCounts(view: GameView) {
  const counts = new Map<string, number>();
  const add = (tile: string) => counts.set(normal(tile), (counts.get(normal(tile)) ?? 0) + 1);
  view.hand.forEach(add);
  view.doraIndicators.forEach(add);
  for (const player of view.players) {
    // A called discard is already represented in the exposed meld.
    player.discards.filter(tile => !/[+=-]/.test(tile)).forEach(add);
    player.melds.flatMap(meldTiles).forEach(add);
    for (let n = 0; n < (player.nuki ?? 0); n++) add("z4");
  }
  return counts;
}

function publicRisk(tile: string, view: GameView, seat: number) {
  const key = normal(tile);
  let risk = 0;
  for (const opponent of view.players.filter(p => p.seat !== seat && p.riichi)) {
    const river = opponent.discards.map(normal);
    if (river.includes(key)) continue;
    const rank = Number(key[1]);
    // Genbutsu is certain; suji and honors are only lower-risk heuristics.
    const suji = key[0] !== "z" && [rank - 3, rank + 3].some(n => river.includes(key[0] + n));
    risk += key[0] === "z" ? 0.65 : suji ? 0.55 : 1;
  }
  return risk;
}

function hasYakuPath(tiles: string[], melds: string[], view: GameView, seat: number) {
  const valueHonors = new Set(["z5", "z6", "z7", `z${view.roundWind + 1}`, `z${(view.players.find(p => p.seat === seat)?.wind ?? 0) + 1}`]);
  const counts = new Map<string, number>();
  tiles.map(normal).forEach(tile => counts.set(tile, (counts.get(tile) ?? 0) + 1));
  if ([...valueHonors].some(tile => (counts.get(tile) ?? 0) >= 3)) return true;
  if (melds.some(m => valueHonors.has(normal(m)) && meldTiles(m).every(t => normal(t) === normal(m)))) return true;
  return [...tiles, ...melds.flatMap(meldTiles)].every(t => t[0] !== "z" && Number(normal(t)[1]) > 1 && Number(normal(t)[1]) < 9);
}

/** One-ply bounded evaluation, at most 14 discards × 34 effective tile types.
 * Input is the same private/public DTO available to this seat, never an engine.
 */
export function chooseBotChoice(view: GameView, variant: GameVariant, seat: number): string {
  const immediate = view.choices.find(c => c.type === "tsumo" || c.type === "ron" || c.type === "ack");
  if (immediate) return immediate.id;
  const north = view.choices.find(c => c.type === "nuki");
  if (north) return north.id;

  const melds = view.players.find(p => p.seat === seat)?.melds ?? [];
  const current = handOf(view.hand, melds);
  const shanten = Majiang.Util.xiangting(current);
  const threatened = view.players.some(p => p.seat !== seat && p.riichi);
  const discards = view.choices.filter(c => c.type === "discard");
  const candidates = discards.map(choice => {
    const hand = handOf(without(view.hand, choice.value!), melds);
    return { choice, hand, shanten: Majiang.Util.xiangting(hand) };
  });
  const bestShanten = candidates.length ? Math.min(...candidates.map(c => c.shanten)) : shanten;

  if (!threatened) {
    for (const choice of view.choices.filter(c => c.type === "kan")) {
      const meld = choice.value!;
      const called = view.phase === "dapai";
      if (called) continue; // Exposed calls use the yaku-aware path below.
      const previous = melds.find(m => normal(m) === normal(meld));
      let tiles = view.hand.slice();
      const remove = previous ? [meld[0] + meld.at(-1)!] : meldTiles(meld);
      for (const tile of remove) tiles = without(tiles, tile);
      const nextMelds = [...melds.filter(m => m !== previous), meld];
      if (Majiang.Util.xiangting(handOf(tiles, nextMelds)) <= bestShanten) return choice.id;
    }
  }

  if (candidates.length) {
    const counts = visibleCounts(view);
    const doras = view.doraIndicators.map(i => doraTile(i, variant));
    let best: { choice: Choice; score: number } | undefined;
    for (const candidate of candidates) {
      const tile = candidate.choice.value!;
      const outs = candidate.shanten === bestShanten
        ? (Majiang.Util.tingpai(candidate.hand) ?? []).filter(t => validTile(t, variant)).reduce((sum, t) => sum + Math.max(0, 4 - (counts.get(t) ?? 0)), 0)
        : 0;
      const doraCost = (tile[1] === "0" ? 1 : 0) + doras.filter(t => t === normal(tile)).length;
      const risk = publicRisk(tile, view, seat);
      const score = -candidate.shanten * 1000 + outs * 4 - doraCost * 30 - risk * (bestShanten > 0 ? 1800 : 250);
      if (!best || score > best.score) best = { choice: candidate.choice, score };
    }
    const riichi = view.choices.find(c => c.type === "riichi" && c.value === best!.choice.value);
    return riichi && (!threatened || publicRisk(riichi.value!, view, seat) === 0) ? riichi.id : best!.choice.id;
  }

  if (!threatened) {
    for (const choice of view.choices.filter(c => c.type === "pon" || c.type === "chi" || c.type === "kan")) {
      const next = current.clone().fulou(choice.value!);
      const remaining = view.hand.slice();
      for (const match of choice.value!.slice(1).matchAll(/(\d)([+=-]?)/g)) {
        if (!match[2]) remaining.splice(remaining.indexOf(choice.value![0] + match[1]), 1);
      }
      if (!hasYakuPath(remaining, next._fulou, view, seat)) continue;
      const after = choice.type === "kan" ? Majiang.Util.xiangting(next)
        : Math.min(...(next.get_dapai() ?? []).map(tile => Majiang.Util.xiangting(next.clone().dapai(tile))));
      if (after < shanten) return choice.id;
    }
  }
  return fallbackBotChoice(view);
}
