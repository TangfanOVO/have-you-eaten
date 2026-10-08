// 整个 Worker 从外面敲：路由、密钥、MCP、网页那一页和它用的接口、导出导入、传照片。
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handle, type Env } from "../src/app";
import { SCHEMA_STATEMENTS } from "../src/generated/schema";
import { TOOLS } from "../src/tools-def";
import { INDEX_HTML, patchIndex } from "../src/web";
import schemaSql from "../schema.sql?raw";
import { SECRET, movableClock, seqRng, wipe } from "./helpers";

const E = env as unknown as Env;
const H = "https://hye.example.workers.dev";
const clock = movableClock("2026-10-08T03:30:00Z", "Australia/Sydney");
const hooks = { clock, rng: seqRng([0.25]) };

function req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  return handle(new Request(H + path, { ...init, headers, body, method: init.method ?? (body !== undefined ? "POST" : "GET") }), E, hooks);
}

async function rpc(msg: unknown, headers: Record<string, string> = {}) {
  const r = await req(`/mcp/${SECRET}`, { json: msg, headers: { Accept: "application/json, text/event-stream", ...headers } });
  return { status: r.status, body: r.status === 202 ? null : await r.json<any>() };
}

async function tool(name: string, args: unknown): Promise<string> {
  const r = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
  return r.body.result.content[0].text;
}

beforeEach(async () => {
  await wipe(E.DB);
});

