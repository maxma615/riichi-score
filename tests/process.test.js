import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
test("真实独立Node进程重启后保留身份、座位和积分", async () => {
  const root = path.resolve(".local/test-data");
  mkdirSync(root, { recursive: true });
  const data = mkdtempSync(path.join(root, "restart-"));
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../src/server.js", import.meta.url))],
      {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          APP_ORIGIN: origin,
          APP_BASE_PATH: "",
          DATA_DIR: data,
        },
        stdio: "ignore",
      },
    );
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(origin + "/api/health")).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error("Server did not start");
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      const [code] = await ended;
      assert.equal(code, 0);
    }
  };
  const post = (url, body, cookie = "") =>
    fetch(origin + url, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
  try {
    await start();
    const response = await post("/api/session", { name: "合成测试桌主" }),
      cookie = response.headers.get("set-cookie").split(";")[0];
    let room = await (await post("/api/rooms", { players: 3 }, cookie)).json();
    for (const seat of [1, 2])
      room = await (
        await post(
          `/api/rooms/${room.id}/events`,
          {
            action: "add-player",
            seat,
            name: "合成玩家" + seat,
            version: room.version,
            nonce: "synthetic-seat-" + seat,
          },
          cookie,
        )
      ).json();
    room = await (
      await post(
        `/api/rooms/${room.id}/events`,
        {
          action: "record",
          version: room.version,
          nonce: "synthetic-score",
          event: {
            kind: "win",
            method: "ron",
            loser: 2,
            winners: [{ seat: 1, fu: 30, han: 3 }],
          },
        },
        cookie,
      )
    ).json();
    assert.deepEqual(room.scores, [35000, 38900, 31100]);
    await stop();
    await start();
    const recovered = await (
      await fetch(origin + `/api/rooms/${room.id}`, {
        headers: { Cookie: cookie },
      })
    ).json();
    assert.deepEqual(recovered, room);
  } finally {
    await stop();
    rmSync(data, { recursive: true, force: true });
  }
});
