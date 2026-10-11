import { describe, expect, it } from "vitest";
import { chooseBotChoice, fallbackBotChoice } from "../../../src/online/domain/bot-strategy";
import type { Choice, GameView } from "../../../src/online/domain/types";

function view(hand: string[], choices: Choice[]): GameView {
  return {
    decisionId: "test:1", phase: "zimo", roundWind: 0, roundNumber: 1, honba: 0,
    riichiSticks: 0, remainingTiles: 40, doraIndicators: [], turnSeat: 0, hand,
    drawnTile: hand.at(-1) ?? null, choices, settlement: null, ranking: null,
    players: [0, 1, 2, 3].map(seat => ({ seat, wind: seat, score: 25000, handCount: 13, discards: [], melds: [], riichi: false })),
  };
}
const tiles = (s: string) => [...s.matchAll(/([mpsz])(\d+)/g)].flatMap(m => [...m[2]].map(n => m[1] + n));
const discardChoices = (hand: string[]): Choice[] => [...new Set(hand)].map(value => ({ id: `discard:${value}`, type: "discard", value }));

describe("bounded computer strategy using only its seat view", () => {
  it.each(["tsumo", "ron"] as const)("always chooses legal %s before other actions", type => {
    const game = view(tiles("p123s456z11"), [{ id: "pass", type: "pass" }, { id: type, type }]);
    expect(chooseBotChoice(game, "yonma", 0)).toBe(type);
    expect(fallbackBotChoice(game)).toBe(type);
  });

  it("discards an isolated honor to reach tenpai instead of blindly discarding the drawn tile", () => {
    const hand = tiles("m123p123s12456z117");
    const game = view(hand, discardChoices(hand));
    const before = JSON.stringify(game);
    expect(chooseBotChoice(game, "yonma", 0)).toBe("discard:z7");
    expect(JSON.stringify(game)).toBe(before);
  });

  it("folds with public genbutsu against opponent riichi and does not treat itself as a threat", () => {
    const hand = tiles("m147p147s147z12345");
    const game = view(hand, [{ id: "safe", type: "discard", value: "p4" }, { id: "unsafe", type: "discard", value: "z5" }]);
    game.players[1].riichi = true;
    game.players[1].discards = ["p4*"];
    expect(chooseBotChoice(game, "yonma", 0)).toBe("safe");
    game.players[1].riichi = false;
    const withoutThreat = chooseBotChoice(game, "yonma", 0);
    game.players[0].riichi = true;
    expect(chooseBotChoice(game, "yonma", 0)).toBe(withoutThreat);
  });

  it("counts visible outs and retains dora when shanten is equal", () => {
    const hand = tiles("m123p123s123z1117s2");
    const game = view(hand, discardChoices(hand));
    expect(chooseBotChoice(game, "yonma", 0)).toBe("discard:s2");
    game.players[1].discards = ["z7", "z7", "z7"];
    expect(chooseBotChoice(game, "yonma", 0)).toBe("discard:z7");
    game.players[1].discards = [];
    game.doraIndicators = ["s1"];
    expect(chooseBotChoice(game, "yonma", 0)).toBe("discard:z7");
  });

  it("selects legal north extraction and riichi with a sound discard", () => {
    expect(chooseBotChoice(view(tiles("z4"), [{ id: "north", type: "nuki" }, { id: "cut", type: "discard", value: "z4" }]), "sanma", 0)).toBe("north");
    const hand = tiles("m123p123s12456z117");
    const game = view(hand, [...discardChoices(hand), { id: "declare", type: "riichi", value: "z7" }]);
    expect(chooseBotChoice(game, "yonma", 0)).toBe("declare");
  });

  it("calls an improving value-honor pon but passes a no-yaku opening", () => {
    const game = view(tiles("m123p123s12z55123"), [{ id: "pon", type: "pon", value: "z555+" }, { id: "pass", type: "pass" }]);
    game.drawnTile = null;
    expect(chooseBotChoice(game, "yonma", 0)).toBe("pon");
    const noYaku = view(tiles("m123p123s12z22134"), [{ id: "pon", type: "pon", value: "z222+" }, { id: "pass", type: "pass" }]);
    noYaku.drawnTile = null;
    expect(chooseBotChoice(noYaku, "yonma", 0)).toBe("pass");
  });

  it("uses a legal concealed kan without worsening the hand", () => {
    const hand = tiles("m1111p123s123z1123");
    const game = view(hand, [...discardChoices(hand), { id: "kan", type: "kan", value: "m1111" }]);
    expect(chooseBotChoice(game, "yonma", 0)).toBe("kan");
  });

  it("keeps fallback cheap and legal, including pass and settlement confirmation", () => {
    expect(fallbackBotChoice(view([], [{ id: "call", type: "pon", value: "z111+" }, { id: "pass", type: "pass" }]))).toBe("pass");
    expect(fallbackBotChoice(view([], [{ id: "ack", type: "ack" }]))).toBe("ack");
    expect(() => fallbackBotChoice(view([], []))).toThrow();
  });
});
