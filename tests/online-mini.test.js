import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createApp } from "../src/server.js";
const require = createRequire(import.meta.url),
  {
    snapshot,
    tile,
    meld,
    river,
    uuid,
    feedback,
  } = require("../miniprogram/utils/online.js");
test("原生联机牌面、合法动作、拔北与解散状态", () => {
  assert.match(
    uuid(),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.match(tile("s0_").src, /Sou5-Dora.png$/);
  assert.match(tile("z4").src, /Pei.png$/);
  assert.equal(meld("p555+").length, 3);
  const room = {
    id: "r",
    mySeat: 0,
    hostUserId: "a",
    variant: "sanma",
    members: [
      { seat: 0, userId: "a", displayName: "甲", ready: true },
      { seat: 1, userId: "b", displayName: "乙", ready: true },
    ],
    game: {
      roundWind: 0,
      roundNumber: 1,
      decisionId: "d",
      hand: ["p1", "z4", "s0"],
      drawnTile: "s0",
      doraIndicators: ["p2"],
      players: [
        {
          seat: 0,
          wind: 0,
          score: 35000,
          nuki: 2,
          discards: ["p1"],
          melds: ["s123-"],
        },
        { seat: 1, wind: 1, score: 35000, handCount: 13 },
      ],
      choices: [
        { id: "discard", type: "discard", value: "p1" },
        { id: "nuki", type: "nuki", value: "z4" },
        { id: "pon", type: "pon", value: "p555+" },
        { id: "drawn", type: "discard", value: "s0_" },
      ],
    },
  };
  const data = snapshot({ room, serviceRunning: true });
  assert.equal(data.hand.length, 3);
  assert.equal(data.hand[0].choiceId, "discard");
  assert.equal(data.hand[1].choiceId, "");
  assert.equal(data.hand[2].choiceId, "drawn");
  assert.equal(data.seats[0].nuki, 2);
  assert.equal(data.ownMeldCount, 1);
  assert.equal(snapshot({ room: { ...room, mySeat: 1 } }).ownMeldCount, 0);
  assert.equal(snapshot({ room: { ...room, game: { ...room.game, players: [...room.game.players].reverse() } } }).ownMeldCount, 1);
  assert.equal(data.seats[0].north.length, 2);
  assert.ok(data.seats[0].north.every((t) => t.key === "z4"));
  assert.deepEqual(
    data.seats.map((p) => p.edge),
    ["bottom", "right", "left"],
  );
  assert.deepEqual(
    snapshot({ room: { ...room, variant: "yonma", mySeat: 2 } }).seats.map(
      (p) => p.edge,
    ),
    ["top", "left", "bottom", "right"],
  );
  assert.equal(data.seats[1].hidden.length, 13);
  assert.equal(data.actions.length, 2);
  assert.equal(data.actions[1].tiles.length, 3);
  assert.equal(data.actions[0].label, "拔北");
  assert.equal(snapshot({ room: null, serviceRunning: false }).room, null);
  assert.equal(snapshot({ room: null, serviceRunning: false }).ownMeldCount, 0);
});
test("原生小程序真实独立HTTP开桌、重试同nonce、人机准备及解散", async () => {
  mkdirSync(".local/test-data", { recursive: true });
  const dataDir = mkdtempSync(".local/test-data/mini-online-synthetic-");
  const { server, online } = createApp({
    dataDir,
    origin: "http://127.0.0.1:3200",
    wechat: {
      login: async () => ({
        appId: "synthetic-app",
        openid: "synthetic-player",
      }),
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/wechat/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "synthetic" }),
  });
  const { token } = await login.json();
  let failOnce = true,
    p,
    nonces = [],
    errors = [];
  const api = {
    error: (e) => errors.push(e.message),
    api: async (endpoint, method = "GET", body) => {
      if (body) nonces.push(body.nonce);
      const r = await fetch(base + endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await r.json();
      if (!r.ok) throw Object.assign(Error(value.error), { status: r.status });
      if (body?.action === "create" && failOnce) {
        failOnce = false;
        throw Error("synthetic lost response");
      }
      return value;
    },
  };
  const req = createRequire(
    new URL("../miniprogram/pages/online/index.js", import.meta.url),
  );
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
    {
      Page: (v) => (p = v),
      require: (s) => (s === "../../utils/api" ? api : req(s)),
      wx: { showModal: (o) => o.success({ confirm: true }) },
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 2,
      clearTimeout: () => {},
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = function (v) {
    Object.assign(this.data, v);
  };
  p.active = true;
  assert.equal(p.data.variant, "yonma");
  p.setData({ variant: "sanma" });
  try {
    await p.create();
    assert.equal(p.data.room, null);
    assert.equal(errors.length, 1);
    await p.create();
    assert.equal(nonces[0], nonces[1]);
    assert.equal(p.data.room.variant, "sanma");
    assert.ok(p.data.host);
    await p.fill();
    assert.equal(p.data.seats.length, 3);
    await p.ready();
    assert.equal(p.data.allReady, true);
    await p.start();
    assert.ok(p.data.game);
    assert.equal(p.data.hand.length, p.data.game.hand.length);
    await p.send({ action: "finish" });
    assert.equal(p.data.room, null);
    assert.equal(p.data.game, null);
  } finally {
    await online.close();
    await new Promise((r) => server.close(r));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("原生鸣牌展示区分暗杠、加杠与赤牌碰，反馈不跨局重放", () => {
  assert.deepEqual(
    meld("p5555").map((t) => t.back),
    [true, false, false, true],
  );
  const added = meld("p505+5");
  assert.equal(added.length, 4);
  assert.equal(added[2].called, true);
  assert.equal(added[3].added, true);
  assert.ok(added.every((t) => !t.back));
  const base = {
    handId: 1,
    gameInstanceId: "g",
    players: [{ seat: 1, melds: [], nuki: 0, riichi: false }],
  };
  for (const [update, text] of [
    [{ nuki: 1 }, "拔北"],
    [{ riichi: true }, "立直"],
    [{ melds: ["p505+"] }, "碰"],
    [{ melds: ["s1-23"] }, "吃"],
    [{ melds: ["p5555"] }, "杠"],
  ]) {
    const next = { ...base, players: [{ ...base.players[0], ...update }] };
    assert.deepEqual(feedback(base, next), { seat: 1, text });
    assert.equal(feedback(next, next), null);
    assert.equal(feedback(base, { ...next, handId: 2 }), null);
  }
  assert.equal(feedback(null, base), null);
  const won = {
    ...base,
    settlementFlow: { winDeclarations: [{ seat: 1, winMethod: "tsumo" }] },
  };
  assert.deepEqual(feedback(base, won), { seat: 1, text: "自摸" });
  assert.equal(feedback(won, won), null);
});

test("原生拖牌取消、过期选择和忙碌中不提交切牌", async () => {
  let p;
  const sent = [];
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
    {
      Page: (v) => (p = v),
      require: (s) =>
        s === "../../utils/api" ? {} : require("../miniprogram/utils/" + s.split("/").pop() + ".js"),
    },
  );
  p.data = {
    hand: [{ id: 0, choiceId: "cut", decisionId: "d" }],
    game: { decisionId: "d" },
    busy: false,
  };
  p.setData = (v) => Object.assign(p.data, v);
  p.send = async (v) => sent.push(v);
  p.active = true;
  p.dropGeometry = async () => ({ table: { left: 0, right: 400, top: 0, bottom: 180 }, excluded: [] });
  const start = () =>
    p.touchStart({
      currentTarget: { dataset: { index: 0 } },
      touches: [{ clientX: 100, clientY: 200 }],
    });
  const end = () => p.touchEnd({ changedTouches: [{ clientX: 100, clientY: 100 }] });
  start();
  p.touchCancel();
  await end();
  start();
  p.data.game.decisionId = "new";
  await end();
  p.data.game.decisionId = "d";
  start();
  p.data.busy = true;
  await end();
  assert.equal(sent.length, 0);
  p.data.busy = false;
  start();
  await end();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].choiceId, "cut");
  assert.equal(sent[0].decisionId, "d");
});

test("原生牌河移除被鸣走的牌并保留立直横牌，按六张分行", () => {
  const cells = river([
    "p1",
    "p2*+",
    "p3-",
    "p4",
    "s1_",
    "s2",
    "s3",
    "s4",
    "s5",
  ]);
  assert.deepEqual(
    cells.map((t) => t.key),
    ["p1", "p4", "s1", "s2", "s3", "s4", "s5"],
  );
  assert.deepEqual(
    cells.map((t) => t.sideways),
    [false, true, false, false, false, false, false],
  );
  assert.equal(river(["z1*"])[0].sideways, true);
  const data = snapshot({
    room: {
      variant: "yonma",
      mySeat: 0,
      members: [],
      game: {
        players: [
          { seat: 0, discards: ["p1", "p2", "p3", "p4", "p5", "p6", "p7+"] },
        ],
      },
    },
  });
  assert.equal(data.seats[0].riverRows.length, 1);
  assert.equal(data.seats[0].riverRows[0].length, 6);
});

test("原生立直模式只开放宣言牌，区分同张摸牌和赤五", () => {
  const room = {
    id: "r",
    variant: "yonma",
    mySeat: 0,
    members: [],
    game: {
      decisionId: "d",
      hand: ["p5", "s0", "s5", "p5"],
      drawnTile: "p5",
      players: [],
      choices: [
        { id: "closed-discard", type: "discard", value: "p5" },
        { id: "drawn-discard", type: "discard", value: "p5_" },
        { id: "red-discard", type: "discard", value: "s0" },
        { id: "five-discard", type: "discard", value: "s5" },
        { id: "drawn-riichi", type: "riichi", value: "p5_" },
        { id: "five-riichi", type: "riichi", value: "s5" },
      ],
    },
  };
  const normal = snapshot({ room });
  assert.equal(normal.canRiichi, true);
  assert.equal(normal.riichiMode, false);
  assert.ok(normal.actions.every((c) => c.type !== "riichi"));
  const declared = snapshot({ room }, true);
  assert.equal(declared.riichiMode, true);
  assert.deepEqual(
    declared.hand.map((t) => t.choiceId),
    ["", "", "five-riichi", "drawn-riichi"],
  );
  assert.equal(declared.hand.length, room.game.hand.length);
  assert.equal(declared.hand[3].choiceType, "riichi");
  const closedOnly = snapshot(
    {
      room: {
        ...room,
        game: {
          ...room.game,
          choices: [{ id: "closed-riichi", type: "riichi", value: "p5" }],
        },
      },
    },
    true,
  );
  assert.equal(closedOnly.hand[0].choiceId, "closed-riichi");
  assert.equal(closedOnly.hand[3].choiceId, "");
  assert.equal(
    snapshot({ room: { ...room, game: { ...room.game, choices: [] } } }, true)
      .riichiMode,
    false,
  );
  assert.equal(snapshot({ room: null }, true).canRiichi, false);
});

test("原生立直可取消，轮询保持选择模式，换决策与解散清除模式", async () => {
  let p;
  const req = createRequire(
    new URL("../miniprogram/pages/online/index.js", import.meta.url),
  );
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
    {
      Page: (v) => (p = v),
      require: (s) => (s === "../../utils/api" ? {} : req(s)),
      clearTimeout: () => {},
      setTimeout: () => 1,
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = (v) => Object.assign(p.data, v);
  p.active = true;
  const sent = [];
  p.send = async (c) => sent.push(c);
  const room = {
    id: "r",
    variant: "yonma",
    mySeat: 0,
    members: [],
    game: {
      decisionId: "d",
      hand: ["p1", "p2", "p3"],
      drawnTile: null,
      players: [],
      choices: [
        { id: "d1", type: "discard", value: "p1" },
        { id: "d2", type: "discard", value: "p2" },
        { id: "d3", type: "discard", value: "p3" },
        { id: "r2", type: "riichi", value: "p2" },
      ],
    },
  };
  p.accept({ room });
  p.toggleRiichi();
  assert.equal(p.data.riichiMode, true);
  await p.discard({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(p.data.selected, -1);
  p.touchStart({
    currentTarget: { dataset: { index: 1 } },
    touches: [{ clientX: 100, clientY: 200 }],
  });
  p.toggleRiichi();
  assert.equal(p.drag, null);
  assert.equal(p.data.riichiMode, false);
  await p.touchEnd({ changedTouches: [{ clientX: 100, clientY: 100 }] });
  assert.equal(sent.length, 0);
  p.toggleRiichi();
  p.accept({ room });
  assert.equal(p.data.riichiMode, true);
  await p.discard({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(sent.length, 0);
  await p.discard({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].choiceId, "r2");
  assert.equal(sent[0].decisionId, "d");
  p.accept({ room: { ...room, game: { ...room.game, decisionId: "next" } } });
  assert.equal(p.data.riichiMode, false);
  assert.equal(p.data.selected, -1);
  p.toggleRiichi();
  p.accept({ room: null });
  assert.equal(p.data.riichiMode, false);
  assert.equal(p.data.canRiichi, false);
  assert.equal(p.data.hand.length, 0);
});
