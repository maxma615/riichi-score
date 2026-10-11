import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Store } from "../src/store.js";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
mkdirSync(".local/test-data", { recursive: true });
test("旧库迁移、微信稳定身份与资料持久化", () => {
  const dir = mkdtempSync(".local/test-data/migration-"),
    file = path.join(dir, "db.sqlite");
  let s;
  try {
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE sessions(token TEXT PRIMARY KEY,id TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE rooms(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,state TEXT NOT NULL); CREATE TABLE commands(room TEXT NOT NULL,nonce TEXT NOT NULL,PRIMARY KEY(room,nonce));",
    );
    const legacyToken = "b".repeat(64);
    old
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(
        createHash("sha256").update(legacyToken).digest("hex"),
        "legacy-id",
        "旧成员",
        Date.now() + 100000,
      );
    old.close();
    s = new Store(file);
    assert.equal(s.db.prepare("PRAGMA table_info(sessions)").all().length, 4);
    assert.equal(s.identity(legacyToken).name, "旧成员");
    s.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(
        "legacy-rollback-token",
        "legacy-other",
        "回滚兼容",
        Date.now() + 100000,
      );
    const a = s.wechatSession("appid", "openid");
    s.updateProfile(a, "甲", "/riichi/avatars/" + "a".repeat(32) + ".png");
    const b = s.wechatSession("appid", "openid");
    assert.equal(a.id, b.id);
    assert.notEqual(a.token, b.token);
    assert.equal(b.name, "甲");
    assert.equal(s.identity(b.token).channel, "wechat");
    assert.notEqual(s.wechatSession("other-app", "openid").id, a.id);
    s.close();
    s = new Store(file);
    assert.equal(s.profile(a.id).name, "甲");
    assert.equal(s.identity(a.token).id, a.id);
  } finally {
    s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("月度荣和、自摸、双响、供托、同桌净点、撤回与隐私", () => {
  const dir = mkdtempSync(".local/test-data/stats-");
  const s = new Store(path.join(dir, "db.sqlite"));
  try {
    const a = s.wechatSession("app", "a"),
      b = s.wechatSession("app", "b"),
      c = s.wechatSession("app", "c"),
      foreign = s.session("外人");
    s.updateProfile(a, "甲");
    s.updateProfile(b, "乙");
    s.updateProfile(c, "丙");
    let r = s.create(a, { players: 3 });
    r = s.join(b, r.code, 1);
    r = s.join(c, r.code, 2);
    const command = (event) =>
      (r = s.command(a, r.id, {
        action: "record",
        event,
        version: r.version,
        nonce: "test-command-" + r.version,
      }));
    command({
      kind: "win",
      method: "ron",
      loser: 0,
      winners: [
        { seat: 1, fu: 30, han: 1 },
        { seat: 2, fu: 30, han: 2 },
      ],
    });
    let raw = s.raw(r.id);
    raw.history[0].createdAt = "2026-09-30T16:00:00.000Z";
    s.save(raw);
    let stats = s.stats(a, "2026-10");
    assert.equal(stats.dealin, 1);
    assert.equal(stats.hit, 2);
    assert.equal(stats.net, -3000);
    assert.equal(s.stats(a, "2026-09").hands, 0);
    assert.equal(s.stats(foreign, "2026-10").hands, 0);
    command({
      kind: "win",
      method: "tsumo",
      winners: [{ seat: 0, fu: 30, han: 3 }],
      riichi: [0],
    });
    raw = s.raw(r.id);
    raw.history[1].createdAt = "2026-10-02T00:00:00.000Z";
    s.save(raw);
    stats = s.stats(a, "2026-10");
    assert.equal(stats.wins, 1);
    assert.equal(stats.tsumo, 1);
    assert.equal(stats.peers.length, 2);
    assert.equal(s.stats(b, "2026-10").hit, 1);
    assert.equal(stats.net, r.scores[0] - 35000);
    const version = r.version;
    r = s.command(a, r.id, { action: "undo", version, nonce: "undo-stats" });
    assert.equal(s.stats(a, "2026-10").wins, 0);
    assert.equal(s.stats(a, "2026-10").net, -3000);
    s.updateProfile(b, "乙改名");
    assert.equal(s.get(r.id, a).members[1].name, "乙改名");
    assert.ok(s.stats(a, "2026-10").peers.some((p) => p.name === "乙改名"));
    assert.equal(
      s.command(a, r.id, { action: "undo", version, nonce: "undo-stats" })
        .version,
      r.version,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
