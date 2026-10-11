import assert from "node:assert/strict";
import Majiang from "@kobalab/majiang-core";
import { RiichiGame } from "../../../src/online/domain/engine";
import { SanmaGame } from "../../../src/online/domain/sanma";
import { SanmaWall, sanmaTiles } from "../../../src/online/domain/sanma-wall";
import type { GameVariant, MahjongGame } from "../../../src/online/domain/types";

const expand = (hand: string) => [...hand.matchAll(/([mpsz])(\d+)/g)].flatMap(m => [...m[2]].map(n => m[1] + n));
const terminal = (tile: string) => /^([mps][19]|z[1-7])$/.test(tile);
const ordinary = ["p123456789s123z2", "m19p147s258z13566", "m19p258s147z23477", "m2346p3468s2468z3"];
const nagashiHands = ["p223344s2234067", "p556677s3344556", "p234678s2256678", "m2233445566778"];

/** Full physical walls, never a truncated pool or injected end state. Each
 * designated nagashi seat naturally draws/discards only terminals/honors. */
export function drawEngine(variant: GameVariant, winners: number[] = [], options: {hands?: string[]; dealer?: number} = {}) {
  const count = variant === "sanma" ? 3 : 4;
  const build = (pool: string[]) => {
    const original = pool.slice(), available = pool.slice();
    const take = (tile: string) => { const i = available.indexOf(tile); assert.ok(i >= 0, `physical ${tile}`); return available.splice(i, 1)[0]; };
    const dealt = (options.hands ?? (winners.length ? nagashiHands : ordinary)).slice(0, count).map(h => expand(h).map(take));
    // Reserve a genuine fourteen-tile dead wall before distributing the live
    // wall. This leaves enough actual terminal copies for two nagashi seats.
    const dead = Array.from({length: 14}, () => take(available.find(terminal)!));
    const live: string[] = [];
    while (available.length) {
      const seat = live.length % count;
      const preferred = available.find(tile => terminal(tile) === winners.includes(seat));
      assert.ok(preferred || !winners.includes(seat), "enough terminals for each natural nagashi draw");
      live.push(take(preferred ?? available[0]));
    }
    assert.deepEqual([...dealt.flat(), ...live, ...dead].sort(), original.sort(), `all ${pool.length} physical tiles conserved`);
    return {dealt, live, dead};
  };
  if (variant === "sanma") return new SanmaGame("east", ["A","B","C"], {dealer: options.dealer ?? 0, wallFactory: () => {
    const {dealt, live, dead} = build(sanmaTiles());
    return new SanmaWall([...dealt.flat(), ...live, ...dead]);
  }});
  return new RiichiGame("east", ["A","B","C","D"], {dealer: options.dealer ?? 0, wallFactory: rule => {
    const wall = new Majiang.Shan(rule), {dealt, live, dead} = build(wall._pai);
    wall._pai = [...dead, ...live.slice().reverse(), ...dealt.flat().reverse()];
    wall._baopai = [dead[4]]; wall._fubaopai = [dead[9]];
    return wall;
  }});
}

export function playToDraw(game: MahjongGame, count: number) {
  for (let step = 0; step < 500; step++) {
    if (game.view(0).settlement) return;
    let acted = false;
    for (let seat = 0; seat < count; seat++) {
      const view = game.view(seat);
      const choice = view.choices.find(c => c.type === "pass") ?? view.choices.find(c => c.type === "discard" && c.value?.endsWith("_"));
      if (choice) {game.respond(seat, view.decisionId, choice.id); acted = true; break;}
    }
    assert.ok(acted, "legal human discard/pass reaches the next natural decision");
  }
  throw Error("Natural draw exceeded physical wall decision bound");
}
