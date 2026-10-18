import type { RoomView } from '../domain/types';
import { acceptedSettlementSounds, settlementSoundPhase } from './settlement-sounds';

type CueKind = 'yaku' | 'hand-value' | 'score-roll';
type AudioContext = {
  src: string; autoplay: boolean; loop: boolean; obeyMuteSwitch: boolean; volume: number;
  play(): void; stop(): void; destroy(): void; onError?(listener: () => void): void;
};
type Timer = ReturnType<typeof setTimeout> | number;
type Clock = { now(): number; setTimeout(run: () => void, delay: number): Timer; clearTimeout(timer: Timer): void };
type Options = { sources: Record<CueKind, string>; createInnerAudioContext(): AudioContext; clock?: Clock };
const scope = (room: RoomView) => JSON.stringify([room.id, room.variant, room.mySeat, room.game?.gameInstanceId, room.game?.handId]);

/** Native playback uses exactly the same accepted public events as the browser.
 * The page owns this instance and calls invalidate on hide/reconnect/geometry
 * changes; a subsequent snapshot becomes a silent baseline. No audio is fetched
 * or played until activateFromGesture has been called by a real tap handler. */
export class NativeSettlementAudio {
  private previous: RoomView | null = null;
  private previousAt: number | null = null;
  private enabled = true;
  private activated = false;
  private disposed = false;
  private epoch = 0;
  private timers = new Set<Timer>();
  private contexts = new Map<CueKind, AudioContext>();
  private clock: Clock;
  constructor(private options: Options) {
    this.clock = options.clock ?? {
      now: () => Date.now(),
      setTimeout: (run, delay) => setTimeout(run, delay),
      clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    };
  }
  activateFromGesture() { if (!this.disposed) this.activated = true; }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    // Both directions start with a new baseline; unmuting cannot release cues
    // that arrived while sound was disabled.
    this.invalidate();
  }
  invalidate() {
    this.epoch++;
    for (const timer of this.timers) this.clock.clearTimeout(timer);
    this.timers.clear();
    this.previous = null;
    this.previousAt = null;
    for (const context of this.contexts.values()) { try { context.stop(); } catch { /* Device audio may be unavailable. */ } }
  }
  update(room: RoomView | null, connected: boolean, active = true, live = false) {
    if (this.disposed) return;
    if (!room || !connected || !active) { this.invalidate(); return; }
    const at = this.clock.now();
    let before = this.previous;
    // Successful active polls may skip room versions. The first snapshot after
    // an explicit lifecycle reset or a long request gap is only a baseline.
    if (!live || this.previousAt === null || at - this.previousAt > 5000 || at < this.previousAt) {
      this.invalidate(); before = null;
    }
    if (before && (scope(before) !== scope(room) || settlementSoundPhase(before) !== settlementSoundPhase(room)
      || room.version < before.version)) this.invalidate();
    this.previous = room;
    this.previousAt = at;
    if (!this.enabled || !this.activated) return;
    const phase = settlementSoundPhase(room), generation = this.epoch;
    for (const cue of acceptedSettlementSounds(before, room, {allowVersionGap: true})) {
      if (!['yaku', 'hand-value', 'score-roll'].includes(cue.kind)) continue;
      const kind = cue.kind as CueKind;
      const due = at + cue.atMs - cue.elapsedMs;
      const timer = this.clock.setTimeout(() => {
        this.timers.delete(timer);
        const late = this.clock.now() - due;
        // A suspended/stalled page must never burst several old cues at once.
        if (generation !== this.epoch || this.disposed || !this.enabled || !this.previous
          || settlementSoundPhase(this.previous) !== phase || late < 0 || late > 150
          || this.previousAt === null || this.clock.now() - this.previousAt > 5000) return;
        try {
          let context = this.contexts.get(kind);
          if (!context) {
            context = this.options.createInnerAudioContext();
            context.src = this.options.sources[kind];
            context.autoplay = false; context.loop = false; context.obeyMuteSwitch = true; context.volume = 0.5;
            context.onError?.(() => { /* Sound failure never interrupts settlement or confirms a result. */ });
            this.contexts.set(kind, context);
          }
          context.stop(); context.play();
        } catch { /* Continue the visual presentation on unsupported devices. */ }
      }, Math.max(0, due - at));
      this.timers.add(timer);
    }
  }
  dispose() {
    this.invalidate(); this.disposed = true;
    for (const context of this.contexts.values()) { try { context.destroy(); } catch { /* Best effort device cleanup. */ } }
    this.contexts.clear();
  }
}
