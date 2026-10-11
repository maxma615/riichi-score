import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { RoomStore } from "../src/online/domain/rooms";
import { SanmaGame } from "../src/online/domain/sanma";
import { SanmaWall, sanmaTiles } from "../src/online/domain/sanma-wall";
import { physicalEngine } from "./legacy/fixtures/mahjong-settlement-game";
import { kakanSoundFixture } from "./legacy/fixtures/mahjong-audio-game";
import type { PlayerIdentity } from "../src/online/domain/types";

function nukiGame() {
  return new SanmaGame("east", ["A", "B", "C"], {
    dealer: 0,
    wallFactory: () => {
      const stock = sanmaTiles();
      const take = (tile: string) => {
        const i = stock.indexOf(tile);
        assert.ok(i >= 0);
        return stock.splice(i, 1)[0];
      };
      const hand = [..."123456789"]
        .map((n) => "p" + n)
        .concat(["s1", "s2", "s3", "z2"])
        .map(take);
      const drawn = take("z4"),
        reserve = [take("z2")];
      const hands = [hand, stock.splice(0, 13), stock.splice(0, 13)];
      reserve.push(...stock.splice(0, 3));
      const indicators = stock.splice(0, 10);
      return new SanmaWall([
        ...hands.flat(),
        drawn,
        ...stock,
        ...reserve,
        ...indicators,
      ]);
    },
  });
}
export function scenario(name: string) {
  const variant = name === "nuki" ? "sanma" : "yonma",
    capacity = variant === "sanma" ? 3 : 4;
  const raw =
    name === "nuki"
      ? nukiGame()
      : name === "kakan"
        ? kakanSoundFixture(false)
        : name === "double-ron"
          ? physicalEngine(
              "yonma",
              { 1: "p123456789s123z2", 2: "p123456789s123z2" },
              "z2",
            )
          : name === "chi"
            ? physicalEngine(
                "yonma",
                { 0: "p1s123456789z123", 1: "p23s123456789z45" },
                "p9",
              )
            : name === "daiminkan"
              ? physicalEngine(
                  "yonma",
                  { 0: "p1s123456789z123", 1: "p111s123456789z4" },
                  "p9",
                )
              : name === "pon"
                ? physicalEngine(
                    "yonma",
                    { 0: "p1s123456789z123", 1: "p11s123456789z45" },
                    "p9",
                  )
                : name === "ankan"
                  ? physicalEngine("yonma", { 0: "p111s123456789z1" }, "p1")
                  : physicalEngine(
                      "yonma",
                      { 0: "p123456789s123z2" },
                      name === "tsumo" ? "z2" : "z3",
                    );
  if (["pon", "chi", "daiminkan", "double-ron"].includes(name)) {
    const v = raw.view(0),
      c = v.choices.find(
        (c) =>
          c.type === "discard" &&
          c.value === (name === "double-ron" ? "z2_" : "p1"),
      );
    assert.ok(c);
    raw.respond(0, v.decisionId, c.id);
  }
  const actor = ["pon", "chi", "daiminkan", "kakan", "double-ron"].includes(
    name,
  )
    ? 1
    : 0;
  const store = new RoomStore({ gameFactory: () => raw });
  const players: PlayerIdentity[] = Array.from(
    { length: capacity },
    (_, seat) => ({ userId: randomUUID(), displayName: "合成玩家" + seat }),
  );
  const execute = (seat: number, body: any) =>
    store.execute(players[seat], { ...body, nonce: randomUUID() });
  const created = execute(0, { action: "create", variant, mode: "east" })!;
  for (let seat = 1; seat < capacity; seat++)
    execute(seat, { action: "join", code: created.code });
  for (let seat = 0; seat < capacity; seat++)
    execute(seat, { action: "ready", ready: true, roomId: created.id });
  execute(0, { action: "start", roomId: created.id });
  const view = () => store.view(players[actor].userId)!;
  function choose(input: { id: string; decisionId: string }) {
    const current = view().game!;
    assert.equal(input.decisionId, current.decisionId);
    const c = current.choices.find((c) => c.id === input.id);
    assert.ok(c);
    execute(actor, {
      action: "respond",
      roomId: created.id,
      decisionId: input.decisionId,
      choiceId: c.id,
    });
    if (name === "double-ron" && c.type === "ron") {
      const other = store.view(players[2].userId)!.game!,
        ron = other.choices.find((c) => c.type === "ron");
      assert.ok(ron);
      execute(2, {
        action: "respond",
        roomId: created.id,
        decisionId: other.decisionId,
        choiceId: ron.id,
      });
    }
    if (c.type === "ack")
      for (let seat = 0; seat < capacity; seat++)
        if (seat !== actor) {
          const other = store.view(players[seat].userId)!.game!;
          const ack = other.choices.find((c) => c.type === "ack");
          if (ack && other.decisionId === input.decisionId)
            execute(seat, {
              action: "respond",
              roomId: created.id,
              decisionId: other.decisionId,
              choiceId: ack.id,
            });
        }
    // Simulate the other human participants declining optional calls, using their real choices.
    for (let round = 0; round < 4; round++)
      for (let seat = 0; seat < capacity; seat++)
        if (seat !== actor) {
          const v = store.view(players[seat].userId)!.game!;
          const pass = v.choices.find((c) => c.type === "pass");
          if (pass)
            execute(seat, {
              action: "respond",
              roomId: created.id,
              decisionId: v.decisionId,
              choiceId: pass.id,
            });
        }
    return view();
  }
  return { view, choose };
}
