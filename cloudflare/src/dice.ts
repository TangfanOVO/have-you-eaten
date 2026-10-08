// 这顿吃什么 —— 菜谱骰子（dice.py 照着搬过来）。
//
// 菜单在 dishes.txt：一行一道「菜名|菜系|类别|用料,用料」（npm run sync 原样抄进 src/generated/assets.ts）。
// 再并上本子里 Ta 自己记过的菜（踩过雷的不进来）。
//
// 怎么剔，全照口味单：
//   · 写的是一个菜系（川菜、日料、东南亚、外国菜…）：不能吃 / 不爱吃 ＝ 那个菜系整个不丢；爱吃 ＝ 更容易丢中
//   · 不能吃：菜名或用料里有，整道剔掉（牛羊 ＝ 牛肉、羊肉；牛蛙不算牛）
//   · 不爱吃：菜名里有、或者它就是主料，整道剔掉；只在配料里（葱、香菜、辣椒…），留着，提醒「点的时候备注不要 X」
//   · 带搭配的（炒菜里不要姜）：不剔，只提醒
//   · 爱吃的：更容易丢中（×3）；临时想吃的（want）：×20，大约八成丢到它
// 两种丢法：dish 丢一道菜；way 丢一个方向（只出菜系，给几道例子）。
//
// 随机数可以换（rng）：测试里塞一串固定的数，跟 Python 那边塞同一串，丢出来的一模一样。
import type { Data, Shop } from "./core";
import { DISHES_TXT } from "./generated/assets";
import { choice, cpLen, lookup, pyStrip } from "./py";

export const CUISINES = [
  "川菜", "湘菜", "粤菜", "港式", "闽菜", "江浙菜", "鲁菜", "京菜", "徽菜", "东北菜", "西北菜", "新疆菜",
  "云贵菜", "台湾菜", "家常菜", "日料", "韩餐", "泰国菜", "越南菜", "东南亚", "印度菜", "西餐", "快餐", "轻食",
];
export const FOREIGN = new Set(["日料", "韩餐", "泰国菜", "越南菜", "东南亚", "印度菜", "西餐", "快餐", "轻食"]);
export const KINDS = ["饭", "面粉", "菜", "汤粥", "小吃", "锅"];

