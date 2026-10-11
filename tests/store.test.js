import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";

import path from "node:path";
import { Store } from "../src/store.js";
const testRoot = path.resolve(".local/test-data");
mkdirSync(testRoot, { recursive: true });
test("成员权限、座位并发、持久化、幂等、版本与撤回", () => {
  const dir = mkdtempSync(path.join(testRoot, "riichi-synthetic-")),
    file = path.join(dir, "data.sqlite");
  let store = new Store(file);
  try {
    const a = store.session("桌主"),
      b = store.session("南家"),
      c = store.session("西家"),
      foreign = store.session("外部");
    let r = store.create(a, { players: 3 });
    const id = r.id;
    assert.throws(
      () => store.get(id, foreign),
      (e) => e.status === 403,
    );
    assert.deepEqual(store.list(foreign), []);
    assert.equal(store.list(a)[0].id, id);
    r = store.join(b, r.code, 1);
    assert.throws(
      () => store.join(c, r.code, 1),
      (e) => e.status === 409,
    );
    r = store.join(c, r.code, 2);
    assert.equal(store.join(b, r.code, 2).mySeat, 1);
    assert.throws(
      () =>
        store.command(b, id, {
          action: "finish",
          version: r.version,
          nonce: "b-command1",
        }),
      (e) => e.status === 403,
    );
    assert.throws(
      () =>
        store.command(a, id, {
          action: "finish",
          version: 1,
          nonce: "a-command1",
        }),
      (e) => e.status === 409,
    );
    const input = {
      action: "record",
      version: r.version,
      nonce: "score-one",
      event: {
        kind: "win",
        method: "tsumo",
        winners: [{ seat: 1, fu: 30, han: 3 }],
        riichi: [0],
      },
    };
    r = store.command(a, id, input);
    assert.deepEqual(r.scores, [32000, 39000, 34000]);
    const version = r.version;
    assert.equal(store.command(a, id, input).version, version);
    store.close();
    store = new Store(file);
    assert.equal(store.identity(a.token).id, a.id);
    assert.deepEqual(store.get(id, b).scores, r.scores);
    r = store.command(a, id, { action: "undo", version, nonce: "undo-one" });
    assert.deepEqual(r.scores, [35000, 35000, 35000]);
    assert.equal(r.dealer, 0);
    assert.equal(r.pot, 0);
    assert.equal(r.history.length, 0);
    r = store.command(a, id, {
      action: "finish",
      version: r.version,
      nonce: "finish-one",
    });
    assert.equal(r.finished, true);
    assert.throws(
      () =>
        store.command(a, id, {
          ...input,
          nonce: "score-two",
          version: r.version,
        }),
      (e) => e.status === 409,
    );
    r = store.command(a, id, {
      action: "undo",
      version: r.version,
      nonce: "undo-end",
    });
    assert.equal(r.finished, false);
    assert.ok(!JSON.stringify(r).includes(a.token));
    assert.equal(r.owner, undefined);
    assert.equal(r.members[0].id, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("失败事务不更改状态与未占座规则", () => {
  const dir = mkdtempSync(path.join(testRoot, "riichi-synthetic-"));
  const store = new Store(path.join(dir, "db"));
  try {
    const a = store.session("a"),
      r = store.create(a);
    assert.throws(
      () =>
        store.command(a, r.id, {
          action: "record",
          version: 1,
          nonce: "bad-hand",
          event: { kind: "abort" },
        }),
      (e) => e.status === 409,
    );
    assert.deepEqual(store.get(r.id, a), r);
    let current = r;
    for (let seat = 1; seat < 4; seat++)
      current = store.command(a, r.id, {
        action: "add-player",
        version: current.version,
        nonce: `add-seat-${seat}`,
        seat,
        name: `玩家${seat}`,
      });
    assert.throws(() =>
      store.command(a, r.id, {
        action: "record",
        version: current.version,
        nonce: "invalid-score",
        event: {
          kind: "win",
          method: "ron",
          loser: 2,
          winners: [{ seat: 1, fu: 20, han: 1 }],
        },
      }),
    );
    assert.deepEqual(store.get(r.id, a), current);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
