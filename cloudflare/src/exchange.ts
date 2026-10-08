// 搬家：整本导出 / 导入。格式跟 Python 那份约好的一样：
//   {"format":"have-you-eaten","version":1,"exported_at":"…","settings":{…},
//    "shops":[…],"branches":[…],"meals":[…],"dishes":[…],"logs":[…],"taste":[…]}
// 每一行的列＝core.py SCHEMA 里那张表的全部列（编号、时间都在），原样搬，一个都不改。
import type { Clock } from "./clock";
import { ensureSchema } from "./core";
import { Bad, pyStr, pyTruthy } from "./py";

/** 本子里已经有东西了（回 409） */
export class NotEmpty extends Bad {}

export const SECTIONS: [string, string, string[]][] = [
  ["shops", "shop", ["id", "name", "cuisine", "note", "verdict", "created_at", "updated_at"]],
  ["branches", "branch", ["id", "shop_id", "city", "area", "label", "address", "platform", "note", "created_at"]],
  ["meals", "meal", ["id", "branch_id", "eaten_on", "slot", "place", "city", "photo", "src", "how", "total", "currency", "verdict", "note", "created_at"]],
  ["dishes", "dish", ["id", "shop_id", "name", "note", "created_at"]],
  ["logs", "dish_log", ["id", "meal_id", "dish_id", "name", "verdict", "price", "note", "created_at"]],
  ["taste", "taste", ["id", "kind", "item", "scope", "away", "note", "src", "created_at", "updated_at"]],
];

export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function exportBook(db: D1Database, clock: Clock): Promise<Record<string, unknown>> {
  await ensureSchema(db);
  const res = await db.batch([
    db.prepare("SELECT k, v FROM setting ORDER BY k"),
    ...SECTIONS.map(([, t, cols]) => db.prepare(`SELECT ${cols.join(",")} FROM ${t} ORDER BY id`)),
  ]);
  const out: Record<string, unknown> = { format: "have-you-eaten", version: 1, exported_at: isoSeconds(clock.now()) };
  out.settings = Object.fromEntries((res[0].results as { k: string; v: string | null }[]).map((r) => [r.k, r.v]));
  SECTIONS.forEach(([key], i) => (out[key] = res[i + 1].results));
  return out;
}

// ── 导入：一条 INSERT 带好多行、值直接写进 SQL（不占「每条最多 100 个参数」，免费版一次请求的查询次数也够用）。
// 一行自己就超过一条 SQL 的长度上限的（很长很长的备注），单独一条、值用参数带进去。
type Val = string | number | null;

function val(v: unknown, where: string): Val {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Bad(`${where} 有一个数看不懂`);
    return v;
  }
  if (typeof v === "string") return v.replace(/\u0000/g, "");
  throw new Bad(`${where} 有一栏不是文字也不是数`);
}

function lit(v: Val): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + v.replace(/'/g, "''") + "'";
}

const MAX_SQL = 90_000; // D1 一条 SQL 最长 100 KB
const enc = new TextEncoder();

function inserts(db: D1Database, table: string, cols: string[], rows: Val[][], tail = ""): D1PreparedStatement[] {
  const head = `INSERT INTO ${table} (${cols.join(",")}) VALUES `;
  const base = enc.encode(head + tail).length;
  const out: D1PreparedStatement[] = [];
  let cur: string[] = [];
  let size = base;
  const flush = () => {
    if (cur.length) out.push(db.prepare(head + cur.join(",") + tail));
    cur = [];
    size = base;
  };
  for (const r of rows) {
    const t = "(" + r.map(lit).join(",") + ")";
    const n = enc.encode(t).length + 1;
    if (base + n > MAX_SQL) {
      out.push(db.prepare(head + "(" + r.map(() => "?").join(",") + ")" + tail).bind(...r));
      continue;
    }
    if (cur.length && size + n > MAX_SQL) flush();
    cur.push(t);
    size += n;
  }
  flush();
  return out;
}

