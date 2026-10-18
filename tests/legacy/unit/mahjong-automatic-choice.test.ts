import { describe, expect, it } from 'vitest';
import { automaticChoice, automaticOff } from '../../../src/online/client/automatic-choice';
import type { Choice, GameView } from '../../../src/online/domain/types';

const discard: Choice = { id: 'drawn', type: 'discard', value: 's5_' };
const pass: Choice = { id: 'pass', type: 'pass' };
const game = (choices: Choice[], riichi: 0 | 1 | 2 = 1): GameView => ({
  gameInstanceId: 'match', handId: 1, decisionId: 'draw-1', phase: 'zimo',
  roundWind: 0, roundNumber: 1, honba: 0, riichiSticks: 1, remainingTiles: 50,
  doraIndicators: ['z1'], turnSeat: 0, ownRiichi: { han: riichi, declarationHan: 0 },
  hand: ['s1'], drawnTile: 's5', players: [], choices, settlement: null, ranking: null,
});

describe('authoritative automatic choices', () => {
  it.each([1, 2] as const)('discards an ordinary draw after %s han riichi without an auto option', han => {
    expect(automaticChoice(game([discard], han), automaticOff)).toEqual(discard);
  });
  it('does not mistake a pending declaration or a public riichi flag for accepted riichi', () => {
    const view = game([discard], 0);
    view.ownRiichi!.declarationHan = 1;
    expect(automaticChoice(view, automaticOff)).toBeNull();
    delete view.ownRiichi;
    view.players = [{ seat: 0, wind: 0, score: 25000, handCount: 13, riichi: true, discards: [], melds: [] }];
    expect(automaticChoice(view, automaticOff)).toBeNull();
  });
  it('only chooses the actual drawn discard offered by the engine after riichi', () => {
    const closed: Choice = { id: 'closed', type: 'discard', value: 's5' };
    expect(automaticChoice(game([closed, discard]), automaticOff, 's5')).toEqual(discard);
    expect(automaticChoice(game([closed]), automaticOff)).toBeNull();
  });
  it.each(['kan', 'nuki', 'tsumo', 'ron'] as const)('leaves a legal %s open after riichi', type => {
    const option: Choice = { id: type, type, value: type === 'kan' ? 's5555' : undefined };
    expect(automaticChoice(game([discard, option]), { ...automaticOff, drawnDiscard: true, north: true })).toBeNull();
  });
  it('automatically passes when passing is the only offered response', () => {
    expect(automaticChoice(game([pass]), automaticOff)).toEqual(pass);
    expect(automaticChoice(game([pass], 0), automaticOff)).toEqual(pass);
  });
  it('never passes a possible win even with no calls selected', () => {
    const ron: Choice = { id: 'ron', type: 'ron' };
    expect(automaticChoice(game([pass, ron]), { ...automaticOff, noCalls: true })).toBeNull();
    expect(automaticChoice(game([pass, ron]), { ...automaticOff, win: true })).toEqual(ron);
  });
  it('keeps non-riichi drawn discard, no calls, north and win preferences', () => {
    const north: Choice = { id: 'north', type: 'nuki' };
    const pon: Choice = { id: 'pon', type: 'pon', value: 's555+' };
    const tsumo: Choice = { id: 'tsumo', type: 'tsumo' };
    expect(automaticChoice(game([discard], 0), automaticOff)).toBeNull();
    expect(automaticChoice(game([discard], 0), { ...automaticOff, drawnDiscard: true })).toEqual(discard);
    expect(automaticChoice(game([pass, pon], 0), automaticOff)).toBeNull();
    expect(automaticChoice(game([pass, pon], 0), { ...automaticOff, noCalls: true })).toEqual(pass);
    expect(automaticChoice(game([discard, north], 0), automaticOff)).toBeNull();
    expect(automaticChoice(game([discard, north], 0), { ...automaticOff, north: true })).toEqual(north);
    expect(automaticChoice(game([discard, tsumo], 0), { ...automaticOff, win: true })).toEqual(tsumo);
  });
  it('keeps the non-riichi physical drawn tile value supplied by the rack', () => {
    const closed: Choice = { id: 'closed', type: 'discard', value: 's5' };
    expect(automaticChoice(game([closed, discard], 0), { ...automaticOff, drawnDiscard: true }, 's5')).toEqual(closed);
  });
  it('does not answer acknowledgements, empty choices or a final ranking', () => {
    expect(automaticChoice(game([{ id: 'ack', type: 'ack' }]), automaticOff)).toBeNull();
    expect(automaticChoice(game([]), automaticOff)).toBeNull();
    expect(automaticChoice({ ...game([discard]), ranking: [] }, automaticOff)).toBeNull();
  });
});
