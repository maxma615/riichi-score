import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { lookup } from "../src/lookup.js";
import { points } from "../src/scoring.js";
const mini = createRequire(import.meta.url)("../miniprogram/utils/lookup.js");
test("网页和小程序点数矩阵同源，所有合法支付与计分内核一致", () => {
  for (const players of [3, 4])
    for (const dealer of [false, true])
      for (const method of ["ron", "tsumo"])
        for (const honba of [0, 2]) {
          const q = {
              players,
              dealer,
              method,
              honba,
              fu: 40,
              han: 3,
              yakuman: 0,
            },
            view = lookup(q);
          assert.deepEqual(mini.lookup(q), view);
          for (const row of view.rows)
            for (const cell of row.cells) {
              let p;
              try {
                p = points({ ...q, fu: cell.fu, han: cell.han });
              } catch {
                assert.equal(cell.valid, false);
                continue;
              }
              assert.equal(cell.valid, true);
              assert.equal(
                cell.main,
                (method === "ron" ? p.ron : p.child).toLocaleString("en-US"),
              );
              if (method === "tsumo")
                assert.equal(
                  cell.sub,
                  dealer ? "每家" : p.parent.toLocaleString("en-US"),
                );
            }
          assert.equal(
            view.rows.flatMap((r) => r.cells).filter((c) => c.selected).length,
            1,
          );
          for (const c of view.limits)
            assert.equal(
              c.main,
              (method === "ron"
                ? points({ ...q, fu: 30, han: c.han }).ron
                : points({ ...q, fu: 30, han: c.han }).child
              ).toLocaleString("en-US"),
            );
        }
});
test("满贯档位选择不依赖符数，累计役满和多倍役满分别高亮", () => {
  const q = { fu: 25, han: 7, yakuman: 0 };
  assert.equal(lookup(q).limits[1].selected, true);
  assert.equal(lookup({ ...q, han: 13 }).result.selection, "13番 · 累计役满");
  const v = lookup({ ...q, yakuman: 2 });
  assert.equal(v.yakumans[1].selected, true);
  assert.ok(v.limits.every((c) => !c.selected));
});