// 口味单里写的菜系，各种叫法都认
export const ALIAS = new Map(
  Object.entries({
    四川菜: "川菜", 重庆菜: "川菜", 湖南菜: "湘菜", 广东菜: "粤菜", 港餐: "港式", 茶餐厅: "港式", 福建菜: "闽菜",
    浙菜: "江浙菜", 苏菜: "江浙菜", 上海菜: "江浙菜", 本帮菜: "江浙菜", 山东菜: "鲁菜", 北京菜: "京菜", 安徽菜: "徽菜",
    东北: "东北菜", 西北: "西北菜", 新疆: "新疆菜", 清真: "新疆菜", 云南菜: "云贵菜", 贵州菜: "云贵菜", 台湾: "台湾菜",
    日本菜: "日料", 日本料理: "日料", 日式: "日料", 日餐: "日料", 韩国菜: "韩餐", 韩国料理: "韩餐", 韩式: "韩餐", 韩料: "韩餐",
    泰餐: "泰国菜", 泰式: "泰国菜", 泰国: "泰国菜", 越南: "越南菜", 越餐: "越南菜", 印度: "印度菜", 印度料理: "印度菜",
    西式: "西餐", 洋快餐: "快餐", 炸鸡汉堡: "快餐", 沙拉: "轻食", 东南亚菜: "东南亚", 南洋菜: "东南亚",
    外国菜: "外国菜", 洋餐: "外国菜", 中餐: "中国菜", 中国菜: "中国菜",
  }),
);
export const GROUP = new Map<string, Set<string>>([
  ["东南亚", new Set(["泰国菜", "越南菜", "东南亚"])],
  ["粤菜", new Set(["粤菜", "港式"])],
  ["西北菜", new Set(["西北菜", "新疆菜"])],
  ["外国菜", new Set(FOREIGN)],
  ["中国菜", new Set(CUISINES.filter((c) => !FOREIGN.has(c)))],
]);
// 一个字、一个大类 → 菜单里用的那几个用料词
export const ROOT = new Map<string, string[]>(
  Object.entries({
    牛: ["牛肉"], 羊: ["羊肉"], 猪: ["猪肉"], 鸡: ["鸡肉"], 鸭: ["鸭肉"], 鹅: ["鹅肉"], 兔: ["兔肉"],
    鱼: ["鱼"], 虾: ["虾"], 蟹: ["蟹"], 葱: ["葱"], 姜: ["姜"], 蒜: ["蒜"], 辣: ["辣椒"], 麻: ["花椒"],
    蛋: ["鸡蛋"], 蛙: ["牛蛙"], 奶: ["牛奶", "奶酪", "奶油"],
    海鲜: ["鱼", "虾", "蟹", "贝类", "鱿鱼"], 水产: ["鱼", "虾", "蟹", "贝类", "鱿鱼"], 红肉: ["牛肉", "羊肉", "猪肉"],
    内脏: ["内脏"], 下水: ["内脏"], 麻酱: ["芝麻酱"], 芝麻: ["芝麻", "芝麻酱", "香油"], 麻油: ["香油"],
    乳制品: ["牛奶", "奶酪", "奶油"], 奶制品: ["牛奶", "奶酪", "奶油"], 芝士: ["奶酪"], 坚果: ["坚果", "花生"],
    葱花: ["葱"], 大葱: ["葱"], 小葱: ["葱"], 生姜: ["姜"], 大蒜: ["蒜"], 蒜蓉: ["蒜"], 辣椒: ["辣椒"],
    蘑菇: ["菌菇"], 菇: ["菌菇"], 香菇: ["菌菇"], 豆腐: ["豆腐", "豆制品"], 鸡蛋: ["鸡蛋"], 加工肉: ["加工肉"],
  }),
);
// 拿一个字去对菜名时，这些词里的那个字不算（牛蛙不是牛，洋葱不是葱，鱼香肉丝里没有鱼）
export const NOT_IN_NAME = new Map<string, string[]>(
  Object.entries({
    牛: ["牛蛙", "牛油果", "牛奶", "蜗牛", "牛轧", "牛肝菌"], 葱: ["洋葱"], 鱼: ["鱼香", "鱿鱼", "鱼露", "鱼豆腐", "鱼腥草"],
    鸡: ["鸡蛋", "鸡枞", "鸡腿菇", "鸡头米"], 麻: ["芝麻", "麻酱", "麻油", "麻薯"], 羊: ["羊城", "羊肚菌"], 奶: ["奶茶"],
    蟹: ["蟹味菇"], 鸭: ["鸭梨"],
  }),
);
export const VOCAB = new Set(
  `猪肉 牛肉 羊肉 鸡肉 鸭肉 鹅肉 兔肉 内脏 加工肉 牛蛙 鱼 虾 蟹 贝类 鱿鱼 海带 紫菜 鸡蛋 牛奶 奶酪 奶油 豆腐 豆制品
土豆 番茄 茄子 青椒 白菜 包菜 菌菇 木耳 莲藕 黄瓜 豆芽 酸菜 萝卜 洋葱 韭菜 芹菜 生菜 菠菜 西兰花 玉米 竹笋 豆角 苦瓜 山药 芋头 南瓜 红薯 蒜苔 莴笋 空心菜 秋葵 牛油果
米饭 面条 米粉 粉丝 年糕 糯米 面皮 葱 姜 蒜 香菜 辣椒 花椒 芝麻 芝麻酱 花生 香油 醋 咖喱 椰奶 鱼露 芥末 孜然 柠檬 罗勒 紫苏 酒 坚果 菠萝`
    .split(/\s+/)
    .filter(Boolean),
);

export interface MenuDish {
  name: string;
  cuisine: string;
  kind: string;
  tags: string[];
  mine?: boolean;
  own?: string;
  hist?: Hist;
}
export interface Hist {
  shop: Shop | null;
  verdict: string | null;
  date: string;
  trail: [string, string][]; // 每一次表过态：(MM-DD, 评价)
}

let MENU: MenuDish[] | null = null;

// Python 的 str.splitlines() 认的换行
const LINES = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;

