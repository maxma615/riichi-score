import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { RoomStore } from "../src/online/domain/rooms";
import { SanmaGame } from "../src/online/domain/sanma";
import { SanmaWall, sanmaTiles } from "../src/online/domain/sanma-wall";
import { physicalEngine } from "./legacy/fixtures/mahjong-settlement-game";
import { kakanSoundFixture } from "./legacy/fixtures/mahjong-audio-game";
import { drawEngine, playToDraw } from "./legacy/fixtures/mahjong-draw-game";
import type { PlayerIdentity } from "../src/online/domain/types";

function nukiGame(double = false) {
  return new SanmaGame("east", ["A", "B", "C"], {
    dealer: 0,
    wallFactory: () => {
      const stock = sanmaTiles();
      const take = (tile: string) => {
        const i = stock.indexOf(tile);
        assert.ok(i >= 0);
        return stock.splice(i, 1)[0];
      };
      const code = double ? "p123456789s12z24" : "p123456789s123z2";
      const hand = [...code.matchAll(/([psz])(\d+)/g)]
        .flatMap((m) => [...m[2]].map((n) => m[1] + n))
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
export function scenario(name: string, autoReactions = true) {
  const variant = name.startsWith("nuki") || name === "draw-three" ? "sanma" : "yonma",
    capacity = variant === "sanma" ? 3 : 4;
  const raw = name.startsWith("draw-")
    ? drawEngine(variant)
    : name.startsWith("nuki")
    ? nukiGame(name === "nuki-double")
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
  if (name.startsWith("draw-")) playToDraw(raw, capacity);
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
    if (autoReactions && name === "double-ron" && c.type === "ron") {
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
    if (autoReactions && c.type === "ack")
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
    for (let round = 0; autoReactions && round < 4; round++)
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
  const viewFor = (seat: number) => store.view(players[seat].userId)!;
  const act = (seat: number, type: string, value?: string) => {
    const game = viewFor(seat).game!,
      c = game.choices.find(
        (c) => c.type === type && (value === undefined || c.value === value),
      );
    assert.ok(c);
    execute(seat, {
      action: "respond",
      roomId: created.id,
      decisionId: game.decisionId,
      choiceId: c.id,
    });
    return view();
  };
  return { view, choose, viewFor, act };
}
