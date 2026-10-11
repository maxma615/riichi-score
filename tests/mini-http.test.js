import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createApp } from "../src/server.js";
mkdirSync(".local/test-data", { recursive: true });
test("微信登录、Bearer权限、头像与小程序码HTTP", async () => {
  const dir = mkdtempSync(".local/test-data/mini-http-"),
    wx = {
      login: async (code) => {
        if (code === "invalid")
          throw Object.assign(Error("过期"), { status: 401 });
        return { appId: "app", openid: code };
      },
      qr: async () => Buffer.from([137, 80, 78, 71]),
    };
  const { server } = createApp({
    dataDir: dir,
    origin: "https://score.test",
    basePath: "/riichi",
    wechat: wx,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/riichi";
  const post = (p, data, token) =>
    fetch(base + p, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(data),
    });
  const get = (p, token) =>
    fetch(base + p, {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
  try {
    assert.equal(
      (await post("/api/wechat/login", { code: "invalid" })).status,
      401,
    );
    assert.equal((await post("/api/rooms", {})).status, 403);
    const a = await (await post("/api/wechat/login", { code: "a" })).json(),
      b = await (await post("/api/wechat/login", { code: "b" })).json();
    assert.ok(a.token);
    assert.equal(a.openid, undefined);
    assert.equal(a.session_key, undefined);
    assert.equal(
      (
        await post(
          "/api/profile",
          { name: "甲", avatarData: "data:image/svg+xml;base64,aGVsbG8=" },
          a.token,
        )
      ).status,
      400,
    );
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
    const profile = await (
      await post("/api/profile", { name: "甲", avatarData: png }, a.token)
    ).json();
    assert.match(profile.avatar, /^\/riichi\/avatars\//);
    assert.equal(
      (
        await fetch(
          "http://127.0.0.1:" + server.address().port + profile.avatar,
        )
      ).status,
      200,
    );
    const room = await (
      await post("/api/rooms", { players: 3 }, a.token)
    ).json();
    assert.equal((await get("/api/rooms/" + room.id, b.token)).status, 403);
    assert.equal(
      (await get("/api/rooms/" + room.id + "/wxcode", b.token)).status,
      403,
    );
    assert.equal(
      (await get("/api/rooms/" + room.id + "/wxcode", a.token)).status,
      200,
    );
    const invite = await (
      await get("/api/invite?code=" + room.code, b.token)
    ).json();
    assert.equal(invite.seats[0].name, "甲");
    assert.equal(invite.seats[0].avatar, profile.avatar);
    assert.equal(
      (await post("/api/join", { code: room.code, seat: 1 }, b.token)).status,
      200,
    );
    assert.equal((await get("/api/stats?month=2026-99", a.token)).status, 400);
    const newer = await (await post("/api/wechat/login", { code: "a" })).json();
    assert.equal((await get("/api/rooms/" + room.id, newer.token)).status, 200);
    assert.equal((await get("/api/stats?month=2026-10")).status, 401);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
