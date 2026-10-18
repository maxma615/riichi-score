import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const {
  hanLabel,
  winning,
  presentation,
} = require("../archive/native-online/utils/online-settlement");
const seats = Array.from({ length: 4 }, (_, seat) => ({
  seat,
  name: "玩家" + seat,
  score: 25000,
}));
const result = {
  kind: "win",
  name: "和了",
  winnerSeat: 0,
  winMethod: "ron",
  han: 3,
  fu: 40,
  points: 5200,
  hand: "m123p123s123z11122",
  winningTile: "z2",
  yaku: [{ name: "役牌", han: 1 }],
  delta: [5200, -5200, 0, 0],
  uraIndicators: ["s4"],
};
test("原生结算只翻译展示役名，保留引擎名称、番数及收支", () => {
  const original = {
    ...result, yaku: [{ name: "一気通貫", han: 2 }, { name: "抜きドラ", han: 1 }],
  };
  const before = structuredClone(original);
  const shown = presentation({ settlement: original }, seats, 10000);
  assert.deepEqual(shown.yaku.map((y) => [y.name, y.han, y.label]),
    [["一气通贯", 2, "2番"], ["拔北宝牌", 1, "1番"]]);
  assert.deepEqual(original, before);
  assert.equal(shown.points, original.points);
  assert.deepEqual(shown.delta, original.delta);
  assert.equal(presentation({ settlement: { ...original, kind: "draw", name: "九種九牌" } }, seats).title, "九种九牌");
});
test("原生多人结算的滚动锚点随赢家及收支阶段切换，计时更新不跳回顶部", () => {
  const game = {
    settlement: result,
    settlementFlow: {
      id: "real-flow",
      stage: "detail",
      detailIndex: 0,
      detailCount: 2,
      elapsedMs: 2000,
      oldScores: [25000, 25000, 25000, 25000],
      delta: [5200, -5200, 0, 0],
      newScores: [30200, 19800, 25000, 25000],
    },
  };
  const first = presentation(game, seats, 2000);
  assert.equal(presentation(game, seats, 2500).anchor, first.anchor);
  const next = presentation(
    { ...game, settlementFlow: { ...game.settlementFlow, detailIndex: 1 } },
    seats,
    2000,
  );
  assert.notEqual(next.anchor, first.anchor);
  const scores = presentation(
    { ...game, settlementFlow: { ...game.settlementFlow, stage: "scores" } },
    seats,
    2000,
  );
  assert.notEqual(scores.anchor, next.anchor);
  assert.match(first.anchor, /^[a-z][a-zA-Z0-9_-]*$/);
});
test("原生和牌张拆分保持四麻／三麻和赤牌的真实张数", () => {
  const yonma = winning(result);
  assert.equal(yonma.hand.length, 13);
  assert.equal(yonma.winningTile.key, "z2");
  const sanma = winning({ ...result, hand: "m123p123s123z1112" });
  assert.equal(sanma.hand.length, 13);
  assert.equal(sanma.winningTile.key, "z2");
  const red = winning({
    ...result,
    hand: "m123p123s123z111s50",
    winningTile: "s0",
  });
  assert.equal(red.hand.length, 13);
  assert.equal(red.hand.filter((t) => t.key === "s5").length, 1);
  assert.equal(red.hand.filter((t) => t.key === "s0").length, 0);
  assert.equal(red.winningTile.key, "s0");
  assert.equal(winning({ ...result, winningTile: "s0" }).winningTile, null);
  const open = winning({
    ...result,
    hand: "p12344,m111+,s222=,z333-",
    winningTile: "p4",
  });
  assert.equal(open.hand.length, 4);
  assert.equal(open.exposed.length, 3);
});
test("原生分阶段收支使用多人荣和累计支付且只展示当前赢家详情", () => {
  const flow = {
    id: "multi",
    stage: "detail",
    detailIndex: 1,
    detailCount: 2,
    oldScores: [25000, 25000, 25000, 25000],
    delta: [5200, -9200, 0, 4000],
    newScores: [30200, 15800, 25000, 29000],
  };
  const game = {
    decisionId: "d",
    settlement: { ...result, winnerSeat: 3, delta: [0, -4000, 0, 4000] },
    settlementFlow: flow,
    doraIndicators: ["p2"],
  };
  const detail = presentation(game, seats);
  assert.equal(detail.winner, "玩家3");
  assert.equal(detail.progress, "第2位 · 共2位");
  assert.equal(detail.stage, "detail");
  assert.equal(detail.ura[0].key, "s4");
  const scores = presentation(
    { ...game, settlementFlow: { ...flow, stage: "scores" } },
    seats,
    5000,
  );
  assert.equal(scores.title, "点数结算");
  assert.deepEqual(
    scores.changes.map((p) => p.value),
    [5200, -9200, 0, 4000],
  );
  assert.deepEqual(
    scores.changes.map((p) => p.before),
    flow.oldScores,
  );
  assert.deepEqual(
    scores.changes.map((p) => p.after),
    flow.newScores,
  );
  assert.equal(
    presentation(
      { ...game, ranking: [{ seat: 3, rank: 1, score: 29000 }] },
      seats,
    ),
    null,
  );
  assert.equal(presentation(null, seats), null);
});
test("原生役满与流局公开手牌不显示错误番数或未公开手牌", () => {
  assert.equal(hanLabel("**"), "2倍役满");
  assert.equal(hanLabel("*"), "役满");
  assert.equal(hanLabel(5), "5番");
  assert.equal(hanLabel("役満"), "役满");
  const yakuman = presentation(
    {
      settlement: {
        ...result,
        han: undefined,
        fu: undefined,
        yaku: [
          { name: "字一色", han: "*" },
          { name: "大四喜", han: "**" },
        ],
      },
    },
    seats,
  );
  assert.equal(yakuman.hanLabel, "3倍役满");
  assert.deepEqual(
    yakuman.yaku.map((y) => y.label),
    ["役满", "2倍役满"],
  );
  const draw = presentation(
    {
      decisionId: "draw",
      settlement: {
        kind: "draw",
        name: "荒牌流局",
        yaku: [],
        delta: [1500, -1500, 1500, -1500],
        tenpaiSeats: [0, 2],
        uraIndicators: [],
        drawInfo: {
          kind: "exhaustive",
          revealedHands: [
            { seat: 0, hand: "m123p123s123z1112", waits: ["z2"] },
          ],
          nagashiResults: [],
        },
      },
      settlementFlow: {
        id: "draw",
        stage: "draw",
        detailIndex: 0,
        detailCount: 1,
        oldScores: seats.map((p) => p.score),
        newScores: [26500, 23500, 26500, 23500],
        delta: [1500, -1500, 1500, -1500],
      },
    },
    seats,
  );
  assert.equal(draw.stage, "draw");
  assert.deepEqual(
    draw.drawPlayers.map((p) => p.tenpai),
    [true, false, true, false],
  );
  assert.equal(draw.drawPlayers[0].hand.length, 13);
  assert.equal(draw.drawPlayers[0].waits[0].key, "z2");
  assert.ok(
    draw.drawPlayers
      .slice(1)
      .every((p) => p.hand.length === 0 && p.waits.length === 0),
  );
});
test("原生结算继续按钮提交当前合法ack，新阶段和解散清掉旧ack", async () => {
  let page;
  const commands = [];
  const req = createRequire(
    new URL("../archive/native-online/pages/online/index.js", import.meta.url),
  );
  vm.runInNewContext(
    readFileSync("archive/native-online/pages/online/index.js", "utf8"),
    {
      Page: (p) => (page = p),
      require: (s) =>
        s === "../../utils/api"
          ? {
              api: async (path, method, body) => {
                commands.push(body);
                return { room: null };
              },
              error: (e) => {
                throw e;
              },
            }
          : req(s),
      clearTimeout: () => {},
      setTimeout: () => 1,
    },
  );
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = (v) => Object.assign(page.data, v);
  page.active = true;
  const room = {
    id: "r",
    variant: "yonma",
    mySeat: 0,
    hostUserId: "0",
    members: seats.map((p) => ({
      seat: p.seat,
      userId: String(p.seat),
      displayName: p.name,
    })),
    game: {
      decisionId: "first",
      hand: [],
      drawnTile: null,
      players: seats.map((p) => ({ ...p, discards: [], melds: [] })),
      choices: [{ id: "ack-1", type: "ack" }],
      settlement: result,
    },
  };
  page.accept({ room });
  assert.equal(page.data.actions.length, 0);
  assert.equal(page.data.settlementAck.id, "ack-1");
  page.accept({
    room: {
      ...room,
      game: {
        ...room.game,
        decisionId: "next",
        choices: [{ id: "ack-2", type: "ack" }],
      },
    },
  });
  await page.continueSettlement();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].choiceId, "ack-2");
  assert.equal(commands[0].decisionId, "next");
  assert.equal(page.data.settlement, null);
  assert.equal(page.data.settlementAck, null);
  await page.continueSettlement();
  assert.equal(commands.length, 1);
});

