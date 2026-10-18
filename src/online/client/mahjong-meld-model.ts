import Majiang from "@kobalab/majiang-core";

export type MeldSource = "+" | "=" | "-";
export type MeldKind = "chi" | "pon" | "daiminkan" | "kakan" | "ankan";
type CoreShoupai = { valid_mianzi: (meld: string) => string | undefined };

export type MeldSlot =
  | { type: "back"; value: string }
  | { type: "tile"; value: string; sideways: boolean; called?: boolean }
  | { type: "stack"; called: string; added: string };

export type ParsedMeld = {
  kind: MeldKind;
  suit: string;
  source?: MeldSource;
  slots: MeldSlot[];
};

function normalizedRank(rank: string) {
  return rank === "0" ? "5" : rank;
}

function hasOneSuitRank(digits: string[]) {
  return digits.length > 0 && digits.every(rank => normalizedRank(rank) === normalizedRank(digits[0]));
}

function calledSlot(source: MeldSource, size: 3 | 4) {
  if (source === "-") return 0;
  if (source === "=") return 1;
  return size - 1;
}

function reorderWithCalled<T>(tiles: T[], source: MeldSource): T[] {
  const called = tiles[tiles.length - 1];
  const others = tiles.slice(0, -1);
  if (source === "-") return [called, ...others];
  if (source === "=") return [others[0], called, ...others.slice(1)];
  return [...others, called];
}

export function parseMeld(meld: string): ParsedMeld | null {
  // Use the engine's validator as the grammar authority. It also rejects
  // malformed tile counts and non-canonical chi encodings before we read faces.
  const canonical = (Majiang.Shoupai as unknown as CoreShoupai).valid_mianzi(meld);
  if (canonical !== meld) return null;

  const suit = meld[0];
  const digits = meld.match(/\d/g) ?? [];
  // This app's sanma rule allows at most one red five of a suit.
  if (digits.filter(rank => rank === "0").length > 1) return null;
  const markerMatches = [...meld.matchAll(/[+\-=]/g)];
  if (markerMatches.length === 0) {
    if (digits.length !== 4 || !hasOneSuitRank(digits)) return null;
    // A declared closed kan is public. Keep both end tiles face-down and
    // show its identity in the middle, including any physical red five.
    const normal = `${suit}${digits.find(rank => rank !== "0")!}`;
    const firstFace = digits.includes("0") ? `${suit}0` : normal;
    return {
      kind: "ankan",
      suit,
      slots: [
        { type: "back", value: normal },
        { type: "tile", value: firstFace, sideways: false },
        { type: "tile", value: normal, sideways: false },
        { type: "back", value: normal },
      ],
    };
  }
  if (markerMatches.length !== 1) return null;

  const source = markerMatches[0][0] as MeldSource;
  const markerIndex = markerMatches[0].index;
  if (markerIndex === undefined) return null;
  const before = meld.slice(1, markerIndex).match(/\d/g) ?? [];
  const after = meld.slice(markerIndex + 1).match(/\d/g) ?? [];

  // Kakan stores the added fourth tile after the source marker; the called
  // physical tile remains the last tile before the marker (including red 0).
  if (before.length === 3 && after.length === 1 && hasOneSuitRank([...before, ...after])) {
    const called = `${suit}${before[2]}`;
    const added = `${suit}${after[0]}`;
    const sourceIndex = calledSlot(source, 3);
    const slots: MeldSlot[] = [
      { type: "tile", value: `${suit}${before[0]}`, sideways: false },
      { type: "tile", value: `${suit}${before[1]}`, sideways: false },
    ];
    slots.splice(sourceIndex, 0, { type: "stack", called, added });
    return { kind: "kakan", suit, source, slots };
  }

  if (after.length === 0 && before.length === 3 && hasOneSuitRank(before)) {
    const ordered = reorderWithCalled(before.map(rank => `${suit}${rank}`), source);
    return {
      kind: "pon",
      suit,
      source,
      slots: ordered.map((value, index) => ({
        type: "tile",
        value,
        sideways: index === calledSlot(source, 3),
        called: index === calledSlot(source, 3),
      })),
    };
  }

  if (after.length === 0 && before.length === 4 && hasOneSuitRank(before)) {
    const ordered = reorderWithCalled(before.map(rank => `${suit}${rank}`), source);
    return {
      kind: "daiminkan",
      suit,
      source,
      slots: ordered.map((value, index) => ({
        type: "tile",
        value,
        sideways: index === calledSlot(source, 4),
        called: index === calledSlot(source, 4),
      })),
    };
  }

  // In chi notation the marker follows the called tile, so it may appear
  // before the last rank (for example m34-5). Preserve that physical tile
  // first, then the other two ranks in their encoded order.
  if (source === "-" && suit !== "z" && before.length + after.length === 3) {
    const chiDigits = [...before, ...after];
    const sorted = chiDigits.map(normalizedRank).sort();
    if (+sorted[0] + 1 !== +sorted[1] || +sorted[1] + 1 !== +sorted[2]) return null;
    const calledRank = before[before.length - 1];
    const remaining = [...before.slice(0, -1), ...after];
    const ordered = [calledRank, ...remaining];
    return {
      kind: "chi",
      suit,
      source,
      slots: ordered.map((rank, index) => ({
        type: "tile",
        value: `${suit}${rank}`,
        sideways: index === 0,
        called: index === 0,
      })),
    };
  }

  return null;
}

