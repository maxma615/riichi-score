import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createApp } from "../src/server.js";
const require = createRequire(import.meta.url),
  { snapshot, tile, meld, uuid } = require("../miniprogram/utils/online.js");
test("原生联机牌面、合法动作、拔北与解散状态", () => {
  assert.match(
    uuid(),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.match(tile("s0_").src, /Sou5-Dora.svg$/);
  assert.match(tile("z4").src, /Pei.svg$/);
  assert.equal(meld("p555+").length, 3);
  const room = {
    id: "r",
    mySeat: 0,
    hostUserId: "a",
    variant: "sanma",
    members: [
      { seat: 0, userId: "a", displayName: "甲", ready: true },
      { seat: 1, userId: "b", displayName: "乙", ready: true },
    ],
    game: {
      roundWind: 0,
      roundNumber: 1,
      decisionId: "d",
      hand: ["p1", "z4", "s0"],
      drawnTile: "s0",
      doraIndicators: ["p2"],
      players: [
        {
          seat: 0,
          wind: 0,
          score: 35000,
          nuki: 2,
          discards: ["p1"],
          melds: ["s123-"],
        },
        { seat: 1, wind: 1, score: 35000, handCount: 13 },
      ],
      choices: [
        { id: "discard", type: "discard", value: "p1" },
        { id: "nuki", type: "nuki", value: "z4" },
        { id: "pon", type: "pon", value: "p555+" },
        { id: "drawn", type: "discard", value: "s0_" },
      ],
    },
  };
  const data = snapshot({ room, serviceRunning: true });
  assert.equal(data.hand.length, 3);
  assert.equal(data.hand[0].choiceId, "discard");
  assert.equal(data.hand[1].choiceId, "");
  assert.equal(data.hand[2].choiceId, "drawn");
  assert.equal(data.seats[0].nuki, 2);
  assert.equal(data.seats[1].hidden.length, 13);
  assert.equal(data.actions.length, 2);
  assert.equal(data.actions[1].tiles.length, 3);
  assert.equal(data.actions[0].label, "拔北");
  assert.equal(snapshot({ room: null, serviceRunning: false }).room, null);
});
test("原生小程序真实独立HTTP开桌、重试同nonce、人机准备及解散", async () => {
  mkdirSync(".local/test-data", { recursive: true });
  const dataDir = mkdtempSync(".local/test-data/mini-online-synthetic-");
  const { server, online } = createApp({
    dataDir,
    origin: "http://127.0.0.1:3200",
    wechat: {
      login: async () => ({
        appId: "synthetic-app",
        openid: "synthetic-player",
      }),
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/wechat/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "synthetic" }),
  });
  const { token } = await login.json();
  let failOnce = true,
    p,
    nonces = [],
    errors = [];
  const api = {
    error: (e) => errors.push(e.message),
    api: async (endpoint, method = "GET", body) => {
      if (body) nonces.push(body.nonce);
      const r = await fetch(base + endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await r.json();
      if (!r.ok) throw Object.assign(Error(value.error), { status: r.status });
      if (body?.action === "create" && failOnce) {
        failOnce = false;
        throw Error("synthetic lost response");
      }
      return value;
    },
  };
  const req = createRequire(
    new URL("../miniprogram/pages/online/index.js", import.meta.url),
  );
  vm.runInNewContext(
    readFileSync("miniprogram/pages/online/index.js", "utf8"),
    {
      Page: (v) => (p = v),
      require: (s) => (s === "../../utils/api" ? api : req(s)),
      wx: { showModal: (o) => o.success({ confirm: true }) },
      setInterval: () => 1,
      clearInterval: () => {},
    },
  );
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = function (v) {
    Object.assign(this.data, v);
  };
  p.active = true;
  assert.equal(p.data.variant, "yonma");
  p.setData({ variant: "sanma" });
  try {
    await p.create();
    assert.equal(p.data.room, null);
    assert.equal(errors.length, 1);
    await p.create();
    assert.equal(nonces[0], nonces[1]);
    assert.equal(p.data.room.variant, "sanma");
    assert.ok(p.data.host);
    await p.fill();
    assert.equal(p.data.seats.length, 3);
    await p.ready();
    assert.equal(p.data.allReady, true);
    await p.start();
    assert.ok(p.data.game);
    assert.equal(p.data.hand.length, p.data.game.hand.length);
    await p.send({ action: "finish" });
    assert.equal(p.data.room, null);
    assert.equal(p.data.game, null);
  } finally {
    await online.close();
    await new Promise((r) => server.close(r));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
