// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutomaticPlay } from '../../../src/online/client/use-automatic-play';
import type { Choice, GameView, RoomView } from '../../../src/online/domain/types';

const discard: Choice = { id: 'drawn', type: 'discard', value: 's5_' };
const room = (): RoomView => ({ id: 'room', code: 'code', hostUserId: 'me', variant: 'yonma', mode: 'east', status: 'playing', version: 1, mySeat: 0, members: [], game: {
  gameInstanceId: 'match', handId: 1, decisionId: 'draw-1', phase: 'zimo', roundWind: 0, roundNumber: 1, honba: 0, riichiSticks: 1, remainingTiles: 50,
  doraIndicators: ['z1'], turnSeat: 0, ownRiichi: { han: 1, declarationHan: 0 }, hand: ['s1'], drawnTile: 's5', players: [], choices: [discard], settlement: null, ranking: null,
} });
type Props = Parameters<typeof useAutomaticPlay>[0];
let root: Root;
let props: Props;
let controls: ReturnType<typeof useAutomaticPlay>;
let sent: Choice[];
let visibility: 'visible' | 'hidden';
function Harness(input: Props) { controls = useAutomaticPlay(input); return null; }
const render = (update: Partial<Props> = {}) => { props = { ...props, ...update }; act(() => root.render(createElement(Harness, props))); };
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const setVisibility = (value: 'visible' | 'hidden') => { visibility = value; act(() => document.dispatchEvent(new Event('visibilitychange'))); };

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  root = createRoot(document.createElement('div'));
  sent = [];
  props = { room: room(), ownSeat: 0, connected: true, busy: false, onChoice: choice => sent.push(choice) };
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('automatic play scheduling', () => {
  it('shows an ordinary riichi draw for 650ms then submits it only once', () => {
    render(); advance(649); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([discard]);
    render({ room: { ...props.room, version: 2 } }); advance(2000);
    expect(sent).toEqual([discard]);
  });
  it('waits for drawing and other blocking animations to finish before starting the delay', () => {
    render({ busy: true }); advance(1000); expect(sent).toEqual([]);
    render({ busy: false }); advance(649); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([discard]);
  });
  it('manual input cancels the timer and the same decision is not replayed', () => {
    render(); advance(300); act(() => controls.manual());
    render({ room: { ...props.room, version: 2 } }); advance(2000);
    expect(sent).toEqual([]);
  });
  it('does not submit an old decision when a new draw arrives', () => {
    render(); advance(300);
    const next: Choice = { id: 'new-draw', type: 'discard', value: 's6_' };
    render({ room: { ...props.room, game: { ...props.room.game!, decisionId: 'draw-2', drawnTile: 's6', choices: [next] } } });
    advance(649); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([next]);
  });
  it.each(['kan', 'nuki', 'tsumo', 'ron'] as const)('cancels a pending discard if legal %s appears', type => {
    render(); advance(300);
    render({ room: { ...props.room, game: { ...props.room.game!, choices: [discard, { id: type, type }] } } });
    advance(2000); expect(sent).toEqual([]);
  });
  it('stops offline and starts a full delay after reconnecting', () => {
    render(); advance(300); render({ connected: false }); advance(2000);
    expect(sent).toEqual([]);
    render({ connected: true }); advance(649); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([discard]);
  });
  it('ignores a cancelled callback even after the same decision reconnects', () => {
    const scheduled: (() => void)[] = [];
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay: number) => {
      scheduled.push(callback); return schedule(callback, delay);
    }) as typeof setTimeout);
    render(); const oldCallback = scheduled[scheduled.length - 1];
    render({ connected: false }); render({ connected: true });
    act(() => oldCallback()); expect(sent).toEqual([]);
    advance(649); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([discard]);
  });
  it('stops in the background and starts a full delay on foreground', () => {
    render(); advance(300); setVisibility('hidden'); advance(2000);
    expect(sent).toEqual([]);
    setVisibility('visible'); advance(649); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([discard]);
  });
  it('ignores an already queued callback after pagehide and resumes on pageshow', () => {
    const scheduled: (() => void)[] = [];
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay: number) => {
      scheduled.push(callback); return schedule(callback, delay);
    }) as typeof setTimeout);
    render();
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => scheduled[scheduled.length - 1]());
    expect(sent).toEqual([]);
    act(() => window.dispatchEvent(new Event('pageshow')));
    advance(650); expect(sent).toEqual([discard]);
  });
  it('does not replay a submitted decision when a preference changes', () => {
    render(); advance(650); expect(sent).toEqual([discard]);
    act(() => controls.toggle('north')); advance(2000);
    expect(sent).toEqual([discard]);
  });
  it('allows the next hand to act even when its engine decision ID is reused', () => {
    render(); advance(650); expect(sent).toEqual([discard]);
    render({ room: { ...props.room, game: { ...props.room.game!, handId: 2 } } });
    advance(649); expect(sent).toHaveLength(1);
    advance(1); expect(sent).toEqual([discard, discard]);
  });
  it('resets optional automatic settings on a new hand', () => {
    render({ room: { ...props.room, game: { ...props.room.game!, ownRiichi: { han: 0, declarationHan: 0 } } } });
    act(() => controls.toggle('drawnDiscard')); advance(650);
    expect(sent).toEqual([discard]);
    render({ room: { ...props.room, game: { ...props.room.game!, handId: 2 } } });
    advance(2000); expect(sent).toEqual([discard]);
    expect(controls.options.drawnDiscard).toBe(false);
  });
  it('uses the existing non-riichi win preference and its reveal delay', () => {
    const tsumo: Choice = { id: 'tsumo', type: 'tsumo' };
    const game: GameView = { ...props.room.game!, ownRiichi: { han: 0, declarationHan: 0 }, choices: [discard, tsumo] };
    render({ room: { ...props.room, game } }); advance(1000); expect(sent).toEqual([]);
    act(() => controls.toggle('win')); advance(799); expect(sent).toEqual([]);
    advance(1); expect(sent).toEqual([tsumo]);
  });
  it('passes a pass-only reaction without enabling a preference', () => {
    const pass: Choice = { id: 'pass', type: 'pass' };
    render({ room: { ...props.room, game: { ...props.room.game!, drawnTile: null, choices: [pass] } } });
    advance(0); expect(sent).toEqual([pass]);
  });
});
