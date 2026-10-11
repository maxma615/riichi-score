import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";

import path from "node:path";
import { createApp } from "../src/server.js";
const testRoot = path.resolve(".local/test-data");
mkdirSync(testRoot, { recursive: true });
test("真实HTTP身份、来源、跨桌隔离与二维码邀请", async () => {
  const dir = mkdtempSync(path.join(testRoot, "riichi-http-synthetic-"));
  const origin = "http://127.0.0.1:3200",
    { server } = createApp({ dataDir: dir, origin });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`,
    post = (url, body, cookie = "", source = origin) =>
      fetch(base + url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: source,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
  try {
    assert.equal(
      (
        await post(
          "/api/session",
          { name: "测试桌主" },
          "",
          "https://foreign.test",
        )
      ).status,
      403,
    );
    assert.equal((await post("/api/rooms", {})).status, 401);
    const a = await post("/api/session", { name: "测试桌主" }),
      cookie = a.headers.get("set-cookie").split(";")[0];
    assert.match(a.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
    let r = await (await post("/api/rooms", { players: 3 }, cookie)).json();
    const id = r.id;
    assert.equal((await fetch(base + `/api/rooms/${id}`)).status, 401);
    const b = await post("/api/session", { name: "测试南家" }),
      cookieB = b.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await fetch(base + `/api/rooms/${id}`, { headers: { Cookie: cookieB } }))
        .status,
      403,
    );
    r = await (
      await post("/api/join", { code: r.code, seat: 1 }, cookieB)
    ).json();
    assert.equal(r.mySeat, 1);
    assert.equal(
      (
        await post(
          `/api/rooms/${id}/events`,
          { action: "finish", version: r.version, nonce: "unapproved-command" },
          cookieB,
        )
      ).status,
      403,
    );
    const qr = await fetch(base + `/api/rooms/${id}/qr`, {
      headers: { Cookie: cookie },
    });
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(base + "/api/health")).status, 200);
    assert.equal((await fetch(base + "/.env")).status, 404);
    assert.match(
      (await fetch(base + "/")).headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
test("独立路径与HTTPS会话配置", async () => {
  const dir = mkdtempSync(path.join(testRoot, "riichi-prefix-synthetic-"));
  const origin = "https://score.example.test",
    { server } = createApp({ dataDir: dir, origin, basePath: "/riichi" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/health")).status, 404);
    assert.equal((await fetch(base + "/riichi/api/health")).status, 200);
    const redirect = await fetch(base + "/riichi", { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/riichi/");
    assert.match(
      await (await fetch(base + "/riichi/")).text(),
      /content="\/riichi"/,
    );
    const r = await fetch(base + "/riichi/api/session", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "独立玩家" }),
    });
    assert.match(
      r.headers.get("set-cookie"),
      /Path=\/riichi; HttpOnly; SameSite=Lax.*Secure/,
    );
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
