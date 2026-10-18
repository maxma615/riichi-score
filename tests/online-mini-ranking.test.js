import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build, transform } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import vm from "node:vm";
mkdirSync(".local/test-data", { recursive: true });
const compiled = path.resolve(
  `.local/test-data/native-ranking-${process.pid}.mjs`,
);
await build({
  entryPoints: ["tests/online-interaction-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: compiled,
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
const { scenario } = await import(pathToFileURL(compiled));
after(() => rmSync(compiled, { force: true }));
const req = createRequire(
  new URL("../archive/native-online/pages/online/index.js", import.meta.url),
);
const { rankingPresentation } = req("../../utils/online-ranking");
const timing = req("../../utils/online-ranking-timing");
function page(fixture) {
  let p,
    now = Date.now(),
    timerId = 0;
  const tasks = new Map();
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const sent = [],
    errors = [];
  vm.runInNewContext(
    readFileSync("archive/native-online/pages/online/index.js", "utf8"),
    {
      Page: (value) => (p = value),
      Date: Clock,
      require: (s) =>
        s === "../../utils/api"
          ? {
              api: async (url, method, body) => {
                assert.equal(url, "/api/online");
                assert.equal(method, "POST");
                assert.equal(body.roomId, fixture.view().id);
                sent.push({ ...body });
                const room =
                  body.action === "respond"
                    ? fixture.choose({
                        id: body.choiceId,
                        decisionId: body.decisionId,
                      })
                    : fixture.roomCommand(body.action);
                return { room: room ?? null, serviceRunning: true };
              },
              error: (e) => errors.push(e),
            }
          : req(s),
      setTimeout: (callback, delay) => {
        tasks.set(++timerId, { callback, at: now + delay });
        return timerId;
      },
      clearTimeout: (id) => tasks.delete(id),
      clearInterval: () => {},
      setInterval: () => 1,
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.active = true;
  p.setData = (value, done) => {
    Object.assign(p.data, value);
    done?.();
  };
  p.accept({ room: fixture.view(), serviceRunning: true });
  return {
    p,
    sent,
    errors,
    tasks,
    time: (value) => (now = value),
    now: () => now,
    advance: (ms) => {
      now += ms;
      for (let step = 0; step < 20; step++) {
        const due = [...tasks].find(([, task]) => task.at <= now);
        if (!due) return;
        tasks.delete(due[0]);
        due[1].callback();
      }
      throw Error("Unexpected unbounded presentation timer");
    },
  };
}
for (const name of ["final-win", "final-win-three"])
  test(`${name} 原生真实飞人终局、排名及再来/离桌清理`, async () => {
    const fixture = scenario(name),
      h = page(fixture),
      { p, sent, errors } = h;
    const count = name.endsWith("three") ? 3 : 4;
    const tsumo = p.data.actions.find((c) => c.type === "tsumo");
    await p.respond({ currentTarget: { dataset: { id: tsumo.id } } });
    assert.equal(p.data.room.status, "playing");
    assert.equal(p.data.game.ranking, null);
    assert.equal(p.data.game.settlementFlow.stage, "detail");
    const before = p.data.game.settlementFlow.oldScores.slice();
    // Presentation timer is intentionally not simulated: drive current legal ACKs,
    // while the real native page and RoomStore process their state transitions.
    await p.send({
      action: "respond",
      decisionId: p.data.game.decisionId,
      choiceId: "ack",
    });
    assert.equal(p.data.game.settlementFlow.stage, "scores");
    assert.equal(p.data.game.ranking, null);
    assert.equal(p.data.room.status, "playing");
    const final = p.data.game.settlementFlow.newScores.slice();
    assert.ok(final.some((s) => s < 0));
    assert.equal(
      final.reduce((a, b) => a + b, 0),
      before.reduce((a, b) => a + b, 0),
    );
    await p.send({
      action: "respond",
      decisionId: p.data.game.decisionId,
      choiceId: "ack",
    });
    assert.equal(p.data.room.status, "finished");
    assert.equal(p.data.game.ranking.length, count);
    for (const entry of p.data.game.ranking)
      assert.equal(entry.score, final[entry.seat]);
    assert.equal(p.data.settlement, null);
    assert.equal(p.data.settlementAck, null);
    assert.equal(p.resultAnchor, null);
    assert.equal(p.data.openingHolding, false);
    assert.equal(p.data.game.rankingFlow.elapsedMs >= 0, true);
    assert.equal(p.data.ranking.ready, false);
    assert.equal(p.data.ranking.rows.filter((r) => r.visible).length, 0);
    const requests = sent.length;
    await p.rematch();
    await p.leave();
    assert.equal(
      sent.length,
      requests,
      "Do not leave before ranking presentation finishes",
    );
    h.advance(10000);
    assert.equal(p.data.ranking.ready, true);
    assert.equal(p.data.ranking.rows.filter((r) => r.visible).length, count);
    assert.equal(h.tasks.size, 0);
    await p.rematch();
    assert.equal(p.data.room.status, "lobby");
    assert.equal(p.data.game, null);
    assert.equal(p.data.ranking, null);
    assert.equal(p.rankingAnchor, null);
    assert.equal(p.data.hand.length, 0);
    assert.equal(p.data.actions.length, 0);
    assert.equal(p.data.seats.length, count);
    assert.equal(p.data.allReady, false);
    assert.equal(p.data.settlement, null);
    assert.equal(p.data.announcement, null);
    assert.equal(p.data.flight, null);
    assert.equal(p.data.motionTarget, "");
    await p.leave();
    assert.equal(p.data.room, null);
    assert.equal(p.data.game, null);
    assert.equal(p.data.seats.length, 0);
    assert.equal(p.data.host, false);
    assert.equal(p.data.busy, false);
    assert.equal(sent.at(-2).action, "rematch");
    assert.equal(sent.at(-1).action, "leave");
    assert.equal(new Set(sent.map((c) => c.nonce)).size, sent.length);
    assert.deepEqual(errors, []);
  });

test("原生排名使用网页同源时刻，三/四席逐行显示与完整就绪", async () => {
  const transformed = await transform(
    readFileSync("src/online/client/final-ranking-presentation.ts", "utf8"),
    { loader: "ts", format: "cjs" },
  );
  const module = { exports: {} };
  vm.runInNewContext(transformed.code, { module, exports: module.exports });
  for (const count of [3, 4]) {
    assert.deepEqual(
      timing.rankingBoundaries(count),
      Array.from(module.exports.rankingBoundaries(count)),
    );
    assert.equal(
      timing.rankingReadyAt(count),
      module.exports.rankingReadyAt(count),
    );
    const ranking = Array.from({ length: count }, (_, i) => ({
      seat: i,
      rank: i + 1,
      score: 30000 - i * 10000,
    })).reverse();
    const seats = Array.from({ length: count }, (_, i) => ({
      seat: i,
      name: `牌友${i}`,
    }));
    const game = { ranking, rankingFlow: { id: "final", elapsedMs: 0 } };
    for (const age of [
      0, 1799, 1800, 2599, 2600, 3399, 3400, 4199, 4200, 4999, 5000, 10000,
    ]) {
      const result = rankingPresentation(game, seats, 1, age);
      assert.equal(result.ready, age >= module.exports.rankingReadyAt(count));
      result.rows.forEach((row, i) => {
        assert.equal(row.visible, age >= module.exports.rankingRowAt(i));
        assert.equal(row.name, `牌友${row.seat}`);
        assert.equal(row.self, row.seat === 1);
      });
    }
    const old = rankingPresentation({ ranking }, seats, 0);
    assert.equal(old.ready, true);
    assert.ok(old.rows.every((r) => r.visible));
    assert.equal(
      ranking[0].rank,
      count,
      "Presentation does not mutate domain ordering",
    );
  }
  assert.equal(rankingPresentation(null, [], 0), null);
});

test("原生排名轮询与后台恢复不回退，离桌后旧计时回调无效", () => {
  const fixture = scenario("final-win");
  const v = fixture.view().game,
    tsumo = v.choices.find((c) => c.type === "tsumo");
  fixture.choose({ id: tsumo.id, decisionId: v.decisionId });
  for (let i = 0; i < 2; i++) {
    const g = fixture.view().game;
    fixture.choose({ id: "ack", decisionId: g.decisionId });
  }
  const h = page(fixture),
    { p } = h;
  const t = h.now();
  h.advance(3500);
  assert.equal(p.data.ranking.rows.filter((r) => r.visible).length, 3);
  h.time(t + 1000);
  p.accept({ room: fixture.view() });
  assert.equal(
    p.data.ranking.rows.filter((r) => r.visible).length,
    3,
    "Clock rollback and stale server age cannot hide shown rows",
  );
  const stale = [...h.tasks.values()][0].callback;
  p.onHide();
  assert.equal(h.tasks.size, 0);
  h.time(t + 12000);
  p.refresh = () => {}; // Cached final result can finish revealing even without a network reply.
  p.onShow();
  assert.equal(p.data.ranking.ready, true);
  p.accept({ room: fixture.view() });
  assert.equal(p.data.ranking.ready, true);
  assert.ok(p.data.ranking.rows.every((r) => r.visible));
  assert.equal(h.tasks.size, 0);
  p.accept({ room: null });
  stale();
  assert.equal(p.data.ranking, null);
  assert.equal(p.rankingAnchor, null);
  assert.equal(h.tasks.size, 0);
  const next = scenario("final-win-three");
  const first = next.view().game;
  next.choose({ id:first.choices.find(c=>c.type==="tsumo").id, decisionId:first.decisionId });
  for(let i=0;i<2;i++) next.choose({ id:"ack",decisionId:next.view().game.decisionId });
  p.accept({ room:next.view() });
  const currentKey = p.rankingAnchor.key;
  assert.equal(p.data.ranking.rows.filter(r=>r.visible).length,0);
  assert.equal(h.tasks.size,1);
  stale();
  assert.equal(p.rankingAnchor.key,currentKey); assert.equal(h.tasks.size,1);
  p.onHide(); assert.equal(h.tasks.size,0);
});
