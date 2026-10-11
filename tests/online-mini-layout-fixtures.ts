import assert from "node:assert/strict";
import { scenario } from "./online-interaction-fixtures";
import { drawEngine, playToDraw } from "./legacy/fixtures/mahjong-draw-game";
import { SettlementSequenceGame } from "../src/online/domain/settlement-sequence";
import { physicalEngine } from "./legacy/fixtures/mahjong-settlement-game";
import { SanmaGame } from "../src/online/domain/sanma";
import { SanmaWall, sanmaTiles } from "../src/online/domain/sanma-wall";
export { scenario };

/** Four North replacements, three closed kans and a fourth open kan; all
 * physical copies are reserved before dealing filler hands. */
function mixedNorthKanStates() {
  const game = new SanmaGame("east", ["A", "B", "C"], {
    dealer: 0,
    wallFactory: () => {
      const stock = sanmaTiles(),
        take = (tile: string) => {
          const i = stock.indexOf(tile);
          assert.ok(i >= 0, `physical ${tile}`);
          return stock.splice(i, 1)[0];
        };
      const hand = [..."p111222s111z4445".matchAll(/([psz])(\d+)/g)].flatMap(
        (m) => [...m[2]].map((n) => take(m[1] + n)),
      );
      const drawn = take("z4"),
        reserve = ["p1", "p2", "s1", "z5"].map(take),
        donor = take("s2"),
        tail = ["s2", "s2", "s2", "s3"].map(take);
      const indicators = stock.splice(0, 10),
        hands = [hand, [donor, ...stock.splice(0, 12)], stock.splice(0, 13)];
      return new SanmaWall([
        ...hands.flat(),
        drawn,
        ...stock,
        ...tail.reverse(),
        ...reserve,
        ...indicators,
      ]);
    },
  });
  const pass = () => {
    for (let step = 0; step < 10; step++) {
      let acted = false;
      for (let seat = 0; seat < 3; seat++) {
        const v = game.view(seat),
          c = v.choices.find((c) => c.type === "pass");
        if (c) {
          game.respond(seat, v.decisionId, c.id);
          acted = true;
          break;
        }
      }
      if (!acted) return;
    }
    throw Error("Mixed reaction bound exceeded");
  };
  const act = (seat: number, type: string, value?: string, resolve = true) => {
    const v = game.view(seat),
      c = v.choices.find(
        (c) => c.type === type && (value === undefined || c.value === value),
      );
    assert.ok(c, `mixed legal ${seat} ${type} ${value}`);
    game.respond(seat, v.decisionId, c.id);
    if (resolve) pass();
  };
  for (let i = 0; i < 4; i++) act(0, "nuki");
  assert.equal(game.view(0).players[0].nuki, 4);
  const base = scenario("nuki-double", false).view(),
    states = [];
  const capture = (name: string) => {
    for (const mySeat of [0, 1, 2])
      states.push({
        name: `mixed-${name}-viewer-${mySeat}`,
        room: structuredClone({ ...base, mySeat, game: game.view(mySeat) }),
      });
  };
  for (const [i, quad] of ["p1111", "p2222", "s1111"].entries()) {
    act(0, "kan", quad);
    capture(`north-four-kans-${i + 1}`);
  }
  act(0, "discard", "z5");
  act(1, "discard", "s2", false);
  act(0, "kan");
  assert.equal(game.view(0).players[0].melds.length, 4);
  assert.equal(game.view(0).players[0].nuki, 4);
  capture("north-four-kans-4");
  return states;
}

