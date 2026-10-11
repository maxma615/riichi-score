// Syntax / factory checks with the pinned Linux compiler; this is not device acceptance.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const compilerDir = process.argv[2];
if (!compilerDir)
  throw Error("Pass the miniprogram-compiler@0.2.3 bin/linux directory.");
const source = path.resolve(
  process.argv[3] || path.join(appRoot, "miniprogram"),
);
const output = path.resolve(
  process.argv[4] || path.join(appRoot, ".local/mini-template-check"),
);
const walk = (p) =>
  fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(p, e.name))
        : [path.relative(source, path.join(p, e.name))],
    );
const files = walk(source).sort();
for (const f of files.filter((f) => f.endsWith(".json"))) {
  const config = JSON.parse(fs.readFileSync(path.join(source, f), "utf8"));
  if (Object.keys(config.usingComponents || {}).length)
    throw Error("Custom components need a Developer Tools build: " + f);
}
const templates = files.filter((f) => f.endsWith(".wxml")),
  styles = files.filter((f) => f.endsWith(".wxss"));
const sourceHash = crypto.createHash("sha256");
for (const f of files) {
  sourceHash.update(f + "\0");
  sourceHash.update(fs.readFileSync(path.join(source, f)));
}
fs.mkdirSync(output, { recursive: true });
const results = [];
for (const [tool, args, count] of [
  ["wcc", ["-d", "-cc", "0", ...templates, "-gn", "$gwx"], templates.length],
  [
    "wcsc",
    [
      "-db",
      "-pc",
      String(styles.filter((f) => f !== "app.wxss").length),
      ...styles.filter((f) => f !== "app.wxss"),
      "app.wxss",
    ],
    styles.length,
  ],
]) {
  const binary = path.resolve(compilerDir, tool);
  try {
    fs.accessSync(binary, fs.constants.X_OK);
  } catch {
    fs.chmodSync(binary, 0o755);
  }
  const run = spawnSync(binary, args, {
    cwd: source,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.error || run.status !== 0)
    throw Error(tool + ": " + (run.error?.message || run.stderr));
  if (!run.stdout.length) throw Error(tool + " returned no output");
  const result = {
    tool,
    files: count,
    bytes: Buffer.byteLength(run.stdout),
    binarySha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(binary))
      .digest("hex"),
    outputSha256: crypto.createHash("sha256").update(run.stdout).digest("hex"),
    diagnostics: run.stderr.trim(),
  };
  fs.writeFileSync(path.join(output, tool + ".txt"), run.stdout);
  if (tool === "wcc") {
    globalThis.window = {};
    globalThis.__WXML_GLOBAL__ = {};
    const factory = new Function("global", run.stdout + ";return $gwx;")({});
    if (typeof factory !== "function")
      throw Error("Compiled WXML factory is missing.");
    result.factoryVerified = true;
    result.compilerVersion =
      run.stdout.match(/\/\*(v[^*]+)\*\//)?.[1] || "unknown";
  }
  results.push(result);
}
const evidence = {
  sourceSha256: sourceHash.digest("hex"),
  results,
  scope:
    "WXML/WXSS syntax and factory; no WeChat login, package, rendering or device acceptance",
};
fs.writeFileSync(
  path.join(output, "result.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