test("原生结算先展示役种再显示点数，分数变化只用共同时间内核", () => {
  const flow = {
    id: "f",
    stage: "detail",
    detailIndex: 0,
    detailCount: 1,
    elapsedMs: 0,
    oldScores: seats.map((p) => p.score),
    delta: [3300, -3300, 0, 0],
    newScores: [28300, 21700, 25000, 25000],
    winDeclarations: [{ seat: 0, winMethod: "ron" }],
  };
  const game = { settlement: result, settlementFlow: flow };
  const intro = presentation(game, seats, 1199);
  assert.equal(intro.visible, false);
  const first = presentation(game, seats, 1500);
  assert.equal(first.visible, true);
  assert.equal(first.yaku[0].visible, true);
  assert.equal(first.pointsVisible, false);
  assert.equal(first.ready, false);
  const revealed = presentation(game, seats, 2100);
  assert.equal(revealed.pointsVisible, true);
  assert.equal(revealed.ready, false);
  assert.equal(presentation(game, seats, 2700).ready, true);
  assert.equal(presentation(game, seats, 2700).countdown, 3);
  assert.equal(presentation(game, seats, 5700).countdown, 0);
  const scores = { ...game, settlementFlow: { ...flow, stage: "scores" } };
  assert.deepEqual(
    presentation(scores, seats, 1199).changes.map((p) => p.after),
    flow.oldScores,
  );
  assert.deepEqual(
    presentation(scores, seats, 1200).changes.map((p) => p.after),
    [25100, 24900, 25000, 25000],
  );
  assert.deepEqual(
    presentation(scores, seats, 2160).changes.map((p) => p.after),
    flow.newScores,
  );
  assert.equal(presentation(scores, seats, 4499).ready, false);
  assert.equal(presentation(scores, seats, 4500).ready, true);
});

