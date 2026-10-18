// At most one UI bridge update per frame, and one update awaiting native render.
class DragFrames {
  constructor(host, timers = { setTimeout, clearTimeout }) {
    this.host = host; this.timers = timers; this.epoch = 0;
    this.pending = null; this.timer = null; this.busy = false;
  }
  request(drag) {
    this.pending = drag;
    if (this.timer !== null || this.busy) return;
    this.timer = this.timers.setTimeout(() => { this.timer = null; this.flush(); }, 16);
  }
  flush() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    if (this.busy) return;
    const drag = this.pending, epoch = this.epoch;
    this.pending = null;
    if (!drag || !this.host.currentDrag(drag)) return;
    this.busy = true;
    this.host.renderDrag(drag, () => {
      if (epoch !== this.epoch) return;
      this.busy = false;
      if (this.pending) this.request(this.pending);
    });
  }
  cancel() {
    this.epoch++;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null; this.pending = null; this.busy = false;
  }
}
module.exports = { DragFrames };
