// Deterministic component + real rule/store integration, isolated loopback server.
// Full production HTTP/session/socket integration is tested by online-browser.mjs and online.test.js.
import { build } from "esbuild";
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const out = path.resolve(".local/browser/online-interactions");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/online-interaction-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: path.join(out, "fixtures.mjs"),
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
await build({
  entryPoints: ["tests/online-interactions-entry.tsx"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  jsx: "automatic",
  external: ["./assets/*"],
  outfile: path.join(out, "client.js"),
  loader: { ".woff2": "file", ".webp": "file" },
});
const cssImports = (source) =>
  [...source.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map((m) =>
    path.basename(m[1]),
  );
assert.deepEqual(
  cssImports(readFileSync("tests/online-interactions-entry.tsx", "utf8")),
  cssImports(readFileSync("src/online/client/entry.tsx", "utf8")),
  "Harness must use the production stylesheet sequence",
);
const { scenario } = await import("file://" + path.join(out, "fixtures.mjs"));
const fixtures = new Map(),
  results = [];
const scoresBySeat = (game) =>
  game.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.score);
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"),
      name = u.searchParams.get("scenario"),
      key = u.searchParams.get("key");
    if (u.pathname.startsWith("/fixture/")) {
      assert.ok(
        [
          "riichi",
          "tsumo",
          "nuki",
          "pon",
          "ankan",
          "kakan",
          "chi",
          "daiminkan",
          "double-ron",
        ].includes(name),
      );
      assert.ok(key);
      if (!fixtures.has(key)) fixtures.set(key, scenario(name));
      const fixture = fixtures.get(key);
      let value;
      if (u.pathname === "/fixture/choose" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        value = fixture.choose(JSON.parse(body));
      } else {
        assert.equal(u.pathname, "/fixture/state");
        value = fixture.view();
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return;
    }
    if (u.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="online-root"></div><link rel="stylesheet" href="/test/client.css"><script type="module" src="/test/client.js"></script>',
      );
      return;
    }
    const root = u.pathname.startsWith("/test/assets/")
      ? path.resolve("public/online")
      : u.pathname.startsWith("/test/")
        ? out
        : path.resolve("public");
    const file = path.resolve(
      root,
      "." +
        (u.pathname.startsWith("/test/") ? u.pathname.slice(5) : u.pathname),
    );
    assert.ok(file.startsWith(root + path.sep));
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const name of [
        "riichi",
        "tsumo",
        "nuki",
        "pon",
        "ankan",
        "kakan",
        "chi",
        "daiminkan",
        "double-ron",
      ]) {
        const page = await browser.newPage({
            viewport: { width: 844, height: 390 },
            hasTouch: true,
          }),
          errors = [],
          failed = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (r.status() >= 400) failed.push(r.url() + ":" + r.status());
        });
        const query =
          "?scenario=" + name + "&key=" + engine.name() + "-" + name;
        const state = async () => {
          const r = await page.request.get(origin + "/fixture/state" + query);
          assert.equal(r.status(), 200);
          return r.json();
        };
        try {
          await page.goto(origin + "/" + query);
          await expect(page.locator(".mahjong-table")).toBeVisible();
          const before = await state();
          if (name === "riichi") {
            await page
              .getByRole("button", { name: "立直", exact: true })
              .click();
            const choice = before.game.choices.find((c) => c.type === "riichi");
            assert.ok(choice);
            const tile = page.locator(
              '.mahjong-hand button[data-choice-id="' + choice.id + '"]',
            );
            await tile.focus();
            await page.keyboard.press("Enter");
            await expect(tile).toHaveAttribute("aria-pressed", "true");
            await page.keyboard.press("Enter");
            await expect
              .poll(async () => {
                const r = await state();
                return r.game.players[r.mySeat].riichi;
              })
              .toBe(true);
            const after = await state();
            assert.equal(after.game.riichiSticks, 1);
            assert.equal(
              after.game.players[after.mySeat].score,
              before.game.players[before.mySeat].score - 1000,
            );
          } else if (name === "nuki") {
            await page.locator('button[data-choice-type="nuki"]').click();
            await expect(page.getByTestId("nuki-tiles-0")).toBeVisible();
            await expect(
              page.locator('[data-nuki-seat="0"] [data-nuki-volume]'),
            ).toHaveCount(1);
            const after = await state();
            assert.equal(after.game.players[0].nuki, 1);
            assert.equal(after.game.drawnTile, "z2");
            assert.ok(after.game.choices.some((c) => c.type === "tsumo"));
            await page.locator('button[data-choice-type="tsumo"]').click();
            await expect(
              page.locator('[data-settlement-stage="detail"]'),
            ).toBeVisible();
            const won = await state();
            assert.equal(won.game.settlement.winMethod, "tsumo");
            assert.ok(
              won.game.settlement.yaku.some((y) => /抜きドラ/.test(y.name)),
            );
          } else if (name === "tsumo") {
            await page.locator('button[data-choice-type="tsumo"]').click();
            await expect(
              page.locator('[data-settlement-stage="detail"]'),
            ).toBeVisible();
            const after = await state();
            assert.equal(after.game.settlement.kind, "win");
            assert.equal(after.game.settlement.winMethod, "tsumo");
            assert.equal(after.game.settlement.winnerSeat, after.mySeat);
          } else if (name === "double-ron") {
            const oldScores = scoresBySeat(before.game),
              handId = before.game.handId;
            await page.locator('button[data-choice-type="ron"]').click();
            const detail = page.locator('[data-settlement-stage="detail"]');
            await expect(detail).toBeVisible();
            await expect(detail).toContainText("第 1 / 共 2 位");
            let current = await state();
            assert.equal(current.game.settlement.winnerSeat, 1);
            assert.deepEqual(scoresBySeat(current.game), oldScores);
            const next = async () => {
              const ack = page.locator('button[data-choice-type="ack"]');
              await expect(ack).toBeEnabled({ timeout: 15000 });
              await ack.click();
            };
            await next();
            await expect(detail).toContainText("第 2 / 共 2 位");
            current = await state();
            assert.equal(current.game.settlement.winnerSeat, 2);
            assert.deepEqual(scoresBySeat(current.game), oldScores);
            await next();
            const scores = page.locator('[data-settlement-stage="scores"]');
            await expect(scores).toBeVisible();
            current = await state();
            assert.deepEqual(
              current.game.settlementFlow.delta,
              [-5200, 2600, 2600, 0],
            );
            const totals = oldScores.map(
              (v, i) => v + [-5200, 2600, 2600, 0][i],
            );
            assert.deepEqual(current.game.settlementFlow.newScores, totals);
            for (let seat = 0; seat < 4; seat++)
              await expect(
                page.getByTestId("settlement-score-" + seat),
              ).toHaveText(totals[seat].toLocaleString("en-US"), {
                timeout: 10000,
              });
            await expect(
              scores.locator('[data-settlement-seat="0"] > b'),
            ).toHaveText("支付 −5,200");
            await page.screenshot({
              path: path.join(out, engine.name() + "-double-ron-scores.png"),
              fullPage: true,
            });
            await next();
            await expect
              .poll(async () => (await state()).game.handId)
              .toBe(handId + 1);
            current = await state();
            assert.deepEqual(scoresBySeat(current.game), totals);
            await expect(scores).toHaveCount(0);
          } else {
            const type = ["pon", "chi"].includes(name) ? name : "kan";
            assert.ok(before.game.choices.some((c) => c.type === type));
            await page
              .locator('button[data-choice-type="' + type + '"]')
              .click();
            await expect
              .poll(async () => {
                const r = await state();
                return r.game.players[r.mySeat].melds.join(",");
              })
              .not.toBe(before.game.players[before.mySeat].melds.join(","));
            const after = await state(),
              melds = after.game.players[after.mySeat].melds;
            assert.equal(melds.length, 1);
            assert.match(
              melds[0].replace(/[+\-=]/g, ""),
              name === "chi" ? /^p123$/ : name === "pon" ? /^p111$/ : /^p1111$/,
            );
            const visible = page.locator(
              '.mahjong-meld[data-meld-seat="' + after.mySeat + '"]',
            );
            await expect(visible).toHaveCount(1);
            await expect(visible).toBeVisible();
            await expect(visible).toHaveAttribute("data-meld-value", melds[0]);
            await expect(visible.locator("[data-meld-volume]")).toHaveCount(
              ["pon", "chi"].includes(name) ? 3 : 4,
            );
            if (name === "ankan")
              await expect(visible.locator(".mahjong-meld__back")).toHaveCount(
                2,
              );
            if (name === "kakan")
              await expect(visible.locator('[data-layer="added"]')).toHaveCount(
                1,
              );
            if (["pon", "chi", "daiminkan"].includes(name))
              await expect(visible.locator('[data-called="true"]')).toHaveCount(
                1,
              );
          }
          await page.screenshot({
            path: path.join(out, engine.name() + "-" + name + ".png"),
            fullPage: true,
          });
          assert.deepEqual(errors, []);
          assert.deepEqual(failed, []);
          results.push({
            browser: engine.name(),
            scenario: name,
            passed: true,
          });
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((r) => server.close(r));
  writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2),
  );
}
console.log(JSON.stringify(results));