test("原生结算时钟不重放旧阶段，后台停止且自动确认失败后同nonce手动重试", async () => {
  let p,
    now = 0,
    serial = 0,
    fail = true;
  const tasks = new Map(),
    commands = [],
    errors = [];
  const req = createRequire(
    new URL("../archive/native-online/pages/online/index.js", import.meta.url),
  );
  class TestDate extends Date {
    static now() {
      return now;
    }
  }
  vm.runInNewContext(
    readFileSync("archive/native-online/pages/online/index.js", "utf8"),
    {
      Page: (v) => (p = v),
      Date: TestDate,
      require: (s) =>
        s === "../../utils/api"
          ? {
              error: (e) => errors.push(e.message),
              api: async (path, method, body) => {
                commands.push({ ...body });
                if (fail) {
                  fail = false;
                  throw Error("synthetic lost ack response");
                }
                return { room: null };
              },
            }
          : req(s),
      setTimeout: (fn, delay) => {
        const id = ++serial;
        tasks.set(id, { fn, due: now + delay });
        return id;
      },
      clearTimeout: (id) => tasks.delete(id),
      clearInterval: () => {},
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = (v) => Object.assign(p.data, v);
  p.active = true;
  const flow = {
    id: "clock",
    stage: "scores",
    detailIndex: 0,
    detailCount: 1,
    elapsedMs: 0,
    oldScores: seats.map((p) => p.score),
    delta: result.delta,
    newScores: [30200, 19800, 25000, 25000],
  };
  const room = {
    id: "r",
    variant: "yonma",
    mySeat: 0,
    members: seats.map((p) => ({
      seat: p.seat,
      userId: String(p.seat),
      displayName: p.name,
    })),
    game: {
      decisionId: "a",
      players: seats.map((p) => ({ ...p, discards: [], melds: [] })),
      hand: [],
      choices: [{ type: "ack", id: "old" }],
      settlement: result,
      settlementFlow: flow,
    },
  };
  p.accept({ room });
  assert.equal(p.data.settlement.ready, false);
  await p.continueSettlement();
  assert.equal(commands.length, 0);
  const stale = [...tasks.values()][0].fn;
  now = 1500;
  p.tickResult();
  const score = p.data.settlement.changes[0].after;
  now = 1000;
  p.tickResult();
  assert.equal(p.data.settlement.changes[0].after, score);
  p.onHide();
  assert.equal(tasks.size, 0);
  assert.equal(p.resultAnchor.baselineAge, Infinity);
  now = 8000;
  stale();
  assert.equal(commands.length, 0);
  p.active = true;
  p.accept({
    room: {
      ...room,
      game: {
        ...room.game,
        decisionId: "b",
        choices: [{ type: "ack", id: "current" }],
        settlementFlow: { ...flow, id: "new", elapsedMs: 0 },
      },
    },
  });
  stale();
  assert.equal(commands.length, 0);
  now = 15500;
  p.tickResult();
  await new Promise(setImmediate);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].choiceId, "current");
  assert.equal(errors.length, 1);
  p.tickResult();
  assert.equal(commands.length, 1);
  await p.continueSettlement();
  assert.equal(commands.length, 2);
  assert.equal(commands[0].nonce, commands[1].nonce);
  assert.equal(p.data.settlement, null);
  assert.equal(tasks.size, 0);
});