/** 读 dishes.txt；写错的行跳过 */
export function menu(text?: string): MenuDish[] {
  if (MENU && text === undefined) return MENU;
  const out: MenuDish[] = [];
  const seen = new Set<string>();
  const body = text ?? DISHES_TXT;
  for (const line of body.split(LINES)) {
    const f = line.split("|").map(pyStrip);
    if (f.length !== 4 || !f[0] || !CUISINES.includes(f[1]) || !KINDS.includes(f[2]) || seen.has(f[0])) continue;
    seen.add(f[0]);
    out.push({ name: f[0], cuisine: f[1], kind: f[2], tags: f[3].split(",").filter((t) => VOCAB.has(pyStrip(t))) });
  }
  if (text === undefined) MENU = out;
  return out;
}

/** 口味单里这一样是不是在说一整个菜系；是就给出它包含的菜系 */
export function cuisineOf(item: string | null | undefined): Set<string> | null {
  let k = pyStrip(item || "");
  for (const tail of ["系", "料理"]) {
    if (k.endsWith(tail) && CUISINES.includes(k.slice(0, k.length - tail.length))) k = k.slice(0, k.length - tail.length);
  }
  k = lookup(ALIAS, k) ?? k;
  const g = lookup(GROUP, k);
  if (g) return new Set(g);
  if (CUISINES.includes(k)) return new Set([k]);
  return null;
}

export type Terms = [string, Set<string>, Set<string>];

/** 一样东西 → (对用料的词, 对菜名的词)。「丸子这类半成品」「鸡鸭鱼蛙这类白肉」：认「这类」前面那几个字 */
export function terms(item0: string | null | undefined): Terms {
  const item = pyStrip(item0 || "");
  for (const sep of ["这类", "之类", "这种", "一类", "那类"]) {
    const head = pyStrip(item.split(sep)[0]);
    if (item.includes(sep) && head) {
      const [, t2, n2] = terms(head);
      return [item, t2, new Set([...n2, item])];
    }
  }
  const tags = new Set(lookup(ROOT, item) || []);
  if (VOCAB.has(item)) tags.add(item);
  const chars = Array.from(item);
  const roots = cpLen(item) > 1 && chars.every((c) => ROOT.has(c)) ? chars : []; // 牛羊、葱姜蒜
  for (const c of roots) for (const t of ROOT.get(c)!) tags.add(t);
  const names = new Set([item, ...[...tags].filter((t) => cpLen(t) > 1), ...roots]);
  return [item, tags, names];
}

function hitName(name: string, words: Set<string>): boolean {
  for (const w of words) {
    let clean = name;
    for (const ex of lookup(NOT_IN_NAME, w) || []) clean = clean.split(ex).join("");
    if (w && clean.includes(w)) return true;
  }
  return false;
}

function intersects(a: Set<string>, b: string[]): boolean {
  for (const x of b) if (a.has(x)) return true;
  return false;
}

function hit(x: MenuDish, tags: Set<string>, names: Set<string>): boolean {
  return intersects(tags, x.tags) || hitName(x.name, names);
}

export interface Rules {
  ex_cuis: Set<string>;
  love_cuis: Set<string>;
  never: Terms[];
  hate: Terms[];
  love: Terms[];
  scoped: Terms[];
  want: Terms | null;
  want_cuis: Set<string>;
}

export function rules(taste: { item?: string | null; kind?: string; scope?: string | null }[] | null | undefined, want = ""): Rules {
  const R: Rules = { ex_cuis: new Set(), love_cuis: new Set(), never: [], hate: [], love: [], scoped: [], want: null, want_cuis: new Set() };
  for (const t of taste || []) {
    const item = pyStrip(t.item || "");
    const kind = t.kind;
    const scope = pyStrip(t.scope || "");
    if (!item || (kind !== "never" && kind !== "hate" && kind !== "love")) continue;
    const cs = scope ? null : cuisineOf(item);
    if (cs) {
      for (const c of cs) (kind === "never" || kind === "hate" ? R.ex_cuis : R.love_cuis).add(c);
    } else if (scope) {
      if (kind !== "love") R.scoped.push(terms(item));
    } else {
      R[kind].push(terms(item));
    }
  }
  if (pyStrip(want || "")) {
    const cs = cuisineOf(want);
    if (cs) R.want_cuis = cs;
    else R.want = terms(want);
  }
  return R;
}

