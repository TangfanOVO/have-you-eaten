#!/usr/bin/env node
// 把上一层的网页（web/ 里的每一个文件，.bak-* 和隐藏文件除外）和菜单（dishes.txt）原样抄进
// src/generated/assets.ts，把 schema.sql 拆成一条一条抄进 src/generated/schema.ts。
// 只读上一层，一个字不改它。这样 Worker 一个文件夹装下全部，单独拿出去也能部署。
//
//   node scripts/sync-assets.mjs           抄一遍
//   node scripts/sync-assets.mjs --check   只看抄的是不是最新的（npm test 先跑这个）
//
// 上一层不在（比如这个文件夹被单独拿出去部署）：网页和菜单就用已经抄好的那份，只重抄 schema。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const UP = dirname(HERE);
const CHECK = process.argv.includes("--check");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
};
const TEXT = new Set([".html", ".js", ".css", ".svg", ".webmanifest", ".json"]);

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const stale = [];

function emit(file, body) {
  const p = join(HERE, file);
  const old = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (old === body) return;
  if (CHECK) stale.push(file);
  else {
    writeFileSync(p, body);
    console.log("写了 " + file);
  }
}

// ── 网页和菜单
const webDir = join(UP, "web");
if (existsSync(webDir) && existsSync(join(UP, "dishes.txt"))) {
  const files = readdirSync(webDir)
    .filter((f) => !f.startsWith(".") && !f.includes(".bak") && statSync(join(webDir, f)).isFile() && TYPES[extname(f)])
    .sort();
  const index = readFileSync(join(webDir, "index.html"), "utf8");
  if (!index.includes("app.js")) {
    console.error("✗ web/index.html 里找不到 app.js —— src/web.ts 的 patchIndex 要跟着改");
    process.exit(1);
  }
  const web = {};
  const hashes = {};
  for (const f of files) {
    const buf = readFileSync(join(webDir, f));
    hashes["web/" + f] = sha(buf);
    web[f] = TEXT.has(extname(f))
      ? { type: TYPES[extname(f)], body: buf.toString("utf8") }
      : { type: TYPES[extname(f)], body: buf.toString("base64"), base64: true };
  }
  const dishes = readFileSync(join(UP, "dishes.txt"), "utf8");
  hashes["dishes.txt"] = sha(Buffer.from(dishes, "utf8"));
  emit(
    "src/generated/assets.ts",
    [
      "// 自动生成，别手改：node scripts/sync-assets.mjs 从上一层原样抄过来的（web/ 里的文件、dishes.txt）。",
      "// 网页挂在 /u/<密钥>/ 底下要换的路径，是 Worker 发出去的时候换的（src/web.ts），这里还是原样。",
      "",
      "export interface WebFile {",
      "  type: string;",
      "  body: string;",
      "  base64?: boolean;",
      "}",
      "",
      `export const WEB: Record<string, WebFile> = ${JSON.stringify(web, null, 1)};`,
      "",
      `export const DISHES_TXT = ${JSON.stringify(dishes)};`,
      "",
      `export const SOURCE_SHA256: Record<string, string> = ${JSON.stringify(hashes, null, 2)};`,
      "",
    ].join("\n"),
  );
} else if (!existsSync(join(HERE, "src/generated/assets.ts"))) {
  console.error("✗ 上一层没有 web/ 和 dishes.txt，这里也没抄过 —— 要在 have-you-eaten 仓库里跑一次");
  process.exit(1);
} else {
  console.log("上一层不在，网页和菜单用已经抄好的那份");
}

// ── 表：schema.sql 拆成一条一条
const sql = readFileSync(join(HERE, "schema.sql"), "utf8");
const stmts = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);
emit(
  "src/generated/schema.ts",
  [
    "// 自动生成，别手改：node scripts/sync-assets.mjs 从 schema.sql 拆出来的。",
    `export const SCHEMA_STATEMENTS: string[] = ${JSON.stringify(stmts, null, 2)};`,
    "",
  ].join("\n"),
);

if (CHECK) {
  if (stale.length) {
    console.error("✗ 抄的不是最新的：" + stale.join("、") + " —— 跑一下 npm run sync");
    process.exit(1);
  }
  console.log("抄的都是最新的");
}
