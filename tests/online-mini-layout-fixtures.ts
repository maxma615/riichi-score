import assert from "node:assert/strict";
import { scenario } from "./online-interaction-fixtures";
import { drawEngine, playToDraw } from "./legacy/fixtures/mahjong-draw-game";
import { SettlementSequenceGame } from "../src/online/domain/settlement-sequence";
export { scenario };

/** Result payloads come from actual legal actions and complete physical walls. */
export function resultStates() {
  const one = scenario("tsumo", false);
  one.act(0, "tsumo");
  const single = structuredClone(one.view());
  const multiple = scenario("double-ron", false);
  multiple.act(1, "ron");
  multiple.act(2, "ron");
  const first = structuredClone(multiple.view());
  multiple.act(1, "ack");
  const second = structuredClone(multiple.view());
  multiple.act(1, "ack");
  const scores = structuredClone(multiple.view());
  assert.equal(first.game?.settlementFlow?.detailIndex, 0);
  assert.equal(second.game?.settlementFlow?.detailIndex, 1);
  assert.equal(scores.game?.settlementFlow?.stage, "scores");
  const natural = (variant: "yonma" | "sanma") => {
    const count = variant === "yonma" ? 4 : 3;
    const game = new SettlementSequenceGame(drawEngine(variant), count);
    playToDraw(game, count);
    const base = scenario(
      variant === "yonma" ? "riichi" : "nuki-double",
      false,
    ).view();
    return { ...base, mySeat: 0, game: game.view(0) };
  };
  const ranking = {
    ...single,
    status: "finished",
    game: {
      ...single.game!,
      ranking: single.members.map((p, i) => ({
        seat: p.seat,
        rank: i + 1,
        score: 35000 - i * 5000,
      })),
    },
  };
  return [
    { name: "result-tsumo", room: single },
    { name: "result-ron-first", room: first },
    { name: "result-ron-second", room: second },
    { name: "result-scores", room: scores },
    { name: "result-draw-four", room: natural("yonma") },
    { name: "result-draw-three", room: natural("sanma") },
    // Ranking is a layout projection; no claim of a complete-match rule proof.
    { name: "result-ranking", room: ranking },
  ];
}
