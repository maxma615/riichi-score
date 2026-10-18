import { expect, it } from 'vitest';
import Majiang from '@kobalab/majiang-core';
import { RiichiGame } from '../../../src/online/domain/engine';
import { SanmaGame } from '../../../src/online/domain/sanma';
import { SanmaWall, sanmaTiles } from '../../../src/online/domain/sanma-wall';
import { automaticChoice, automaticOff } from '../../../src/online/client/automatic-choice';
import type { GameVariant, MahjongGame } from '../../../src/online/domain/types';

// Reserve each requested physical tile before filling opponents' hands. The
// engine itself deals, accepts riichi and creates every tested legal choice.
function fixture(variant: GameVariant, hand: string, draws: string[]): MahjongGame {
  const count = variant === 'sanma' ? 3 : 4;
  const ordered = (physical: string[]) => {
    const stock = physical.slice();
    const take = (tile: string) => {
      const index = stock.indexOf(tile);
      if (index < 0) throw Error(`Impossible fixture: ${tile}`);
      return stock.splice(index, 1)[0];
    };
    const dealer = [...hand.matchAll(/([mpsz])(\d+)/g)].flatMap(m => [...m[2]].map(n => m[1] + n)).map(take);
    const drawOrder = draws.map(take);
    const hands = [dealer, ...Array.from({ length: count - 1 }, () => stock.splice(0, 13))];
    expect(hands.every(h => h.length === 13)).toBe(true);
    return { stock, front: [...hands.flat(), ...drawOrder] };
  };
  if (variant === 'sanma') return new SanmaGame('east', ['A', 'B', 'C'], { dealer: 0, wallFactory: () => {
    const { stock, front } = ordered(sanmaTiles());
    return new SanmaWall([...front, ...stock]);
  } });
  return new RiichiGame('east', ['A', 'B', 'C', 'D'], { dealer: 0, wallFactory: rule => {
    const wall = new Majiang.Shan(rule), physical = wall._pai.slice();
    const { stock, front } = ordered(physical);
    wall._pai = [...stock, ...front.reverse()];
    expect(wall._pai.slice().sort()).toEqual(physical.sort());
    wall._baopai = [wall._pai[4]]; wall._fubaopai = [wall._pai[9]];
    return wall;
  } });
}
function choose(game: MahjongGame, seat: number, id: string) {
  const view = game.view(seat);
  expect(view.choices.some(c => c.id === id)).toBe(true);
  game.respond(seat, view.decisionId, id);
}
function passAll(game: MahjongGame, count: number) {
  for (let seat = 0; seat < count; seat++) {
    const view = game.view(seat), pass = view.choices.find(c => c.type === 'pass');
    if (pass) game.respond(seat, view.decisionId, pass.id);
  }
}
for (const variant of ['sanma', 'yonma'] as const) {
  const count = variant === 'sanma' ? 3 : 4;
  for (const kind of ['ordinary', 'kan', 'tsumo', ...(variant === 'sanma' ? ['nuki'] : [])]) {
    it(`${variant} uses actual riichi choices for a following ${kind} draw`, () => {
      const target = kind === 'kan' ? 'p1' : kind === 'tsumo' ? 'z2' : kind === 'nuki' ? 'z4' : 'z3';
      const hand = kind === 'kan' ? 'p111s123456789z1' : 'p123456789s123z2';
      const game = fixture(variant, hand, ['z7', 'z5', 'z6', ...(count === 4 ? ['z3'] : []), target]);
      choose(game, 0, 'riichi:z7_'); passAll(game, count);
      expect(game.view(0).ownRiichi?.han).toBe(2);
      for (let seat = 1; seat < count; seat++) {
        const view = game.view(seat), discard = view.choices.find(c => c.type === 'discard' && c.value?.endsWith('_'))!;
        expect(discard).toBeTruthy(); choose(game, seat, discard.id); passAll(game, count);
      }
      const view = game.view(0);
      expect(view.drawnTile).toBe(target);
      if (kind === 'ordinary') {
        expect(automaticChoice(view, automaticOff)).toMatchObject({ type: 'discard', value: 'z3_' });
        const before = view.players.find(p => p.seat === 0)!.discards.length;
        choose(game, 0, automaticChoice(view, automaticOff)!.id);
        expect(game.view(0).players.find(p => p.seat === 0)!.discards).toHaveLength(before + 1);
      } else {
        expect(view.choices.some(c => c.type === kind)).toBe(true);
        expect(automaticChoice(view, { ...automaticOff, north: true, drawnDiscard: true })).toBeNull();
      }
    });
  }
  it(`${variant} preserves a real post-riichi ron instead of auto-passing`, () => {
    const game = fixture(variant, 'p123456789s123z2', ['z7', 'z2']);
    choose(game, 0, 'riichi:z7_'); passAll(game, count);
    choose(game, 1, 'discard:z2_');
    const view = game.view(0);
    expect(view.choices.map(c => c.type)).toEqual(['ron', 'pass']);
    expect(automaticChoice(view, { ...automaticOff, noCalls: true })).toBeNull();
  });
}
