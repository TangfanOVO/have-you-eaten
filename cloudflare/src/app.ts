// 吃了吗 · have-you-eaten —— Cloudflare Worker 的路由（入口在 index.ts，这里放全部的事，测试也从这儿进）。
//
//   /mcp/<密钥>              给 claude.ai「自定义连接器」连的 MCP（Streamable HTTP）
//   /mcp/<密钥>/export       整本导出（一个 .json）
//   /u/<密钥>/               本子那一页（上一层 web/ 原样抄来的）
//   /u/<密钥>/api/…          那一页要用的接口（跟 web.py 一样）＋ /api/import 导入
//   /u/<密钥>/food/…         自建前端 / 网关用的（跟 web.py 一样：context、tools、ai）
//   /u/<密钥>/move           搬家：导出 / 导入的小页
//
// 密钥放在地址里，因为 claude.ai 的连接器加不了自定义请求头。密钥不对 → 404，跟没有这个地址一样。
import { isoOf, systemClock, wall, type Clock } from "./clock";
import { Book } from "./core";
import * as dice from "./dice";
import { exportBook, importBook, NotEmpty } from "./exchange";
import { handleMcp } from "./mcp";
import { Bad, _s } from "./py";
import { TOOLS, call } from "./tools";
import { STATIC } from "./web";

export interface Env {
  DB: D1Database;
  HYE_SECRET?: string;
  HYE_TZ?: string;
}

/** 测试可以换时钟、换骰子 */
export interface Hooks {
  clock?: Clock;
  rng?: () => number;
}

export const MIN_SECRET = 16;
const MAX_BODY = 30 * 1024 * 1024;

const COMMON = {
  "Cache-Control": "no-cache",
  "Referrer-Policy": "no-referrer", // 密钥在地址里：别让它顺着 Referer 跑到别的网站
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...COMMON, "Content-Type": "application/json; charset=utf-8" } });
}

function text(body: string, status = 200, type = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { ...COMMON, "Content-Type": type } });
}

const NOT_FOUND = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });

/** 两个字符串比一比，花的时间跟哪一位不一样无关 */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function secretOk(env: Env): string | null {
  const s = (env.HYE_SECRET || "").trim();
  if (/change-?me|your-?secret|example|placeholder/i.test(s)) return null; // 照抄了示例里那串的，不算设好
  return s.length >= MIN_SECRET && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

const SETUP_HINT =
  "「吃了吗」已经部署好了，还差一步：设一个密钥。\n\n" +
  "  npx wrangler secret put HYE_SECRET\n\n" +
  "密钥至少 16 位，只用字母、数字、- 和 _。生成一个：\n" +
  "  node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"\n\n" +
  "设好以后：\n  本子那一页   https://<这个地址>/u/<密钥>/\n  claude.ai 连接器   https://<这个地址>/mcp/<密钥>\n";

async function readJson(req: Request): Promise<any> {
  if (!(req.headers.get("Content-Type") || "").includes("application/json")) throw new Status(415, "要 JSON");
  const n = Number(req.headers.get("Content-Length") || 0);
  if (n > MAX_BODY) throw new Bad("太大了");
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new Bad("太大了");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Bad("看不懂");
  }
}

