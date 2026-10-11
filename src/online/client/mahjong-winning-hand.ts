import Majiang from "@kobalab/majiang-core";
import type { Settlement } from "../domain/types";

type MeldValidator = { valid_mianzi(value: string): string | undefined };

/** Yonma includes the ron tile in its encoded hand; Sanma keeps it separate.
 * Preserve exact physical faces (including red fives), never guess the last tile.
 */
export function winningHand(settlement: Settlement) {
  const [concealed = "", ...encodedMelds] = (settlement.hand ?? "").split(",");
  const closed = [...concealed.matchAll(/([mpsz])(\d+)/g)].flatMap(match => [...match[2]].map(rank => match[1] + rank));
  const melds = encodedMelds.filter(meld => Boolean(meld) && (Majiang.Shoupai as unknown as MeldValidator).valid_mianzi(meld) === meld);
  const tile = settlement.winningTile;
  const expected = 14 - 3 * melds.length;
  if (tile && /^(?:[mps][0-9]|z[1-7])$/.test(tile)) {
    if (closed.length === expected - 1) return { closed, melds, winningTile: tile };
    const index = closed.lastIndexOf(tile);
    if (closed.length === expected && index >= 0) {
      closed.splice(index, 1);
      return { closed, melds, winningTile: tile };
    }
  }
  return { closed, melds, winningTile: undefined };
}

export function settlementTitle(settlement: Settlement) {
  return settlement.kind === "win" && settlement.winMethod === "tsumo" ? "自摸"
    : settlement.kind === "win" && settlement.winMethod === "ron" ? "荣和" : settlement.name;
}