/** 这道菜能不能丢：不能 → null；能 → [分量, 提醒] */
export function judge(x: MenuDish, R: Rules): [number, string[]] | null {
  if (R.ex_cuis.has(x.cuisine)) return null;
  for (const [, tags, names] of R.never) if (hit(x, tags, names)) return null;
  const garnish: string[] = [];
  for (const [item, tags, names] of R.hate) {
    if (hitName(x.name, names) || (x.tags.length && tags.has(x.tags[0]))) return null;
    if (intersects(tags, x.tags)) garnish.push(item);
  }
  for (const [item, tags, names] of R.scoped) if (hit(x, tags, names)) garnish.push(item);
  let w = 1.0;
  if (R.love.some(([, tags, names]) => hit(x, tags, names))) w *= 3;
  if (R.love_cuis.has(x.cuisine)) w *= 3;
  if (R.want && hit(x, R.want[1], R.want[2])) w *= 20; // 临时想吃的：大约八成丢到它，又不至于只剩它
  if (R.want_cuis.has(x.cuisine)) w *= 20;
  if (x.own === "good") w *= 2;
  const notes: string[] = [];
  if (garnish.length) notes.push("点的时候备注：不要" + [...new Set(garnish)].join("、"));
  return [w, notes];
}

function norm(s: string | null | undefined): string {
  return pyStrip(s || "").toLowerCase();
}

type DiceData = Pick<Data, "shops" | "branches" | "meals" | "dishes" | "logs"> & { taste?: Data["taste"] | any[] };

/** 菜单 ＋ 本子里自己记过的菜。带上 Ta 吃过的记录 */
export function pool(d: DiceData, kind = ""): MenuDish[] {
  const shops = new Map((d.shops || []).map((s) => [s.id, s]));
  const branch = new Map((d.branches || []).map((b) => [b.id, b]));
  const meals = new Map((d.meals || []).map((m) => [m.id, m]));
  const dishes = new Map((d.dishes || []).map((x) => [x.id, x]));
  const seen = new Map<string, Hist>(); // 菜名 → 最近一次 (日子, 店, 评价)
  const key = (l: { meal_id: number; id: number }): [string, number] => [meals.get(l.meal_id)?.eaten_on || "", l.id];
  const logs = [...(d.logs || [])].sort((a, b) => {
    const [ea, ia] = key(a);
    const [eb, ib] = key(b);
    return ea < eb ? -1 : ea > eb ? 1 : ia - ib;
  });
  for (const l of logs) {
    const nm = (l.dish_id !== null && l.dish_id !== undefined ? dishes.get(l.dish_id)?.name : undefined) || l.name;
    const m = meals.get(l.meal_id);
    const b = m && m.branch_id ? branch.get(m.branch_id) : undefined;
    const s = b ? shops.get(b.shop_id) ?? null : null;
    if (nm) {
      const prev = seen.get(norm(nm));
      seen.set(norm(nm), {
        shop: s,
        verdict: l.verdict || prev?.verdict || null,
        date: (m && m.eaten_on) || "",
        trail: [...(prev?.trail ?? []), ...(l.verdict ? [[((m && m.eaten_on) || "").slice(5), l.verdict] as [string, string]] : [])],
      });
    }
  }
  const out: MenuDish[] = menu().map((x) => ({ ...x }));
  const have = new Set(out.map((x) => norm(x.name)));
  for (const x of d.dishes || []) {
    // 自己记过、菜单上没有的
    const k = norm(x.name);
    const h = seen.get(k);
    const s = shops.get(x.shop_id);
    // !h：一次都没吃过的（删掉的菜留下的名字）不丢
    if (have.has(k) || !h || h.verdict === "bad" || (s && s.verdict === "bad")) continue;
    have.add(k);
    const raw = pyStrip((s && s.cuisine) || "");
    const c = lookup(ALIAS, raw) ?? raw;
    out.push({ name: x.name, cuisine: CUISINES.includes(c) ? c : "家常菜", kind: "菜", tags: [], mine: true });
  }
  for (const x of out) {
    const h = seen.get(norm(x.name));
    if (h) {
      x.own = h.verdict || "seen";
      x.hist = h;
    }
  }
  return out.filter((x) => !kind || x.kind === kind);
}

