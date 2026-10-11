// Local-only platform UI checks. This adapter is never used by src/server.js.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server.js";

if (process.argv[2] !== "--synthetic") {
  throw new Error(
    "Use --synthetic to start a loopback-only disposable test service",
  );
}
const root = path.resolve(".local/devtools-synthetic");
mkdirSync(root, { recursive: true });
const dataDir = mkdtempSync(path.join(root, "run-"));
const appId = "local-devtools-synthetic";
const openid = "synthetic-owner";
const { server, store } = createApp({
  dataDir,
  wechat: {
    async login(code) {
      if (typeof code !== "string" || !code)
        throw new Error("Missing simulator code");
      return { appId, openid };
    },
    async qr() {
      throw new Error(
        "Real WeChat codes are not available in this synthetic service",
      );
    },
  },
});
const session = store.wechatSession(appId, openid);
const owner = store.identity(session.token);
store.updateProfile(owner, "测试东家");
let room = store.create(owner, { players: 4 });
for (const [seat, name] of [
  [1, "测试南家"],
  [2, "测试西家"],
  [3, "测试北家"],
]) {
  room = store.command(owner, room.id, {
    action: "add-player",
    seat,
    name,
    version: room.version,
    nonce: randomUUID(),
  });
}
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const apiBase = `http://127.0.0.1:${server.address().port}`;
const manifest = { kind: "synthetic-only", apiBase, dataDir, roomId: room.id };
writeFileSync(
  path.join(dataDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify(manifest));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
