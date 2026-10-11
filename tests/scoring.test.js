import { test } from "node:test";
import assert from "node:assert/strict";
import { points, settle, defaults } from "../src/scoring.js";
function state(n = 4) {
  return {
    rules: defaults(n),
    scores: Array(n).fill(n === 4 ? 25000 : 35000),
    dealer: 0,
    hand: 0,
    honba: 0,
    pot: 0,
    history: [],
  };
}
const win = (seat = 1, method = "ron", extra = {}) => ({
  kind: "win",
  method,
  loser: 2,
  winners: [{ seat, fu: 30, han: 3 }],
  ...extra,
});
for (const [han, child, parent] of [
  [1, 1000, 1500],
  [2, 2000, 2900],
  [3, 3900, 5800],
  [4, 7700, 11600],
  [5, 8000, 12000],
  [6, 12000, 18000],
  [8, 16000, 24000],
  [11, 24000, 36000],
  [13, 32000, 48000],
])
  test(`${han}翻30符庄闲荣和`, () => {
    assert.equal(points({ han, fu: 30 }).ron, child);
    assert.equal(points({ han, fu: 30, dealer: true }).ron, parent);
  });
test("各家分别向上取整，不从总数反推", () => {
  const p = points({ fu: 30, han: 3, method: "tsumo" });
  assert.equal(p.child, 1000);
  assert.equal(p.parent, 2000);
  assert.equal(p.total, 4000);
  assert.equal(
    points({ fu: 30, han: 2, dealer: true, method: "tsumo" }).child,
    1000,
  );
});
test("七对子与平和不可达组合拒绝", () => {
  for (const args of [
    { fu: 20, han: 1, method: "tsumo" },
    { fu: 20, han: 2, method: "ron" },
    { fu: 25, han: 1 },
    { fu: 25, han: 2, method: "tsumo" },
    { fu: 110, han: 1, method: "tsumo" },
    { han: 0 },
    { han: 2, fu: 23 },
  ])
    assert.throws(() => points(args));
  assert.equal(points({ fu: 25, han: 2 }).ron, 1600);
  assert.equal(points({ fu: 20, han: 2, method: "tsumo" }).total, 1500);
});
test("切上、累计役满和多倍役满独立设置", () => {
  assert.equal(points({ fu: 30, han: 4, kiriage: true }).ron, 8000);
  assert.equal(points({ fu: 60, han: 3, kiriage: true }).ron, 8000);
  assert.equal(points({ han: 13, kazoe: false }).ron, 24000);
  assert.equal(points({ yakuman: 2, dealer: true }).ron, 96000);
});
test("本场与三麻自摸损", () => {
  assert.equal(points({ han: 3, method: "ron", honba: 2 }).ron, 4500);
  assert.equal(points({ han: 3, players: 3, honba: 2 }).ron, 4300);
  const p = points({ han: 3, players: 3, method: "tsumo", honba: 2 });
  assert.equal(p.total, 3400);
  assert.equal(p.child, 1200);
  assert.equal(p.parent, 2200);
});
test("供托扣除、赢家领回与累计守恒", () => {
  const s = state(),
    r = settle(s, win(1, "ron", { riichi: [0, 1] }));
  assert.deepEqual(r.delta, [-1000, 4900, -3900, 0]);
  assert.equal(r.next.pot, 0);
  assert.equal(r.next.dealer, 1);
  assert.equal(r.next.hand, 1);
});
test("流局保留供托，下局领回", () => {
  let s = settle(state(), { kind: "draw", tenpai: [0], riichi: [1, 2] }).next;
  assert.equal(s.pot, 2);
  assert.equal(s.honba, 1);
  assert.equal(s.dealer, 0);
  s = settle(s, win()).next;
  assert.equal(s.pot, 0);
  assert.equal(
    s.scores.reduce((a, b) => a + b),
    100000,
  );
});
test("庄家和牌连庄，闲家和牌归零本场", () => {
  const s = state();
  s.honba = 3;
  const r = settle(s, win(0));
  assert.equal(r.next.hand, 0);
  assert.equal(r.next.honba, 4);
  assert.equal(settle(s, win(1)).next.honba, 0);
});
for (const n of [3, 4])
  for (let mask = 0; mask < 2 ** n; mask++)
    test(`${n}人听牌分配 ${mask}`, () => {
      const tenpai = Array.from({ length: n }, (_, s) => s).filter(
          (s) => (mask >> s) & 1,
        ),
        r = settle(state(n), { kind: "draw", tenpai });
      assert.equal(
        r.delta.reduce((a, b) => a + b),
        0,
      );
      assert.equal(r.next.hand, tenpai.includes(0) ? 0 : 1);
      assert.equal(r.next.honba, 1);
    });
test("途中流局不换庄，不交换点数，立直供托保留", () => {
  const r = settle(state(), { kind: "abort", riichi: [0] });
  assert.deepEqual(r.delta, [-1000, 0, 0, 0]);
  assert.equal(r.next.pot, 1);
  assert.equal(r.next.hand, 0);
});
test("双响分别支付，供托归头家", () => {
  const s = state();
  s.pot = 1;
  s.scores[0] -= 1000;
  s.honba = 1;
  const r = settle(s, {
    kind: "win",
    method: "ron",
    loser: 0,
    winners: [
      { seat: 2, fu: 30, han: 2 },
      { seat: 1, fu: 40, han: 2 },
    ],
  });
  assert.deepEqual(r.delta, [-5200, 3900, 2300, 0]);
  assert.equal(r.next.pot, 0);
});
test("拒绝重复听牌、重复立直、同座位自摸与放铳", () => {
  assert.throws(() => settle(state(), { kind: "draw", tenpai: [1, 1] }));
  assert.throws(() => settle(state(), win(2)));
  assert.throws(() => settle(state(), win(1, "ron", { riichi: [1, 1] })));
  assert.throws(() =>
    settle(state(), {
      kind: "win",
      method: "tsumo",
      winners: [{ seat: 1 }, { seat: 2 }],
    }),
  );
});
test("点数不足不能投入立直棒，原状态保持", () => {
  const s = state();
  s.scores[1] = 900;
  s.scores[0] += 24100;
  const before = structuredClone(s);
  assert.throws(() => settle(s, win(1, "ron", { riichi: [1] })));
  assert.deepEqual(s, before);
});

test("三家荣和不能按普通多人和牌记分", () => {
  assert.throws(
    () =>
      settle(state(), {
        kind: "win",
        method: "ron",
        loser: 0,
        winners: [1, 2, 3].map((seat) => ({ seat, fu: 30, han: 3 })),
      }),
    /途中流局/,
  );
});
