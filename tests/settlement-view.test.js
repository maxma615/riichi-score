import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { defaults, settle } from "../src/scoring.js";
import { roundStatus, settlementView } from "../src/settlement-view.js";
const mini = createRequire(import.meta.url)(
  "../miniprogram/utils/settlement-view.js",
);
const room = (n = 4, honba = 0) => ({
  rules: defaults(n),
  scores: Array(n).fill(defaults(n).start),
  members: Array.from({ length: n }, (_, i) => ({ name: "玩家" + i })),
  dealer: 0,
  hand: 0,
  honba,
  pot: 0,
  history: [],
});
const win = (seat = 0, method = "tsumo") => ({
  kind: "win",
  method,
  winners: [{ seat, han: 3, fu: 30 }],
  loser: 3,
  riichi: [],
});
test("连庄支付使用当前本场，下一局自动加一，网页小程序同源", () => {
  let r = room();
  for (let i = 0; i < 3; i++) {
    const v = settlementView(r, win());
    assert.deepEqual(mini.settlementView(r, win()), v);
    assert.equal(v.rows[1].base, 2000);
    assert.equal(v.rows[1].bonus, i * 100);
    assert.equal(v.rows[1].total, 2000 + i * 100);
    assert.equal(v.rows[0].value, 6000 + i * 300);
    assert.equal(v.next.honba, i + 1);
    assert.equal(v.next.label, `连庄 ${i + 1} 次`);
    const before = r;
    r = settle(r, win()).next;
    r.history.push({ kind: "win", hand: before.hand, honba: before.honba });
    assert.equal(roundStatus(r).repeats, i + 1);
  }
  const down = settlementView(r, win(1));
  assert.equal(down.next.honba, 0);
  assert.equal(down.next.label, "换庄");
});
test("荒牌换庄保留本场，但新庄不显示连庄", () => {
  const r = room(4, 2),
    next = settle(r, { kind: "draw", tenpai: [1], riichi: [] }).next;
  next.history.push({ kind: "draw", hand: 0 });
  assert.equal(next.honba, 3);
  assert.equal(next.dealer, 1);
  assert.equal(roundStatus(next).repeats, 0);
  assert.equal(settlementView(next, win(1)).next.honba, 4);
});
test("四麻三麻的荣和与自摸支付分解逐项相加，包含双响独立符番", () => {
  for (const n of [3, 4])
    for (const honba of [1, 3])
      for (const seat of [0, 1])
        for (const method of ["ron", "tsumo"]) {
          const r = room(n, honba),
            e = { ...win(seat, method), loser: n - 1 },
            v = settlementView(r, e);
          for (const t of v.transfers) {
            assert.equal(t.base + t.bonus, t.total);
            assert.equal(
              t.bonus,
              honba * (method === "ron" ? (n === 3 ? 200 : 300) : 100),
            );
          }
          assert.equal(
            v.rows.reduce((s, x) => s + x.total, 0),
            v.rows[seat].value,
          );
        }
  const r = room(4, 2),
    e = {
      kind: "win",
      method: "ron",
      loser: 3,
      winners: [
        { seat: 0, han: 2, fu: 30 },
        { seat: 1, han: 3, fu: 40 },
      ],
      riichi: [],
    },
    v = settlementView(r, e);
  assert.equal(v.rows[3].base, 8100);
  assert.equal(v.rows[3].bonus, 1200);
  assert.equal(v.rows[3].total, 9300);
});
test("供托和立直单列，不混入基础及本场；流局展示净收支", () => {
  const r = room();
  r.pot = 1;
  r.scores[3] -= 1000;
  const v = settlementView(r, { ...win(1), riichi: [2] });
  assert.equal(v.potIncome, 2000);
  assert.equal(v.rows[2].riichi, 1000);
  assert.equal(v.rows[2].total, 1000);
  assert.equal(v.rows[2].value, -2000);
  assert.equal(v.rows[1].value, 6000);
  assert.equal(
    settlementView(room(), { kind: "abort", riichi: [] }).winning,
    false,
  );
});
