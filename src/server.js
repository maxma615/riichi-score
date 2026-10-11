import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import QRCode from "qrcode";
import { Store, HttpError } from "./store.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function createApp({
  dataDir = path.resolve(root, ".local/data"),
  origin = "http://127.0.0.1:3200",
  basePath = "",
} = {}) {
  origin = new URL(origin).origin;
  if (basePath && !/^\/[a-z0-9-]+$/.test(basePath))
    throw new Error("Invalid basePath");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const store = new Store(path.join(dataDir, "score.sqlite"));
  const limits = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      const url = new URL(req.url, origin);
      if (basePath && url.pathname === basePath) {
        res.writeHead(308, { Location: basePath + "/" });
        return res.end();
      }
      if (basePath) {
        if (!url.pathname.startsWith(basePath + "/"))
          throw new HttpError(404, "页面不存在");
        url.pathname = url.pathname.slice(basePath.length);
      }
      const token = req.headers.cookie?.match(
          /(?:^|;\s*)riichi_session=([a-f0-9]{64})(?:;|$)/,
        )?.[1],
        user = store.identity(token);
      const json = (value, status = 200) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(value));
      };
      if (req.method === "GET" && url.pathname === "/api/health")
        return json({ ok: true, kind: "riichi-score-room" });
      if (req.method === "GET" && url.pathname === "/api/session")
        return json({ user: user ? { name: user.name } : null });
      if (req.method === "GET" && url.pathname === "/api/rooms") {
        if (!user) throw new HttpError(401, "请先填写昵称");
        return json(store.list(user));
      }
      const match = url.pathname.match(
        /^\/api\/rooms\/([a-f0-9-]{36})(\/events|\/qr)?$/,
      );
      if (req.method === "GET" && match) {
        if (!user) throw new HttpError(401, "请填写昵称后加入");
        const room = store.get(match[1], user);
        if (match[2] === "/qr") {
          const svg = await QRCode.toString(
            `${origin}${basePath}/?join=${room.code}`,
            { type: "svg", margin: 2, width: 240 },
          );
          res.writeHead(200, { "Content-Type": "image/svg+xml" });
          return res.end(svg);
        }
        if (match[2]) throw new HttpError(404, "页面不存在");
        return json(room);
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (
          req.headers.origin !== origin ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          throw new HttpError(403, "请求来源不匹配");
        const key = req.socket.remoteAddress,
          now = Date.now();
        let bucket = limits.get(key);
        if (!bucket || now - bucket.start > 60000) {
          bucket = { start: now, count: 0 };
          limits.set(key, bucket);
        }
        if (++bucket.count > 120)
          throw new HttpError(429, "操作过于频繁，请稍后再试");
        if (limits.size > 10000)
          for (const [k, v] of limits)
            if (now - v.start > 60000) limits.delete(k);
        let body = "",
          size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) throw new HttpError(413, "请求过大");
          body += chunk;
        }
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          throw new HttpError(400, "请求格式无效");
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new HttpError(400, "请求格式无效");
        if (url.pathname === "/api/session") {
          if (user) return json({ user: { name: user.name } });
          const s = store.session(input.name);
          res.setHeader(
            "Set-Cookie",
            `riichi_session=${s.token}; Path=${basePath || "/"}; HttpOnly; SameSite=Lax; Max-Age=7776000${origin.startsWith("https:") ? "; Secure" : ""}`,
          );
          return json({ user: { name: s.name } }, 201);
        }
        if (!user) throw new HttpError(401, "请先填写昵称");
        if (url.pathname === "/api/rooms")
          return json(store.create(user, input), 201);
        if (url.pathname === "/api/join")
          return json(store.join(user, input.code, input.seat));
        if (match?.[2] === "/events")
          return json(store.command(user, match[1], input));
        throw new HttpError(404, "接口不存在");
      }
      if (req.method !== "GET") throw new HttpError(405, "方法不支持");
      const files = {
        "/": ["public/index.html", "text/html"],
        "/app.js": ["public/app.js", "text/javascript"],
        "/style.css": ["public/style.css", "text/css"],
        "/art/ink-landscape.svg": [
          "public/art/ink-landscape.svg",
          "image/svg+xml",
        ],
        "/scoring.js": ["src/scoring.js", "text/javascript"],
      };
      if (!files[url.pathname]) throw new HttpError(404, "页面不存在");
      const [file, type] = files[url.pathname];
      res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
      const content = readFileSync(path.join(root, file));
      res.end(
        file === "public/index.html"
          ? content
              .toString()
              .replace('content="__BASE__"', `content="${basePath}"`)
          : content,
      );
    } catch (e) {
      const status = e.status ?? 500;
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(
        JSON.stringify({ error: status >= 500 ? "服务暂时不可用" : e.message }),
      );
    }
  });
  server.on("close", () => store.close());
  return { server, store };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3200),
    origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
  const { server } = createApp({
    dataDir: process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : undefined,
    origin,
    basePath: process.env.APP_BASE_PATH ?? "",
  });
  server.listen(port, process.env.HOST ?? "127.0.0.1", () =>
    console.log(`日麻记分 ${origin}${process.env.APP_BASE_PATH ?? ""}/`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
