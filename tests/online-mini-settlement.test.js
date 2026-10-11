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
} = require("../miniprogram/utils/online-settlement");
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
    new URL("../miniprogram/pages/online/index.js", import.meta.url),
  );
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
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
