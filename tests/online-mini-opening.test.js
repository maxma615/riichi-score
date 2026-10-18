import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const { snapshot } = require("../archive/native-online/utils/online");
const { acceptedRoundOpening } = require("../archive/native-online/utils/online-opening");
const closed = [
  "m1",
  "m2",
  "m3",
  "p1",
  "p2",
  "p3",
  "p5",
  "s1",
  "s2",
  "s3",
  "z1",
  "z1",
  "z2",
];
const players = Array.from({ length: 4 }, (_, seat) => ({
  seat,
  wind: seat,
  score: 25000,
  discards: [],
  melds: [],
  nuki: 0,
  riichi: false,
  handCount: seat === 0 ? 14 : 13,
}));
const lobby = {
  id: "table",
  variant: "yonma",
  status: "lobby",
  version: 1,
  mySeat: 0,
  members: players.map((p) => ({
    seat: p.seat,
    userId: String(p.seat),
    displayName: "测试" + p.seat,
  })),
  game: null,
};
const room = {
  ...lobby,
  status: "playing",
  version: 2,
  game: {
    gameInstanceId: "game",
    handId: 1,
    decisionId: "d",
    phase: "zimo",
    hand: [...closed, "p4"],
    initialDeal: closed.slice().reverse(),
    drawnTile: "p4",
    players,
    doraIndicators: ["z1"],
    choices: [...new Set(closed)]
      .map((v) => ({ id: "cut-" + v, type: "discard", value: v }))
      .concat([
        { id: "drawn", type: "discard", value: "p4_" },
        { id: "declare", type: "riichi", value: "p1" },
      ]),
  },
};
test("原生发牌按共同波次，理牌保留摸牌实体身份和赤牌校验", () => {
  for (const [age, count] of [
    [0, 4],
    [300, 8],
    [600, 12],
    [900, 14],
  ]) {
    const view = snapshot({ room }, false, age, true);
    assert.equal(view.hand.filter((t) => t.dealVisible).length, count);
    assert.equal(view.seats[1].visibleCount, Math.min(13, count));
    assert.equal(view.openingHolding, true);
    assert.equal(view.doraVisible, false);
  }
  const raw = snapshot({ room }, false, 0, true),
    sorted = snapshot({ room }, false, 1200, true);
  assert.deepEqual(
    raw.hand.slice(0, 13).map((t) => t.value),
    room.game.initialDeal,
  );
  assert.equal(sorted.doraVisible, true);
  assert.equal(sorted.openingHolding, true);
  assert.equal(
    sorted.hand.find((t) => t.physicalKey === "drawn:d").choiceId,
    "drawn",
  );
  assert.deepEqual(
    raw.hand.map((t) => t.physicalKey).sort(),
    sorted.hand.map((t) => t.physicalKey).sort(),
  );
  assert.equal(sorted.hand.at(-1).value, "z2");
  assert.equal(snapshot({ room }, false, 1500, true).openingHolding, false);
  const invalid = {
    ...room,
    game: {
      ...room.game,
      initialDeal: room.game.initialDeal.map((v) => (v === "p5" ? "p0" : v)),
    },
  };
  assert.deepEqual(
    snapshot({ room: invalid }, false, 0, true)
      .hand.slice(0, 13)
      .map((t) => t.value),
    closed,
  );
  assert.equal(acceptedRoundOpening(null, room, true), null);
  assert.equal(acceptedRoundOpening(lobby, room, false), null);
  assert.equal(acceptedRoundOpening(lobby, { ...room, mySeat: 1 }, true), null);
});
function pageHarness() {
  let p,
    now = 0,
    id = 0;
  const tasks = new Map(),
    sent = [];
  const req = createRequire(
    new URL("../archive/native-online/pages/online/index.js", import.meta.url),
  );
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  vm.runInNewContext(
    readFileSync("archive/native-online/pages/online/index.js", "utf8"),
    {
      Page: (v) => (p = v),
      Date: Clock,
      require: (s) => (s === "../../utils/api" ? {} : req(s)),
      setTimeout: (fn, delay) => {
        tasks.set(++id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => tasks.delete(id),
      clearInterval: () => {},
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = (v) => Object.assign(p.data, v);
  p.active = true;
  p.send = async (c) => sent.push(c);
  return { p, tasks, sent, time: (v) => (now = v) };
}
test("原生实时开局锁住输入，仅用单个阶段计时器，结束恢复合法切牌", async () => {
  const { p, tasks, sent, time } = pageHarness();
  p.accept({ room: lobby });
  p.accept({ room }, true);
  assert.equal(p.data.openingHolding, true);
  assert.equal(tasks.size, 1);
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(p.data.selected, -1);
  p.toggleRiichi();
  assert.equal(p.data.riichiMode, false);
  p.touchStart({
    currentTarget: { dataset: { index: 0 } },
    touches: [{ clientY: 200 }],
  });
  assert.equal(p.drag, null);
  assert.equal(sent.length, 0);
  time(1500);
  p.tickOpening();
  assert.equal(p.data.openingHolding, false);
  assert.equal(tasks.size, 0);
  const index = p.data.hand.findIndex((t) => t.physicalKey === "drawn:d");
  await p.discard({ currentTarget: { dataset: { index } } });
  await p.discard({ currentTarget: { dataset: { index } } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].choiceId, "drawn");
});
test("原生初次进入不发牌，后台／尺寸改变取消，旧回调不影响新牌局", () => {
  const fresh = pageHarness();
  fresh.p.accept({ room });
  assert.equal(fresh.p.data.openingHolding, false);
  assert.equal(fresh.tasks.size, 0);
  const { p, tasks, time } = pageHarness();
  p.accept({ room: lobby });
  p.accept({ room }, true);
  const old = [...tasks.values()][0].fn;
  p.onHide();
  assert.equal(tasks.size, 0);
  assert.equal(p.data.openingHolding, false);
  time(500);
  old();
  assert.equal(tasks.size, 0);
  assert.equal(
    p.data.hand.every((t) => t.dealVisible),
    true,
  );
  p.active = true;
  p.accept({ room });
  assert.equal(p.data.openingHolding, false);
  const next = {
    ...room,
    version: 3,
    game: { ...room.game, handId: 2, decisionId: "next" },
  };
  p.accept({ room: next }, true);
  assert.equal(p.data.openingHolding, true);
  old();
  assert.equal(p.data.game.decisionId, "next");
  assert.equal(p.data.hand.filter((t) => t.dealVisible).length, 4);
  p.onResize();
  assert.equal(p.data.openingHolding, false);
  assert.equal(tasks.size, 0);
  p.accept({ room: null });
  assert.equal(p.data.hand.length, 0);
  assert.equal(p.data.openingHolding, false);
});
