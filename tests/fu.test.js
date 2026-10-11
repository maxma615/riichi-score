import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateFu } from "../src/fu.js";
for (const [form, raw, fu] of [
  [{}, 30, 30],
  [{ closed: false }, 30, 30],
  [{ method: "tsumo" }, 22, 30],
  [{ method: "tsumo", special: "pinfu" }, 20, 20],
  [{ special: "pinfu" }, 30, 30],
  [{ special: "chiitoitsu" }, 25, 25],
  [
    { pair: 2, wait: 2, melds: [{ type: "closedTriplet", terminal: true }] },
    42,
    50,
  ],
])
  test("算符明细 " + JSON.stringify(form), () => {
    const r = calculateFu(form);
    assert.equal(r.raw, raw);
    assert.equal(r.fu, fu);
    assert.equal(
      r.items.reduce((n, i) => n + i.value, 0),
      raw,
    );
  });
for (const [type, value] of [
  ["openTriplet", 2],
  ["closedTriplet", 4],
  ["openKan", 8],
  ["closedKan", 16],
])
  for (const terminal of [false, true])
    test(type + " " + terminal, () => {
      const r = calculateFu({
        closed: !type.startsWith("open"),
        melds: [{ type, terminal }],
      });
      assert.equal(
        r.raw,
        (type.startsWith("open") ? 20 : 30) + value * (terminal ? 2 : 1),
      );
    });
test("副露平和拒绝与面子上限", () => {
  assert.throws(() => calculateFu({ closed: false, special: "pinfu" }));
  assert.throws(() =>
    calculateFu({
      melds: Array(5).fill({ type: "openTriplet", terminal: false }),
    }),
  );
  assert.throws(() =>
    calculateFu({ melds: [{ type: "fake", terminal: true }] }),
  );
});
