import { randomInt } from "node:crypto";

export function sanmaTiles(): string[] {
  return ["m", "p", "s", "z"].flatMap(s =>
    Array.from({ length: s === "z" ? 7 : 9 }, (_, i) => i + 1)
      .filter(n => s !== "m" || n === 1 || n === 9)
      .flatMap(n =>
        Array.from({ length: 4 }, (_, i) => s + (n === 5 && s !== "z" && i === 0 ? 0 : n))
      )
  );
}

/** The ordered fixture is draw order, followed by four reserve tiles and ten
 * fixed alternating dora/ura slots. A replacement refills the reserve from the
 * live tail. Open-kan dora can remain pending without changing physical order. */
export class SanmaWall {
  private live: string[];
  private reserve: string[];
  private indicators: string[];
  private replacements = 0;
  private completedKans = 0;
  private revealedKans = 0;

  constructor(ordered?: string[]) {
    const tiles = ordered?.slice() ?? sanmaTiles();
    if (ordered && tiles.slice().sort().join() !== sanmaTiles().sort().join()) throw new Error("Invalid 108-tile Sanma wall");
    if (!ordered) for (let i = tiles.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    this.live = tiles.slice(0, 94);
    this.reserve = tiles.slice(94, 98);
    this.indicators = tiles.slice(98);
  }

  get remaining() {
    return this.live.length;
  }

  get canReplace() {
    return this.remaining > 0 && this.replacements < 8;
  }

  get canKan() {
    return this.canReplace && this.completedKans < 4;
  }

  get dora() {
    return Array.from({
      length: 1 + this.revealedKans
    }, (_, i) => this.indicators[2 * i]);
  }

  get ura() {
    return Array.from({
      length: 1 + this.revealedKans
    }, (_, i) => this.indicators[2 * i + 1]);
  }

  draw() {
    if (!this.remaining) throw new Error("Live wall exhausted");
    return this.live.shift()!;
  }

  revealPendingKanDora() {
    this.revealedKans = this.completedKans;
  }

  replace(kan: boolean, revealKanIndicator = kan) {
    if (!this.canReplace || (kan && !this.canKan)) throw new Error("Replacement unavailable");
    const tile = this.reserve.shift()!;
    this.reserve.push(this.live.pop()!);
    this.replacements++;
    if (kan) {
      this.completedKans++;
      if (revealKanIndicator) this.revealedKans = this.completedKans;
    }
    return tile;
  }
}
