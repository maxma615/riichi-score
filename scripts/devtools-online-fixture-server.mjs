// Deterministic rule/store fixtures for native visual checks; never production routing.
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
if (process.argv[2] !== "--synthetic")
  throw Error("Use --synthetic for disposable loopback fixtures");
const allowed = [
  "tsumo",
  "double-ron",
  "nuki",
  "nuki-double",
  "draw-four",
  "draw-three",
  "pon",
  "chi",
  "ankan",
  "daiminkan",
  "kakan",
  "riichi",
  "final-win",
  "final-win-three",
];
let name = process.argv[3] || "double-ron";
if (!allowed.includes(name)) throw Error("Unsupported fixture");
const root = path.resolve(".local/devtools-synthetic");
mkdirSync(root, { recursive: true });
const dataDir = mkdtempSync(path.join(root, "online-fixture-"));
const modulePath = path.join(dataDir, "fixtures.mjs");
await build({
  entryPoints: ["tests/online-interaction-fixtures.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: modulePath,
  banner: {
    js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
  },
});
const { scenario } = await import("file://" + modulePath);
let fixture = scenario(name),
  sequence = 0;
const token = randomUUID();
function receipt(kind, extra = {}) {
  writeFileSync(
    path.join(dataDir, `${String(++sequence).padStart(3, "0")}-${kind}.json`),
    JSON.stringify({ name, ...extra, room: fixture.view() }, null, 2),
  );
}
receipt("initial");
const server = createServer(async (req, res) => {
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) throw Error("Body too large");
    }
    const input = body ? JSON.parse(body) : {};
    const route = new URL(req.url, "http://localhost").pathname;
    let value;
    if (route === "/api/wechat/login" && req.method === "POST" && input.code) {
      value = { token, user: { id: "synthetic-fixture", name: "测试牌友" } };
    } else if (route === "/fixture/reset" && req.method === "POST") {
      if (!allowed.includes(input.name)) throw Error("Unsupported fixture");
      name = input.name;
      fixture = scenario(name);
      receipt("reset");
      value = { name };
    } else {
      if (req.headers.authorization !== "Bearer " + token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Synthetic login required" }));
        return;
      }
      if (route === "/api/profile" && req.method === "GET")
        value = { id: "synthetic-fixture", name: "测试牌友", avatar: "" };
      else if (route === "/api/rooms" && req.method === "GET") value = [];
      else if (route === "/api/online" && req.method === "GET")
        value = { room: fixture.view(), serviceRunning: true };
      else if (
        route === "/api/online" &&
        req.method === "POST" &&
        input.action === "respond"
      ) {
        value = {
          serviceRunning: true,
          room: fixture.choose({
            id: input.choiceId,
            decisionId: input.decisionId,
          }),
        };
        receipt("respond", {
          choiceId: input.choiceId,
          decisionId: input.decisionId,
        });
      } else if (
        route === "/api/online" &&
        req.method === "POST" &&
        ["rematch", "leave"].includes(input.action)
      ) {
        value = {
          serviceRunning: true,
          room: fixture.roomCommand(input.action) ?? null,
        };
        receipt(input.action);
      } else throw Error("Unsupported synthetic route");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const manifest = {
  kind: "synthetic-rule-store-fixture",
  name,
  dataDir,
  apiBase: `http://127.0.0.1:${server.address().port}`,
  pid: process.pid,
};
writeFileSync(
  path.join(dataDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify(manifest));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
