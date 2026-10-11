import { test } from "node:test";
import assert from "node:assert/strict";
import { Wechat } from "../src/wechat.js";
test("微信请求边界、缓存和小程序scene", async () => {
  const calls = [],
    wx = new Wechat({
      appId: "test-app",
      secret: "synthetic-secret",
      envVersion: "trial",
      fetcher: async (url, options) => {
        calls.push({ url, options });
        if (url.includes("jscode2session"))
          return Response.json({
            openid: "synthetic-openid",
            session_key: "never-return",
          });
        if (url.includes("/token?"))
          return Response.json({
            access_token: "synthetic-access",
            expires_in: 7200,
          });
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "image/png" },
        });
      },
    });
  assert.deepEqual(await wx.login("code"), {
    appId: "test-app",
    openid: "synthetic-openid",
  });
  const code = "a".repeat(32);
  await wx.qr(code);
  await wx.qr(code);
  assert.equal(calls.filter((c) => c.url.includes("/token?")).length, 1);
  const b = JSON.parse(calls[2].options.body);
  assert.equal(b.scene, code);
  assert.equal(b.env_version, "trial");
  assert.equal(b.page, "pages/room/index");
  await assert.rejects(() => wx.qr("bad"));
});
test("无配置与微信拒绝不可建立会话", async () => {
  await assert.rejects(
    () => new Wechat({ appId: "", secret: "" }).login("code"),
    (e) => e.status === 503,
  );
  await assert.rejects(
    () =>
      new Wechat({
        appId: "a",
        secret: "s",
        fetcher: async () => Response.json({ errcode: 40029 }),
      }).login("code"),
    (e) => e.status === 401,
  );
});
