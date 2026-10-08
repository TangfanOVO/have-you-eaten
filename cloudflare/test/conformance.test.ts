// 对照：TS 这份照 scenario.json 走一遍，每一步都要跟 Python 那份（expected.json，scripts/conformance.py 写的）一模一样。
// 跑在本机的 Workers 运行时里，D1 是真的 D1（Miniflare 的本机版），不是假的。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { Book } from "../src/core";
import * as dice from "../src/dice";
import { exportBook, importBook } from "../src/exchange";
import { Bad } from "../src/py";
import { SERVER_INFO } from "../src/mcp";
import { callText } from "../src/tools";
import { TOOLS } from "../src/tools-def";
import expected from "./fixtures/expected.json";
import scenario from "./fixtures/scenario.json";
import { fmtW, movableClock, seqRng, sha256, wipe } from "./helpers";

const DB = env.DB as D1Database;
const EXP = expected as any;
const SC = scenario as any;
const TS_COLS = new Set(["created_at", "updated_at"]);
const TABLES: [string, string][] = [
  ["shops", "shop"],
  ["branches", "branch"],
  ["meals", "meal"],
  ["dishes", "dish"],
  ["logs", "dish_log"],
  ["taste", "taste"],
];

async function columns(t: string): Promise<string[]> {
  return ((await DB.prepare(`PRAGMA table_info(${t})`).all()).results as any[]).map((r) => r.name);
}

async function state() {
  const out: Record<string, unknown> = {};
  for (const [key, t] of TABLES) {
    const cols = (await columns(t)).filter((c) => !TS_COLS.has(c));
    out[key] = (await DB.prepare(`SELECT ${cols.join(",")} FROM ${t} ORDER BY id`).all()).results;
  }
  const s = (await DB.prepare("SELECT k, v FROM setting ORDER BY k").all()).results as any[];
  out.settings = Object.fromEntries(s.map((r) => [r.k, r.v]));
  return out;
}

async function resolveId(v: any) {
  if (v && typeof v === "object" && "sql" in v) {
    const r = await DB.prepare(v.sql).raw();
    return r.length ? r[0][0] : null;
  }
  return v;
}

async function run(fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    return { ok: r === undefined ? null : r };
  } catch (e) {
    if (e instanceof Bad) return { bad: e.message };
    return { error: e instanceof Error ? e.constructor.name + ": " + e.message : String(e) };
  }
}

const clock = movableClock(SC.clock.now_utc, SC.clock.tz);
const book = new Book(DB, clock);
const got: any[] = [];
const gotDice: any[] = [];

async function diceCase(d0: any, c: any) {
  const d = { ...d0, taste: c.taste === null ? d0.taste : c.taste };
  const kind = c.kind ?? "";
  const want = c.want ?? "";
  const only = (c.only ?? "").trim();
  const R = dice.rules(d.taste, want);
  const keep: dice.Candidate[] = [];
  const removedNames: string[] = [];
  for (const x of dice.pool(d, kind)) {
    if (only && x.cuisine !== only) continue;
    const r = dice.judge(x, R);
    if (r === null) removedNames.push(x.name);
    else keep.push({ x, w: r[0], notes: r[1] });
  }
  const lines = keep.map((k) =>
    [k.x.name, k.x.cuisine, k.x.kind, fmtW(k.w), k.notes.join("/"), k.x.hist ? dice.histLine(k.x.hist) : "", k.x.mine ? "mine" : ""].join("|"),
  );
  const special = lines.filter((_, j) => keep[j].w !== 1 || keep[j].notes.length || keep[j].x.hist || keep[j].x.mine);
  const by = new Map<string, number>();
  for (const k of keep) by.set(k.x.cuisine, (by.get(k.x.cuisine) ?? 0) + 1);
  const ways = [...by].map(([c, n]) => [
    c,
    fmtW((R.love_cuis.has(c) ? 3 : 1) * (R.want_cuis.has(c) ? 20 : 1) * (1 + 0.15 * Math.min(n, 10))),
    n,
  ]);
  // 跟 candidates() 对一下：骰子真正用的那一份跟这里算的是同一份
  const cand = dice.candidates(d, kind, want, c.only ?? "");
  expect(cand.keep.map((k) => k.x.name)).toEqual(keep.map((k) => k.x.name));
  const r = dice.roll(d, c.mode ?? "dish", kind, want, seqRng(c.rng), c.only ?? "");
  return {
    label: c.label,
    count: keep.length,
    removed: removedNames.length,
    kept_sha: await sha256(lines.join("\n")),
    removed_sha: await sha256(removedNames.join("\n")),
    special,
    ways,
    roll: r,
    text: dice.text(r),
  };
}

