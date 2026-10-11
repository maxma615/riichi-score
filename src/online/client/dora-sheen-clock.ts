export type DoraSheenState = Readonly<{offset: number; speed: number}>;

/** Standard table UV motion; the numeric reference is kept in test fixtures. */
export function advanceDoraSheen(state: DoraSheenState, deltaMs: number): DoraSheenState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const seconds = deltaMs / 1000;
  const speed = state.offset >= -.35 ? state.speed + 2.2 * seconds
    : state.offset >= -.65 ? Math.max(.1, state.speed - 1.6 * seconds) : .3;
  const offset = state.offset - speed * seconds;
  return offset < -1 ? {offset: -.1, speed: 0} : {offset, speed};
}

export type DoraClockHost = Readonly<{
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (id: number) => void;
  active: () => boolean;
  paint: (offset: number) => void;
  listen: (refresh: () => void) => () => void;
}>;

/** One frame loop regardless of how many table faces or portals are mounted. */
export function createDoraSheenClock(host: DoraClockHost) {
  let state: DoraSheenState = {offset: 0, speed: 0};
  let elapsed = 0, subscribers = 0;
  let frame: number | null = null, lastTimestamp: number | null = null;
  let stopListening: (() => void) | null = null;
  const pause = () => {
    if (frame !== null) host.cancelFrame(frame);
    frame = null;
    lastTimestamp = null;
  };
  const refresh = () => {
    if (!subscribers || !host.active()) { pause(); return; }
    if (frame !== null) return;
    frame = host.requestFrame(timestamp => {
      frame = null;
      if (!subscribers || !host.active()) { lastTimestamp = null; return; }
      if (lastTimestamp !== null) {
        const delta = timestamp - lastTimestamp;
        state = advanceDoraSheen(state, delta);
        if (Number.isFinite(delta) && delta > 0) elapsed += delta;
      }
      lastTimestamp = timestamp;
      host.paint(state.offset);
      refresh();
    });
  };
  return {
    snapshot: () => ({...state, elapsed, timestamp: lastTimestamp, subscribers, running: frame !== null}),
    subscribe: () => {
      subscribers++;
      if (subscribers === 1) stopListening = host.listen(refresh);
      host.paint(state.offset);
      refresh();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        subscribers--;
        if (!subscribers) {
          pause();
          stopListening?.();
          stopListening = null;
        }
      };
    },
  };
}

const clocks = new WeakMap<Document, ReturnType<typeof createDoraSheenClock>>();

export function subscribeDocumentDoraSheen(doc: Document, win: Window) {
  let clock = clocks.get(doc);
  if (!clock) {
    const reduced = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    clock = createDoraSheenClock({
      requestFrame: callback => win.requestAnimationFrame(callback),
      cancelFrame: id => win.cancelAnimationFrame(id),
      active: () => doc.visibilityState !== 'hidden' && !reduced?.matches,
      paint: offset => doc.documentElement.style.setProperty('--mahjong-dora-offset', String(offset)),
      listen: refresh => {
        doc.addEventListener('visibilitychange', refresh);
        reduced?.addEventListener?.('change', refresh);
        return () => {
          doc.removeEventListener('visibilitychange', refresh);
          reduced?.removeEventListener?.('change', refresh);
        };
      },
    });
    clocks.set(doc, clock);
  }
  return clock.subscribe();
}

export function documentDoraSheenSnapshot(doc: Document) {
  return clocks.get(doc)?.snapshot() ?? null;
}