class Status extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handlePage(req: Request, rest: string, book: Book, env: Env, hooks: Hooks, page: string): Promise<Response> {
  // 别的网站借浏览器往这儿写：浏览器会带上 Origin，对不上就 403（自己这一页发的 Origin 就是自己）
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin) return json({ ok: false, err: "只给自己的页面用" }, 403);
  if (req.method === "GET" || req.method === "HEAD") {
    const st = Object.prototype.hasOwnProperty.call(STATIC, rest) ? STATIC[rest] : undefined;
    if (st) return new Response(st.body(), { headers: { ...COMMON, "Content-Type": st.type } });
    if (rest === "api/food") return json(await book.all());
    if (rest === "food/context") return text(await book.contextText());
    if (rest === "food/tools") return json(TOOLS);
    return json({ ok: false, err: "没有这一页" }, 404);
  }
  if (req.method !== "POST") return json({ ok: false, err: "没有这个口子" }, 405);
  const b = await readJson(req);
  const o = (k: string) => (b && typeof b === "object" && !Array.isArray(b) ? b[k] : undefined);
  switch (rest) {
    case "api/food/log":
      return json(await book.log(b));
    case "api/food/taste":
      return json(await book.taste(o("item"), o("kind"), o("note"), o("src") || "page", o("scope") || "", o("away") ?? null));
    case "api/food/edit":
      return json(await book.edit(o("kind"), o("id"), o("fields")));
    case "api/food/addlog":
      return json(await book.addlog(o("meal_id"), o("dish") || {}));
    case "api/food/del":
      return json(await book.delete(o("kind"), o("id")));
    case "api/settings":
      await book.setSettings([
        ["city", _s(o("city"), 60) || ""],
        ["spot", _s(o("spot"), 80) || ""],
      ]);
      return json({ ok: true });
    case "api/upload":
      throw new Bad("网页版还不能传照片（免费的 Cloudflare 上没有地方放图）。照片先留在相册里，这一顿的字照样能记。");
    case "api/food/dice":
      return json(dice.roll(await book.all(), o("mode") || "dish", o("kind") || "", o("want") || "", hooks.rng, o("only") || ""));
    case "food/ai":
      return text(await call(book, String(o("tool") || ""), o("input") || {}, hooks.rng, page));
    case "api/import": {
      const force = ["1", "true", "yes"].includes(new URL(req.url).searchParams.get("force") || "");
      return json(await importBook(env.DB, b, force, (hooks.clock ?? book.clock).now()));
    }
  }
  return json({ ok: false, err: "没有这个口子" }, 404);
}

export async function handle(req: Request, env: Env, hooks: Hooks = {}): Promise<Response> {
  const url = new URL(req.url);
  const secret = secretOk(env);
  if (!secret) {
    return url.pathname === "/" ? text(SETUP_HINT) : NOT_FOUND();
  }
  const m = /^\/(mcp|u)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  let given = "";
  try {
    given = m ? decodeURIComponent(m[2]) : "";
  } catch {
    return NOT_FOUND();
  }
  if (!m || !sameSecret(given, secret)) return NOT_FOUND();
  const [, area, , tail = ""] = m;
  const clock = hooks.clock ?? systemClock(env.HYE_TZ);
  const book = new Book(env.DB, clock);
  const page = `${url.origin}/u/${secret}/`; // food_page 回的地址：这个 Worker 自己那一页
  try {
    if (area === "mcp") {
      if (tail === "" || tail === "/") return await handleMcp(req, book, hooks.rng, page);
      if (tail === "/export" && (req.method === "GET" || req.method === "HEAD")) {
        const data = await exportBook(env.DB, clock);
        const w = wall(clock);
        const day = isoOf(w.y, w.m, w.d).replace(/-/g, ""); // 文件名用你那边的日子
        return new Response(JSON.stringify(data, null, 1), {
          headers: {
            ...COMMON,
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="have-you-eaten-${day}.json"`,
          },
        });
      }
      return NOT_FOUND();
    }
    if (tail === "") return Response.redirect(url.origin + url.pathname + "/" + url.search, 302); // 要带斜杠：页面里的地址都相对这一层
    return await handlePage(req, tail.slice(1), book, env, hooks, page);
  } catch (e) {
    if (e instanceof Status) return json({ ok: false, err: e.message }, e.status);
    if (e instanceof NotEmpty) return json({ ok: false, err: e.message }, 409);
    if (e instanceof Bad) return json({ ok: false, err: e.message }, 400);
    console.error(e);
    return json({ ok: false, err: "出错了：" + String(e instanceof Error ? e.message : e).slice(0, 200) }, 500);
  }
}