export function tableStates() {
  const late = resultStates()
    .filter((s) => s.name.startsWith("result-draw"))
    .map((s) => ({
      name: s.name.replace("result-draw", "late-river"),
      room: s.room,
    }));
  const game = physicalEngine(
    "yonma",
    { 0: "p123s123456789z1", 1: "p111222333s111z1" },
    "p9",
  );
  const decline = () => {
    for (let step = 0; step < 20; step++) {
      let acted = false;
      for (let seat = 0; seat < 4; seat++) {
        const view = game.view(seat),
          pass = view.choices.find((c) => c.type === "pass");
        if (pass) {
          game.respond(seat, view.decisionId, pass.id);
          acted = true;
          break;
        }
      }
      if (!acted) return;
    }
    throw Error("Reaction bound exceeded");
  };
  const discard = (seat: number, value: string) => {
    const v = game.view(seat),
      c = v.choices.find((c) => c.type === "discard" && c.value === value);
    assert.ok(c, `legal discard ${seat} ${value}`);
    game.respond(seat, v.decisionId, c.id);
  };
  const before: {
    name: string;
    room: ReturnType<ReturnType<typeof scenario>["view"]>;
  }[] = [];
  const base = scenario("riichi", false).view();
  for (const [index, tile] of ["p1", "p2", "p3", "s1"].entries()) {
    decline();
    for (
      let step = 0;
      !game
        .view(0)
        .choices.some((c) => c.type === "discard" && c.value === tile);
      step++
    ) {
      assert.ok(step < 30, "donor next turn");
      let acted = false;
      for (let seat = 1; seat < 4; seat++) {
        const v = game.view(seat),
          c = v.choices.find(
            (c) => c.type === "discard" && c.value?.endsWith("_"),
          );
        if (c) {
          game.respond(seat, v.decisionId, c.id);
          decline();
          acted = true;
          break;
        }
      }
      assert.ok(acted, "other players naturally take their turns");
    }
    discard(0, tile);
    const v = game.view(1),
      pon = v.choices.find((c) => c.type === "pon");
    assert.ok(pon);
    game.respond(1, v.decisionId, pon.id);
    discard(1, ["z1", "p1", "p2", "p3"][index]);
    decline();
    if (index >= 1)
      for (const mySeat of [0, 1, 2, 3])
        before.push({
          name: `melds-${index + 1}-viewer-${mySeat}`,
          room: structuredClone({ ...base, mySeat, game: game.view(mySeat) }),
        });
  }
  assert.equal(before.at(-1)!.room.game!.players[1].melds.length, 4);
  const north = physicalEngine("sanma", { 0: "p123456789s1z444" }, "z4");
  for (let count = 0; count < 4; count++) {
    const v = north.view(0),
      c = v.choices.find((c) => c.type === "nuki");
    assert.ok(c, "each of four physical North tiles can be extracted");
    north.respond(0, v.decisionId, c.id);
  }
  assert.equal(north.view(0).players[0].nuki, 4);
  const northRoom = scenario("nuki-double", false).view();
  const northStates = [0, 1, 2].map((mySeat) => ({
    name: `four-north-viewer-${mySeat}`,
    room: { ...northRoom, mySeat, game: north.view(mySeat) },
  }));
  return [...late, ...before, ...northStates, ...mixedNorthKanStates()];
}

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
  const rankings = ["final-win", "final-win-three"].flatMap((name) => {
    const fixture = scenario(name);
    const before = fixture.view();
    const tsumo = before.game!.choices.find((c) => c.type === "tsumo")!;
    fixture.choose({ id: tsumo.id, decisionId: before.game!.decisionId });
    for (let page = 0; !fixture.view().game!.ranking; page++) {
      assert.ok(page < 3, "Final win settles in detail and scores pages");
      const current = fixture.view().game!;
      const ack = current.choices.find((c) => c.type === "ack")!;
      fixture.choose({ id: ack.id, decisionId: current.decisionId });
    }
    assert.equal(fixture.view().status, "finished");
    assert.ok(fixture.view().game!.ranking!.some((p) => p.score < 0));
    return [0, 1].map((seat) => ({
      name: `result-ranking-${name}-${seat === 0 ? "host" : "member"}`,
      room: structuredClone(fixture.viewFor(seat)),
    }));
  });
  return [
    { name: "result-tsumo", room: single },
    { name: "result-ron-first", room: first },
    { name: "result-ron-second", room: second },
    { name: "result-scores", room: scores },
    { name: "result-draw-four", room: natural("yonma") },
    { name: "result-draw-three", room: natural("sanma") },
    ...rankings,
  ];
}
