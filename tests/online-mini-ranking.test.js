import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
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
  new URL("../miniprogram/pages/online/index.js", import.meta.url),
);
function page(fixture) {
  let p;
  const sent = [],
    errors = [];
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
    {
      Page: (value) => (p = value),
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
      setTimeout: () => 1,
      clearTimeout: () => {},
      clearInterval: () => {},
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.active = true;
  p.setData = (value, done) => {
    Object.assign(p.data, value);
    done?.();
  };
  p.accept({ room: fixture.view(), serviceRunning: true });
  return { p, sent, errors };
}
for (const name of ["final-win", "final-win-three"])
  test(`${name} 原生真实飞人终局、排名及再来/离桌清理`, async () => {
    const fixture = scenario(name),
      { p, sent, errors } = page(fixture);
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
    await p.rematch();
    assert.equal(p.data.room.status, "lobby");
    assert.equal(p.data.game, null);
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