test("流局先按公开时点翻牌，再显示汇总；未公开手牌不被补出且换局清空", () => {
  const positioned = seats.map((p, i) => ({
    ...p,
    edge: ["bottom", "right", "top", "left"][i],
  }));
  const draw = {
    kind: "draw",
    name: "荒牌流局",
    yaku: [],
    delta: [-1000, 3000, -1000, -1000],
    tenpaiSeats: [1],
    uraIndicators: [],
    drawInfo: {
      kind: "exhaustive",
      revealedHands: [
        { seat: 1, hand: "m123p123s123z1112", waits: ["z2"] },
        { seat: 99, hand: "m111", waits: [] },
      ],
      nagashiResults: [],
    },
  };
  const game = {
    decisionId: "draw",
    settlement: draw,
    settlementFlow: {
      id: "draw-flow",
      stage: "draw",
      detailIndex: 0,
      detailCount: 1,
      oldScores: [25000, 25000, 25000, 25000],
      newScores: [24000, 28000, 24000, 24000],
      delta: draw.delta,
    },
  };
  const early = presentation(game, positioned, 999);
  assert.deepEqual(early.tableReveals, {});
  assert.equal(early.visible, false);
  const turning = presentation(game, positioned, 1000);
  assert.equal(turning.visible, false);
  assert.deepEqual(Object.keys(turning.tableReveals), ["1"]);
  assert.equal(turning.tableReveals[1].hand.length, 13);
  assert.equal(turning.tableReveals[1].animate, true);
  assert.equal(
    presentation(game, positioned, 1100, 1100).tableReveals[1].animate,
    false,
  );
  assert.equal(
    presentation(game, positioned, 1100, Infinity).tableReveals[1].animate,
    false,
  );
  assert.equal(
    presentation(game, positioned, 1000, 999).tableReveals[1].animate,
    true,
  );
  assert.equal(turning.drawPlayers.find((p) => p.seat === 2).hand.length, 0);
  const settled = presentation(game, positioned, 1300);
  assert.equal(settled.tableReveals[1].animate, false);
  assert.equal(settled.tableReveals[1].key, turning.tableReveals[1].key);
  assert.equal(presentation(game, positioned, 2000).visible, true);
  const scores = presentation(
    { ...game, settlementFlow: { ...game.settlementFlow, stage: "scores" } },
    positioned,
    0,
  );
  assert.equal(scores.tableReveals[1].animate, false);
  assert.equal(scores.tableReveals[1].hand.length, 13);
  assert.equal(presentation({ decisionId: "new-hand" }, positioned, 0), null);
  assert.equal(presentation({ ...game, ranking: [] }, positioned, 1000), null);
});