export function histLine(h: Hist): string {
  const s = h.shop;
  const where = s ? s.name : "";
  const tr = h.trail || [];
  if (tr.some(([, v]) => v === "good") && tr.some(([, v]) => v === "bad")) {
    // 时好时坏
    const lab: Record<string, string> = { good: "好吃", meh: "一般", bad: "踩雷" };
    return (where ? `${where}这道` : "这道") + "时好时坏：" + tr.slice(-4).map(([d, v]) => `${d} ${lab[v]}`).join("、") + "，点之前心里有个数";
  }
  if (h.verdict === "bad") return where ? `上回在${where}踩过雷，换一家点` : "上回吃这个踩过雷";
  if (s && s.verdict === "bad") return `${where}已经拉黑了，换一家点`;
  if (h.verdict === "good") return where ? `你在${where}吃过，好吃` : "你吃过，说好吃";
  return where ? `你在${where}吃过` : "你吃过";
}

export interface Candidate {
  x: MenuDish;
  w: number;
  notes: string[];
}

/** 剔完以后还剩哪些（骰子就在这里面丢）。only＝只在这一个菜系里丢 */
export function candidates(d: DiceData, kind = "", want = "", only = ""): { keep: Candidate[]; removed: number; R: Rules } {
  const R = rules(d.taste as any, want);
  const o = pyStrip(only || "");
  const keep: Candidate[] = [];
  let removed = 0;
  for (const x of pool(d, kind)) {
    if (o && x.cuisine !== o) continue;
    const r = judge(x, R);
    if (r === null) {
      removed += 1;
      continue;
    }
    keep.push({ x, w: r[0], notes: r[1] });
  }
  return { keep, removed, R };
}

export type Roll = Record<string, any>;

/** only＝只在这一个菜系里丢（页面上从「一个方向」点进来用）；want 只是往那边偏 */
export function roll(d: DiceData, mode = "dish", kind = "", want = "", rng: () => number = Math.random, only = ""): Roll {
  const o = pyStrip(only || "");
  const { keep, removed, R } = candidates(d, kind, want, o);
  const base = { ok: true, mode, count: keep.length, removed, kind: kind || "", want: want || "", only: o };
  if (!keep.length) return { ...base, empty: true };
  if (mode === "way") {
    const by = new Map<string, Candidate[]>();
    for (const it of keep) {
      const a = by.get(it.x.cuisine);
      if (a) a.push(it);
      else by.set(it.x.cuisine, [it]);
    }
    const cs = [...by.keys()];
    const cw = cs.map(
      (c) => (R.love_cuis.has(c) ? 3 : 1) * (R.want_cuis.has(c) ? 20 : 1) * (1 + 0.15 * Math.min(by.get(c)!.length, 10)),
    );
    const c = choice(cs, cw, rng);
    const items = [...by.get(c)!];
    const ex: string[] = [];
    while (items.length && ex.length < 3) {
      const it = choice(
        items,
        items.map((i) => i.w),
        rng,
      );
      items.splice(items.indexOf(it), 1);
      ex.push(it.x.name);
    }
    return { ...base, cuisine: c, examples: ex, inside: by.get(c)!.length, cuisines: cs.length };
  }
  const it = choice(
    keep,
    keep.map((i) => i.w),
    rng,
  );
  let notes = it.notes;
  if (it.x.hist) notes = [...notes, histLine(it.x.hist)];
  return { ...base, name: it.x.name, cuisine: it.x.cuisine, dish_kind: it.x.kind, notes, mine: !!it.x.mine };
}

/** 给 AI 看的一句话 */
export function text(r: Roll): string {
  if (r.empty) return "（按 Ta 的口味单剔完，" + (r.kind ? `「${r.kind}」这一类` : "菜单") + "里一道都不剩了。问问 Ta 想吃什么。）";
  const tail =
    `（${r.only ? "只在" + r.only + "里丢，" : ""}从 ${r.count} 道里丢的，按口味单剔掉了 ${r.removed} 道` +
    (r.want ? `，往「${r.want}」上偏了` : "") +
    "）";
  if (r.mode === "way") return `丢到：${r.cuisine}。比如 ${r.examples.join("、")}。` + tail;
  return `丢到：${r.name}（${r.cuisine} · ${r.dish_kind}）。` + r.notes.map((n: string) => n + "。").join("") + tail;
}