describe("密钥", () => {
  it("密钥不对、没带、或者路径不对：一律 404", async () => {
    for (const p of ["/", "/mcp/wrong-secret-0123456789", `/mcp/${SECRET}x`, "/u/nope/", "/u/", "/api/food", `/x/${SECRET}/`, "/mcp/%E0%A4%A"]) {
      expect((await req(p)).status, p).toBe(404);
    }
    expect((await req("/mcp/wrong-secret-0123456789", { json: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status).toBe(404);
  });

  it("还没设密钥（或者太短）：首页说怎么设，别的地方 404", async () => {
    for (const s of [undefined, "short", "has spaces in it 12345", "change-me-to-a-long-random-string"]) {
      const env2 = { ...E, HYE_SECRET: s };
      const root = await handle(new Request(H + "/"), env2);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("wrangler secret put HYE_SECRET");
      expect((await handle(new Request(`${H}/mcp/${s}`), env2)).status).toBe(404);
    }
  });

  it("默认导出（真正部署的那个入口）也走同一套", async () => {
    const r = await (exports as any).default.fetch(new Request(`${H}/u/${SECRET}/api/food`));
    expect(r.status).toBe(200);
    expect((await (exports as any).default.fetch(new Request(`${H}/u/nope/api/food`))).status).toBe(404);
  });
});

describe("MCP（claude.ai 连接器）", () => {
  it("initialize：认 2025-06-18，不认得的版本回最新的", async () => {
    const a = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(a.body.result.protocolVersion).toBe("2025-06-18");
    expect(a.body.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(a.body.result.serverInfo.name).toBe("have-you-eaten");
    const b = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    expect(b.body.result.protocolVersion).toBe("2025-06-18");
    expect(a.body.result.serverInfo.version).toBe("0.2.1");
    const c = await rpc({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(c.body.result.protocolVersion).toBe("2025-03-26");
  });

  it("通知回 202、ping 回 {}、不认得的方法回 -32601、坏 JSON 回 -32700", async () => {
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" })).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect((await rpc({ jsonrpc: "2.0", id: 2, method: "resources/list" })).body.error.code).toBe(-32601);
    const bad = await req(`/mcp/${SECRET}`, { method: "POST", body: "{nope", headers: { "Content-Type": "application/json" } });
    expect(bad.status).toBe(400);
    expect((await bad.json<any>()).error.code).toBe(-32700);
    expect((await rpc({ jsonrpc: "2.0", id: 1, result: {} })).status).toBe(202); // 对面回的结果
  });

  it("GET / DELETE 回 405；版本头不对回 400", async () => {
    expect((await req(`/mcp/${SECRET}`)).status).toBe(405);
    expect((await req(`/mcp/${SECRET}`, { method: "DELETE" })).status).toBe(405);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { "MCP-Protocol-Version": "1999-01-01" })).status).toBe(400);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { "MCP-Protocol-Version": "2025-06-18" })).status).toBe(200);
  });

  it("tools/list：六只手，跟 Python 的定义一样，另外标了哪只只读", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const ts = r.body.result.tools;
    expect(ts.map((t: any) => t.name)).toEqual(["food_note", "food_taste", "food_book", "food_dice", "food_rate", "food_page"]);
    expect(ts.every((t: any) => t.annotations && t.annotations.title)).toBe(true);
    expect(ts.map(({ annotations, ...t }: any) => t)).toEqual(TOOLS);
    expect(ts.find((t: any) => t.name === "food_book").annotations.readOnlyHint).toBe(true);
  });

  it("四只手走一遍", async () => {
    expect(await tool("food_note", { shop: "面馆", city: "重庆", dishes: [{ name: "小面", verdict: "好吃" }] })).toBe(
      "记下了：面馆 · 小面（好吃）。Ta 在「吃了吗」页面上看得到。",
    );
    expect(await tool("food_taste", { item: "香菜", kind: "不爱吃" })).toBe("记上了：不爱吃 · 香菜。");
    const book = await tool("food_book", {});
    expect(book).toContain("〔吃了吗 · 重庆〕Ta 现在在重庆，今天 2026-10-08（周四）。");
    expect(book).toContain("【口味单】不爱吃：香菜");
    expect(await tool("food_dice", { want: "鸡" })).toMatch(/^丢到：.+（从 \d+ 道里丢的，按口味单剔掉了 \d+ 道，往「鸡」上偏了）$/);
    expect(await tool("food_note", {})).toBe("（没记上：吃了什么写一样呀）");
    expect(await tool("food_rate", { dish: "小面", verdict: "踩雷", note: "坨了" })).toBe("改好了：10-08 午饭 小面 → 踩雷。");
    expect(await tool("food_rate", { dish: "佛跳墙", verdict: "好吃" })).toBe("（没记上：最近这几顿里没有「佛跳墙」 —— 是哪天、哪家的？）");
    expect(await tool("nope", {})).toBe("（没有这只手）");
    // 本子在哪：这个 Worker 自己的 /u/<密钥>/（跟 remote.py 同一句）
    expect(await tool("food_page", {})).toBe(
      `本子在 ${H}/u/${SECRET}/ （手机、电脑的浏览器都能开；能记、改、删。地址里带着暗号，只给 Ta 本人）。`,
    );
  });

  it("一次发一串（老一点的客户端）", async () => {
    const r = await rpc([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(r.body.map((x: any) => x.id)).toEqual([1, 2]);
  });
});

describe("网页那一页", () => {
  it("/u/<密钥> 跳到带斜杠的地址；页面里的路径换成相对的，app.js 原样", async () => {
    const r = await req(`/u/${SECRET}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(`${H}/u/${SECRET}/`);
    const p = await req(`/u/${SECRET}/`);
    const html = await p.text();
    expect(p.headers.get("Content-Type")).toContain("text/html");
    expect(p.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(html).toContain("s.src = 'app.js'");
    expect(html).toContain('href="icon.svg"');
    expect(html).toContain("window.fetch=function");
    expect(html).not.toContain("'/app.js'");
    expect(html).toBe(patchIndex(INDEX_HTML));
    const js = await req(`/u/${SECRET}/app.js`);
    expect(js.headers.get("Content-Type")).toContain("javascript");
    expect(await js.text()).toContain("window.__foodUI");
    expect((await req(`/u/${SECRET}/icon.svg`)).headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await (await req(`/u/${SECRET}/move`)).text()).toContain("搬家");
    // 加到主屏幕用的：图标和 manifest，地址也是相对的
    expect(html).toContain('href="manifest.webmanifest"');
    const mf = await (await req(`/u/${SECRET}/manifest.webmanifest`)).json<any>();
    expect(mf.icons.every((i: any) => !i.src.startsWith("/"))).toBe(true);
    const png = await req(`/u/${SECRET}/icon-180.png`);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect([...new Uint8Array(await png.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("换路径那一段：fetch('/api/…') 变成相对这一页的地址", () => {
    const html = patchIndex(INDEX_HTML);
    const a = html.indexOf("(function(){var f=window.fetch");
    const shim = html.slice(a, html.indexOf("</script>", a));
    const seen: string[] = [];
    const w: any = { fetch: (u: string) => seen.push(u) };
    new Function("window", shim)(w);
    w.fetch("/api/food");
    w.fetch("api/food");
    w.fetch("//evil.example/x");
    w.fetch("https://a.example/b");
    expect(seen).toEqual(["api/food", "api/food", "//evil.example/x", "https://a.example/b"]);
  });

  it("页面用的接口：记、改、加、删、口味、设置、骰子", async () => {
    const log = await (await req(`/u/${SECRET}/api/food/log`, {
      json: { shop: { name: "川味小馆" }, branch: { city: "重庆" }, meal: { slot: "晚饭" }, dishes: [{ name: "辣子鸡", verdict: "踩雷" }] },
    })).json<any>();
    expect(log).toEqual({ ok: true, shop_id: 1, branch_id: 1, meal_id: 1 });
    expect(await (await req(`/u/${SECRET}/api/food/addlog`, { json: { meal_id: 1, dish: { name: "米饭" } } })).json()).toEqual({ ok: true, log_id: 2 });
    expect(await (await req(`/u/${SECRET}/api/food/edit`, { json: { kind: "shop", id: 1, fields: { verdict: "bad" } } })).json()).toEqual({ ok: true });
    expect(await (await req(`/u/${SECRET}/api/food/taste`, { json: { item: "香菜", kind: "不爱吃" } })).json()).toEqual({ ok: true, id: 1, moved: false });
    expect(await (await req(`/u/${SECRET}/api/settings`, { json: { city: "悉尼", spot: "Mascot" } })).json()).toEqual({ ok: true });
    const d = await (await req(`/u/${SECRET}/api/food`)).json<any>();
    expect(d.here).toEqual({ city: "悉尼", spot: "Mascot", home: "", today: "2026-10-08" });
    expect(d.shops[0].verdict).toBe("bad");
    expect(d.taste[0]).toMatchObject({ item: "香菜", kind: "hate", away: false });
    const roll = await (await req(`/u/${SECRET}/api/food/dice`, { json: { mode: "dish", only: "川菜" } })).json<any>();
    expect(roll.ok).toBe(true);
    expect(roll.cuisine).toBe("川菜");
    expect(roll.only).toBe("川菜");
    expect(await (await req(`/u/${SECRET}/api/food/del`, { json: { kind: "log", id: 2 } })).json()).toEqual({ ok: true });
    expect((await (await req(`/u/${SECRET}/api/food`)).json<any>()).dishes.map((x: any) => x.name)).toEqual(["辣子鸡"]);
    expect(await (await req(`/u/${SECRET}/api/food/del`, { json: { kind: "shop", id: 1 } })).json()).toEqual({ ok: true });
    const after = await (await req(`/u/${SECRET}/api/food`)).json<any>();
    expect([after.shops.length, after.branches.length, after.meals.length, after.dishes.length, after.logs.length]).toEqual([0, 0, 0, 0, 0]);
  });

  it("出错的样子：说不清的 400、不是 JSON 415、别的网站 403、没有的口子 404", async () => {
    const r = await req(`/u/${SECRET}/api/food/taste`, { json: { item: "x", kind: "yum" } });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, err: "爱吃 / 不爱吃 / 不能吃 只认这三样" });
    expect((await req(`/u/${SECRET}/api/settings`, { method: "POST", body: "city=x", headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await req(`/u/${SECRET}/api/food/taste`, { json: { item: "x", kind: "love" }, headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await req(`/u/${SECRET}/api/food/taste`, { json: { item: "x", kind: "love" }, headers: { Origin: H } })).status).toBe(200);
    expect((await req(`/u/${SECRET}/api/nope`, { json: {} })).status).toBe(404);
    expect((await req(`/u/${SECRET}/nope.html`)).status).toBe(404);
    expect((await req(`/u/${SECRET}/api/food/edit`, { json: { kind: "shop", id: "abc", fields: { note: "x" } } })).status).toBe(500);
  });

  it("传照片：说清楚还不支持", async () => {
    const r = await req(`/u/${SECRET}/api/upload`, { json: { dataURL: "data:image/png;base64,AAAA" } });
    expect(r.status).toBe(400);
    const j = await r.json<any>();
    expect(j.ok).toBe(false);
    expect(j.err).toContain("还不能传照片");
  });

  it("自建前端用的那三个口子（跟 web.py 一样）", async () => {
    expect(await (await req(`/u/${SECRET}/food/context`)).text()).toContain("〔吃了吗〕今天 2026-10-08（周四）");
    expect(await (await req(`/u/${SECRET}/food/tools`)).json()).toEqual(TOOLS);
    const t = await req(`/u/${SECRET}/food/ai`, { json: { tool: "food_taste", input: { item: "奶茶", kind: "爱吃" } } });
    expect(await t.text()).toBe("记上了：爱吃 · 奶茶。");
  });
});

describe("搬家：导出 / 导入", () => {
  async function seed() {
    await tool("food_note", { shop: "面馆", city: "重庆", area: "解放碑", dishes: [{ name: "小面", verdict: "好吃", price: 12 }], total: 12.5 });
    await tool("food_note", { place: "家里", dishes: [{ name: "煎蛋" }] });
    await tool("food_taste", { item: "香菜", kind: "不爱吃", away: true, note: "一点都不要" });
  }

  it("导出：约好的格式，下载成一个文件", async () => {
    await seed();
    const r = await req(`/mcp/${SECRET}/export`);
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="have-you-eaten-20261008.json"');
    const d = await r.json<any>();
    expect(Object.keys(d)).toEqual(["format", "version", "exported_at", "settings", "shops", "branches", "meals", "dishes", "logs", "taste"]);
    expect(d.format).toBe("have-you-eaten");
    expect(d.version).toBe(1);
    expect(d.exported_at).toBe("2026-10-08T03:30:00Z");
    expect(d.settings).toEqual({ city: "重庆" });
    expect(Object.keys(d.taste[0])).toEqual(["id", "kind", "item", "scope", "away", "note", "src", "created_at", "updated_at"]);
    expect(d.taste[0]).toMatchObject({ item: "香菜", away: 1, note: "一点都不要", src: "chat" });
    expect(d.meals.map((m: any) => m.total)).toEqual([12.5, null]);
  });

  it("导入：只往空本子里倒；有东西 409；?force=1 整本换掉；导出再导入一模一样", async () => {
    await seed();
    const snap = await (await req(`/mcp/${SECRET}/export`)).json<any>();
    const busy = await req(`/u/${SECRET}/api/import`, { json: snap });
    expect(busy.status).toBe(409);
    expect((await busy.json<any>()).err).toContain("?force=1");

    await wipe(E.DB);
    await (await req(`/u/${SECRET}/api/settings`, { json: { city: "悉尼" } })).json(); // 只有设置不算有东西
    const ok = await (await req(`/u/${SECRET}/api/import`, { json: snap })).json<any>();
    expect(ok).toEqual({ ok: true, counts: { shops: 1, branches: 1, meals: 2, dishes: 1, logs: 2, taste: 1 }, replaced: false, skipped: [] });
    const again = await (await req(`/mcp/${SECRET}/export`)).json<any>();
    expect(again).toEqual(snap);

    // 换一份更小的，整本换掉
    const small = { ...snap, shops: [], branches: [], dishes: [], meals: [snap.meals[1]], logs: [snap.logs[1]], settings: { city: "墨尔本" } };
    const forced = await (await req(`/u/${SECRET}/api/import?force=1`, { json: small })).json<any>();
    expect(forced.replaced).toBe(true);
    const now = await (await req(`/u/${SECRET}/api/food`)).json<any>();
    expect([now.shops.length, now.meals.length, now.logs.length, now.taste.length, now.here.city, now.here.spot]).toEqual([0, 1, 1, 1, "墨尔本", ""]);

    // 导完还能接着记：编号接在后面
    expect(await tool("food_note", { shop: "新店", city: "墨尔本", dishes: [{ name: "x" }] })).toContain("记下了：新店");
  });

  it("导入的东西对不上：整本不进，原来的一点没动", async () => {
    await seed();
    const before = await (await req(`/mcp/${SECRET}/export`)).json<any>();
    const broken = { ...before, logs: [...before.logs, { id: 99, meal_id: 12345, dish_id: null, name: "孤儿", verdict: null, price: null, note: null }] };
    const r = await req(`/u/${SECRET}/api/import?force=1`, { json: broken });
    expect(r.status).toBe(400);
    expect((await r.json<any>()).err).toContain("编号对不上");
    expect(await (await req(`/mcp/${SECRET}/export`)).json()).toEqual(before);
    const said = async (bad: unknown) => (await (await req(`/u/${SECRET}/api/import?force=1`, { json: bad })).json<any>()).err;
    expect(await said({ format: "x", version: 1 })).toBe("这不是「吃了吗」导出的文件");
    expect(await said([])).toBe("这不是「吃了吗」导出的文件");
    expect(await said({ format: "have-you-eaten", version: "1" })).toBe("文件里的 version 看不懂");
    expect(await said({ format: "have-you-eaten", version: 2 })).toBe("这个文件是新版本导出的（version 2），先把这边更新一下再导");
    expect(await said({ format: "have-you-eaten", version: 1, settings: [1] })).toBe("settings 应该是一组 键: 值");
    expect(await said({ format: "have-you-eaten", version: 1, shops: { a: 1 } })).toBe("shops 应该是一串记录");
    expect(await said({ format: "have-you-eaten", version: 1, logs: [1] })).toBe("logs 应该是一串记录");
    expect(await (await req(`/mcp/${SECRET}/export`)).json()).toEqual(before);
    // 不认的栏目：不导，说一声；空着的段（null）当没有
    const extra = { ...before, shops: before.shops.map((x: any) => ({ ...x, stars: 5 })), dishes: null };
    const r2 = await (await req(`/u/${SECRET}/api/import?force=1`, { json: { ...extra, dishes: before.dishes } })).json<any>();
    expect(r2.skipped).toEqual(["shops.stars"]);
    expect((await req(`/u/${SECRET}/api/import?force=1`, { json: { format: "have-you-eaten", version: 1, dishes: null } })).status).toBe(200);
  });

  it("引号、换行、表情、很长的一段也原样进出", async () => {
    const note = "她说：'别再点了' \"真的\"\n第二行 😤 " + "很长".repeat(30000); // 一条 SQL 装不下，要拆
    const data = {
      format: "have-you-eaten",
      version: 1,
      exported_at: "2026-10-08T00:00:00Z",
      settings: { city: "重庆" },
      shops: [{ id: 3, name: "O'Brien's", cuisine: null, note, verdict: "good", created_at: "2026-10-01 00:00:00", updated_at: "2026-10-01 00:00:00" }],
      branches: [],
      meals: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, branch_id: null, eaten_on: "2026-10-01", slot: "午饭", place: "家里", city: "重庆", photo: null, src: "page", how: null, total: i + 0.5, currency: "CNY", verdict: null, note: "x".repeat(4000), created_at: "2026-10-01 00:00:00" })),
      dishes: [],
      logs: [],
      taste: [{ id: 1, kind: "love", item: "麻油", scope: "面", away: true, note: null, src: "page" }],
    };
    const r = await (await req(`/u/${SECRET}/api/import`, { json: data })).json<any>();
    expect(r.ok).toBe(true);
    const out = await (await req(`/mcp/${SECRET}/export`)).json<any>();
    expect(out.shops[0].note).toBe(note);
    expect(out.shops[0].name).toBe("O'Brien's");
    expect(out.meals.length).toBe(40);
    expect(out.taste[0]).toMatchObject({ away: 1, scope: "面" }); // 没给的时间：按导入那一刻补上
    expect(out.taste[0].created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });
});

describe("别的", () => {
  it("schema.sql 拆出来的就是 Worker 建表用的那几条", () => {
    const stmts = schemaSql
      .split("\n")
      .filter((l: string) => !l.trim().startsWith("--"))
      .join("\n")
      .split(/;\s*(?:\n|$)/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    expect(stmts).toEqual(SCHEMA_STATEMENTS);
  });

  it("两只手同时写同一家店：都记上，店只有一家，编号不撞", async () => {
    const rs = await Promise.all(
      [1, 2, 3].map((i) => req(`/u/${SECRET}/api/food/log`, { json: { shop: { name: "同一家" }, branch: { city: "重庆" }, dishes: [{ name: "菜" + i }] } }).then((r) => r.json<any>())),
    );
    expect(rs.every((r) => r.ok)).toBe(true);
    const d = await (await req(`/u/${SECRET}/api/food`)).json<any>();
    expect(d.shops.length).toBe(1);
    expect(d.meals.length).toBe(3);
    expect(new Set(d.meals.map((m: any) => m.id)).size).toBe(3);
  });

  it("D1 认外键：删一家店，分店、每一顿、菜跟着走", async () => {
    await tool("food_note", { shop: "面馆", city: "重庆", dishes: [{ name: "小面" }] });
    await req(`/u/${SECRET}/api/food/del`, { json: { kind: "shop", id: 1 } });
    const n = await E.DB.prepare("SELECT (SELECT COUNT(*) FROM branch)+(SELECT COUNT(*) FROM meal)+(SELECT COUNT(*) FROM dish)+(SELECT COUNT(*) FROM dish_log) AS n").first<any>();
    expect(n.n).toBe(0);
  });

  it("表被删了：下一次请求自己建回来", async () => {
    await E.DB.prepare("DROP TABLE taste").run();
    expect(await tool("food_taste", { item: "香菜", kind: "不爱吃" })).toBe("记上了：不爱吃 · 香菜。");
  });
});
