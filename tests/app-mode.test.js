import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/server.js";

const testRoot = path.resolve(".local/test-data");
mkdirSync(testRoot, { recursive: true });

async function withApp(opts, fn) {
  const dir = mkdtempSync(path.join(testRoot, "app-mode-"));
  const origin = "http://127.0.0.1:3200";
  const { server } = createApp({ dataDir: dir, origin, ...opts });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("APP_MODE=score 退役联机页面与 API，记分健康仍可用", async () => {
  await withApp({ mode: "score", basePath: "/riichi" }, async (base) => {
    const health = await fetch(base + "/riichi/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const home = await fetch(base + "/riichi/");
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.doesNotMatch(html, /联机牌桌/);
    assert.match(html, /日麻记分/);

    for (const path of ["/riichi/online/", "/riichi/online/client.js"]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 410, path);
      assert.match((await res.json()).error, /mahjong\.yougui\.online/);
    }

    const api = await fetch(base + "/riichi/api/online");
    assert.equal(api.status, 410);

    const session = await fetch(base + "/riichi/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3200",
      },
      body: JSON.stringify({ name: "模式测试" }),
    });
    assert.equal(session.status, 201);
    const cookie = session.headers.get("set-cookie").split(";")[0];
    const postOnline = await fetch(base + "/riichi/api/online", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3200",
        Cookie: cookie,
      },
      body: JSON.stringify({ action: "create" }),
    });
    assert.equal(postOnline.status, 410);
  });
});

test("APP_MODE=online 根路径跳到联机大厅", async () => {
  await withApp({ mode: "online", basePath: "" }, async (base) => {
    const root = await fetch(base + "/", { redirect: "manual" });
    assert.equal(root.status, 308);
    assert.equal(root.headers.get("location"), "/online/");

    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 200);

    const lobby = await fetch(base + "/online/");
    assert.equal(lobby.status, 200);
  });
});