beforeAll(async () => {
  await wipe(DB);
  for (const [i, op] of (SC.ops as any[]).entries()) {
    let res: Record<string, unknown>;
    switch (op.op) {
      case "setting":
        res = await run(() => book.setSetting(op.k, op.v));
        break;
      case "log":
        res = await run(() => book.log(op.body));
        break;
      case "taste": {
        const a = op.args;
        res = await run(() => book.taste(a.item, a.kind, a.note ?? null, a.src ?? "page", a.scope ?? "", a.away ?? null));
        break;
      }
      case "edit":
        res = await run(async () => book.edit(op.kind, await resolveId(op.id), op.fields));
        break;
      case "delete":
        res = await run(async () => book.delete(op.kind, await resolveId(op.id)));
        break;
      case "addlog":
        res = await run(() => book.addlog(op.meal_id, op.dish));
        break;
      case "tool": {
        const t = await callText(book, op.name, op.args ?? {}, seqRng(op.rng), SC.page);
        res = { text: t.startsWith("（本子没翻开：") ? "（本子没翻开：…）" : t };
        break;
      }
      case "normalize_ts":
        await DB.batch((SC.normalize_ts as string[]).map((s) => DB.prepare(s)));
        res = { ok: null };
        break;
      case "clock":
        clock.set(op.now_utc, op.tz);
        res = { ok: null };
        break;
      case "book": {
        const a = op.args;
        res = await run(() => book.bookText(a.view ?? "", a.city ?? "", a.q ?? "", a.days ?? 7));
        break;
      }
      case "context":
        res = await run(() => book.contextText());
        break;
      case "all":
        res = await run(() => book.all());
        break;
      case "state":
        res = { ok: await state() };
        break;
      case "export": {
        const e = await exportBook(DB, clock);
        delete (e as any).exported_at;
        res = { ok: e };
        break;
      }
      default:
        throw new Error("不认得的一步：" + op.op);
    }
    got.push({ i, op: op.op, ...res });
  }
  const d0 = await book.all();
  for (const c of SC.dice) gotDice.push(await diceCase(d0, c));
});

describe("跟 Python 那份对照（scripts/conformance.py → expected.json）", () => {
  it("expected.json 是照这份 scenario.json 跑出来的", () => {
    expect(EXP.ops.length).toBe(SC.ops.length);
    expect(EXP.dice.length).toBe(SC.dice.length);
  });

  it("每只手的名字、说明、参数一字不差", () => {
    expect(TOOLS).toEqual(EXP.tools);
  });

  it("版本号跟上一层一样（manifest.json ＝ mcp_server.py 的 initialize）", () => {
    expect(SERVER_INFO.version).toBe(EXP.server_version);
  });

  it("菜单读出来的道数一样", () => {
    expect(dice.menu().length).toBe(EXP.menu_count);
  });

  it("D1 里建出来的表跟 core.py 的一样（列、类型、非空、默认值、主键）", async () => {
    for (const [, t] of [...TABLES, ["setting", "setting"]]) {
      const cols = ((await DB.prepare(`PRAGMA table_info(${t})`).all()).results as any[]).map((r) => [r.name, r.type, r.notnull, r.dflt_value, r.pk]);
      expect(cols, t).toEqual(EXP.tables[t]);
    }
  });

  for (const [i, op] of (SC.ops as any[]).entries()) {
    const brief = JSON.stringify(op).slice(0, 110);
    it(`第 ${i} 步 ${brief}`, () => {
      expect(got[i]).toEqual(EXP.ops[i]);
    });
  }

  it("导出的每一行，列的先后也跟 core.py 的表一样", () => {
    const e = got.find((g) => g.op === "export").ok;
    const p = EXP.ops.find((g: any) => g.op === "export").ok;
    expect(Object.keys(e)).toEqual(["format", "version", "settings", "shops", "branches", "meals", "dishes", "logs", "taste"]);
    for (const [key] of TABLES) {
      expect(e[key].length, key).toBeGreaterThan(0);
      expect(Object.keys(e[key][0]), key).toEqual(Object.keys(p[key][0]));
    }
  });

  for (const [i, c] of (SC.dice as any[]).entries()) {
    it(`骰子 ${i}：${c.label}`, () => {
      const g = gotDice[i];
      const e = EXP.dice[i];
      expect({ count: g.count, removed: g.removed }).toEqual({ count: e.count, removed: e.removed });
      expect(g.special).toEqual(e.special);
      expect(g.kept_sha, "剔完剩下的那一串").toBe(e.kept_sha);
      expect(g.removed_sha, "剔掉的那一串").toBe(e.removed_sha);
      expect(g.ways).toEqual(e.ways);
      expect(g.roll).toEqual(e.roll);
      expect(g.text).toBe(e.text);
    });
  }
});

describe("Python 导出的那份，倒进 D1 以后读出来也一样", () => {
  it("导入 Python 的导出，再翻本子，每一段都跟 Python 一样", async () => {
    const exportIdx = EXP.ops.findIndex((g: any) => g.op === "export");
    const pyExport = { ...EXP.ops[exportIdx].ok, exported_at: "2026-10-08T03:30:00Z" };
    await wipe(DB);
    const c2 = movableClock(SC.clock.now_utc, SC.clock.tz);
    const b2 = new Book(DB, c2);
    const r = await importBook(DB, pyExport, false, c2.now());
    expect(r.ok).toBe(true);
    // 导出那一步之前、normalize 之后的那些读：本子是同一个样子
    const normIdx = EXP.ops.findIndex((g: any) => g.op === "normalize_ts");
    let n = 0;
    for (let i = normIdx + 1; i < exportIdx; i++) {
      const op = SC.ops[i];
      let res: any;
      if (op.op === "book") res = await run(() => b2.bookText(op.args.view ?? "", op.args.city ?? "", op.args.q ?? "", op.args.days ?? 7));
      else if (op.op === "context") res = await run(() => b2.contextText());
      else if (op.op === "all") res = await run(() => b2.all());
      else if (op.op === "tool") res = { text: await callText(b2, op.name, op.args ?? {}, seqRng(op.rng), SC.page) };
      else continue;
      expect({ i, op: op.op, ...res }, `第 ${i} 步`).toEqual(EXP.ops[i]);
      n++;
    }
    expect(n).toBeGreaterThan(15);
    // 再导出来，跟倒进去的那份一模一样
    const again = await exportBook(DB, c2);
    expect({ ...again, exported_at: "x" }).toEqual({ ...pyExport, exported_at: "x" });
  });
});