test("途中流局声明按原时间内核和实际座位展示，不猜四家立直或三家荣和的演员", () => {
  const positioned = seats.map((p, i) => ({
    ...p,
    edge: ["bottom", "right", "top", "left"][i],
  }));
  const make = (name, meta) => ({
    settlement: {
      kind: "draw",
      name,
      yaku: [],
      delta: [0, 0, 0, 0],
      tenpaiSeats: [],
      uraIndicators: [],
      drawInfo: {
        kind: "abort",
        abortPresentation: meta,
        revealedHands: [{ seat: 1, hand: "p123456789s123z2", waits: [] }],
        nagashiResults: [],
      },
    },
    settlementFlow: {
      id: name,
      stage: "draw",
      detailIndex: 0,
      detailCount: 1,
      oldScores: [25000, 25000, 25000, 25000],
      newScores: [25000, 25000, 25000, 25000],
      delta: [0, 0, 0, 0],
    },
  });
  const riichi = make("四家立直", { riichiSeat: 3, ronSeats: [] });
  assert.equal(
    presentation(riichi, positioned, 299).drawDeclarations.length,
    0,
  );
  assert.deepEqual(
    presentation(riichi, positioned, 300).drawDeclarations.map((p) => [
      p.seat,
      p.text,
      p.edge,
    ]),
    [[3, "立直", "left"]],
  );
  assert.equal(
    presentation(riichi, positioned, 999).tableReveals[1],
    undefined,
  );
  assert.equal(
    presentation(riichi, positioned, 1000).drawDeclarations.length,
    0,
  );
  assert.equal(
    presentation(riichi, positioned, 1000).tableReveals[1].animate,
    true,
  );
  const triple = make("三家和", { ronSeats: [1, 2, 3, 99] });
  assert.equal(
    presentation(triple, positioned, 799).drawDeclarations.length,
    0,
  );
  assert.deepEqual(
    presentation(triple, positioned, 800).drawDeclarations.map((p) => p.seat),
    [1, 2, 3],
  );
  assert.equal(
    presentation(triple, positioned, 1700).drawDeclarations.length,
    0,
  );
  assert.equal(
    presentation(triple, positioned, 1999).tableReveals[1],
    undefined,
  );
  assert.equal(
    presentation(triple, positioned, 2000).tableReveals[1].animate,
    true,
  );
  assert.equal(presentation(triple, positioned, 3000).visible, true);
  assert.equal(presentation(triple, positioned, 3999).ready, false);
  assert.equal(presentation(triple, positioned, 4000).ready, true);
  assert.equal(
    presentation(make("三家和", undefined), positioned, 800).drawDeclarations
      .length,
    0,
  );
});

test("多人荣和开场同时标明真实赢家，详情阶段不重演声明", () => {
  const positioned = seats.map((p, i) => ({
    ...p,
    edge: ["bottom", "right", "top", "left"][i],
  }));
  const flow = {
    id: "double",
    stage: "detail",
    detailIndex: 0,
    detailCount: 2,
    oldScores: [25000, 25000, 25000, 25000],
    newScores: [19800, 27600, 27600, 25000],
    delta: [-5200, 2600, 2600, 0],
    winDeclarations: [
      { seat: 1, winMethod: "ron" },
      { seat: 2, winMethod: "ron" },
    ],
  };
  const game = { settlement: result, settlementFlow: flow };
  assert.deepEqual(
    presentation(game, positioned, 0).declarations.map((d) => [
      d.seat,
      d.text,
      d.edge,
    ]),
    [
      [1, "荣和", "right"],
      [2, "荣和", "top"],
    ],
  );
  assert.equal(presentation(game, positioned, 1199).declarations.length, 2);
  assert.equal(presentation(game, positioned, 1200).declarations.length, 0);
  assert.equal(
    presentation(
      { ...game, settlementFlow: { ...flow, detailIndex: 1 } },
      positioned,
      0,
    ).declarations.length,
    0,
  );
  assert.equal(
    presentation(
      { ...game, settlementFlow: { ...flow, stage: "scores" } },
      positioned,
      0,
    ).declarations.length,
    0,
  );
});