function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/FOREIGN KEY/i.test(m)) return "有的记录指向不存在的店 / 分店 / 一顿 / 菜（编号对不上）";
  if (/UNIQUE/i.test(m)) return "有重复的：同一个编号、同名的店、同一家店里同名的菜、或者同一样口味记了两条";
  if (/NOT NULL/i.test(m)) return "有一行缺了必填的一栏（店名、城市、哪天、口味那一样…）";
  if (/CHECK/i.test(m)) return "有一栏的值不在认得的范围里（评价、哪一顿、外卖还是堂食…）";
  if (/mismatch/i.test(m)) return "编号得是整数";
  return m.slice(0, 200);
}

export async function importBook(
  db: D1Database,
  data: unknown,
  force: boolean,
  now: Date,
): Promise<{ ok: true; counts: Record<string, number>; replaced: boolean; skipped: string[] }> {
  // 认不认这个文件：跟上一层 porter.py 的 _check 一样的几条、一样的话
  if (!data || typeof data !== "object" || Array.isArray(data) || (data as any).format !== "have-you-eaten") {
    throw new Bad("这不是「吃了吗」导出的文件");
  }
  const d = data as Record<string, any>;
  const v = d.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new Bad("文件里的 version 看不懂");
  if (v > 1) throw new Bad(`这个文件是新版本导出的（version ${v}），先把这边更新一下再导`);
  const settings = pyTruthy(d.settings) ? d.settings : {};
  if (typeof settings !== "object" || Array.isArray(settings)) throw new Bad("settings 应该是一组 键: 值");
  for (const [key] of SECTIONS) {
    const rows = pyTruthy(d[key]) ? d[key] : [];
    if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new Bad(`${key} 应该是一串记录`);
  }
  await ensureSchema(db);
  const cnt = await db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM shop)+(SELECT COUNT(*) FROM branch)+(SELECT COUNT(*) FROM meal)+" +
        "(SELECT COUNT(*) FROM dish)+(SELECT COUNT(*) FROM dish_log)+(SELECT COUNT(*) FROM taste) AS n",
    )
    .first<{ n: number }>();
  const nonEmpty = (cnt?.n ?? 0) > 0;
  if (nonEmpty && !force) {
    throw new NotEmpty("本子里已经有东西了 —— 导入只往空本子里倒。确定要用这份把整本换掉：在「搬家」那页勾上「整本换掉」，或者在地址后面加上 ?force=1（换之前先导出一份留着）");
  }
  const ts = now.toISOString().slice(0, 19).replace("T", " "); // 跟 datetime('now') 一个样子
  const DEFAULTS: Record<string, Val> = { created_at: ts, updated_at: ts, area: "", label: "", scope: "", away: 0, src: "page", currency: "CNY" };
  const st: D1PreparedStatement[] = [];
  if (force) {
    for (const t of ["dish_log", "meal", "dish", "branch", "shop", "taste"]) st.push(db.prepare(`DELETE FROM ${t}`));
  }
  st.push(db.prepare("DELETE FROM setting")); // 设置跟着这份走（城市、具体在哪）
  const counts: Record<string, number> = {};
  const skipped = new Set<string>(); // 这边不认的栏目：不导，告诉一声（跟 porter.py 一样）
  for (const [key, table, cols] of SECTIONS) {
    const rows = (pyTruthy(d[key]) ? d[key] : []) as Record<string, unknown>[];
    counts[key] = rows.length;
    const vals = rows.map((row, i) => {
      for (const k of Object.keys(row)) if (!cols.includes(k)) skipped.add(`${key}.${k}`);
      return cols.map((c) => (row[c] === undefined && c in DEFAULTS ? DEFAULTS[c] : val(row[c], `${key} 第 ${i + 1} 行`)));
    });
    st.push(...inserts(db, table, cols, vals));
  }
  const kv = Object.entries(settings).map(([k, v]) => [k, v === null || v === undefined ? null : val(pyStr(v), "settings")]);
  st.push(...inserts(db, "setting", ["k", "v"], kv as Val[][]));
  try {
    await db.batch(st); // 一个 batch ＝ 一个事务：哪一行不行，整本都不进
  } catch (e) {
    throw new Bad("没导进去，本子原样没动：" + explain(e));
  }
  return { ok: true, counts, replaced: nonEmpty, skipped: [...skipped].sort() };
}
