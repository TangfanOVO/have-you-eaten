// 吃了吗 · have-you-eaten —— 存储和规矩（core.py 照着搬到 D1 上）。
//
// 一本「吃过的」：
//   店（牌子）→ 分店（城市 · 区 · 哪家店）→ 一顿（哪天 · 哪一顿 · 外卖/堂食 · 花多少）→ 这顿吃的每道菜
//   一顿也可以不挂店（自己做的、随手吃的），那就是一页吃饭日记。
//   口味单：不记日期的 爱吃 / 不爱吃 / 不能吃。
//
// 规矩跟 core.py 一样（npm run conformance 拿 Python 那份对着跑）：
//   · 同名的店、同一家店里同名的菜，认成同一个（不分大小写、去两头空白），记录叠在它身上，不新开。
//   · 从店里来的那顿，城市必填 —— 不同城市的雷分开放，别挡错路。
//   · 好吃 / 一般 / 踩雷 都可以不填。一道菜「现在算不算雷」＝它最后一次表过态的那条。
//   · 不算热量。只看清最近到底吃了什么。
//
// 跟 Python 不一样的只有一处：D1 没有「开一个事务、边读边写」。所以每次写都是
//   先读（看店在不在、编号排到几了）→ 算好要写的每一行（编号自己定，跟 SQLite 自己会给的一样：最大的 +1）→ 一个 batch 一次写进去。
// batch 本身是一个事务：中间哪一条不行，整笔退回，跟 Python 的 rollback 一样。
// 两只手同时写撞了编号（网页和 AI 一起来），整笔退回、重新读一遍再写（最多五回）。
import { addDays, Clock, localHour, parseIsoDate, parseNaiveUtc, today, weekday } from "./clock";
import { SCHEMA_STATEMENTS } from "./generated/schema";
import {
  Bad,
  PyError,
  _s,
  asList,
  asObj,
  cmpTuple,
  lookup,
  pyFixed,
  pyFloat,
  pyInt,
  pyRound,
  pyStr,
  pyStrip,
  pyTruthy,
  sqlKey,
} from "./py";

export { Bad } from "./py";

export const V: Record<string, string> = { good: "好吃", meh: "一般", bad: "踩雷" };
export const VIN = new Map(
  Object.entries({ 好吃: "good", 一般: "meh", 踩雷: "bad", 难吃: "bad", good: "good", meh: "meh", bad: "bad" }),
);
export const HOW = ["外卖", "堂食", "自取"];
export const SLOTS = ["早饭", "午饭", "加餐", "晚饭", "夜宵", "纯记录"]; // 纯记录：想起来随手记的，不算哪一顿
export const TK: Record<string, string> = { love: "爱吃", hate: "不爱吃", never: "不能吃" };
export const TKIN = new Map(
  Object.entries({ 爱吃: "love", 不爱吃: "hate", 不能吃: "never", love: "love", hate: "hate", never: "never" }),
);
export const AU = ["悉尼", "墨尔本", "阿德莱德", "布里斯班", "珀斯", "堪培拉", "霍巴特", "达尔文", "黄金海岸", "凯恩斯"];

export const EDITABLE = new Map<string, Set<string>>([
  ["shop", new Set(["name", "cuisine", "note", "verdict"])],
  ["branch", new Set(["city", "area", "label", "address", "platform", "note"])],
  ["meal", new Set(["eaten_on", "slot", "place", "city", "photo", "how", "total", "currency", "verdict", "note"])],
  ["dish", new Set(["name", "note"])],
  ["log", new Set(["name", "verdict", "price", "note"])],
  ["taste", new Set(["item", "kind", "note", "away", "scope"])],
]);
export const TABLE = new Map(
  Object.entries({ shop: "shop", branch: "branch", meal: "meal", dish: "dish", log: "dish_log", taste: "taste" }),
);

// ───────── 行的样子（all() 给出来的，跟 Python 的 all() 同样几列）
export interface Shop {
  id: number;
  name: string;
  cuisine: string | null;
  note: string | null;
  verdict: string | null;
  created_at: string;
}
export interface Branch {
  id: number;
  shop_id: number;
  city: string;
  area: string;
  label: string;
  address: string | null;
  platform: string | null;
  note: string | null;
}
export interface Meal {
  id: number;
  branch_id: number | null;
  eaten_on: string;
  slot: string | null;
  place: string | null;
  city: string | null;
  photo: string | null;
  src: string;
  how: string | null;
  total: number | null;
  currency: string;
  verdict: string | null;
  note: string | null;
  created_at: string;
}
export interface Dish {
  id: number;
  shop_id: number;
  name: string;
  note: string | null;
}
export interface Log {
  id: number;
  meal_id: number;
  dish_id: number | null;
  name: string | null;
  verdict: string | null;
  price: number | null;
  note: string | null;
}
export interface Taste {
  id: number;
  kind: string;
  item: string;
  scope: string;
  note: string | null;
  away: boolean;
  src: string;
  updated_at: string;
}
export interface Here {
  city: string | null;
  spot: string | null;
  home: string;
  today: string;
}
export interface Data {
  shops: Shop[];
  branches: Branch[];
  meals: Meal[];
  dishes: Dish[];
  logs: Log[];
  taste: Taste[];
  here: Here;
}

// ───────── 表：Worker 第一次碰这个库的时候建（跟 Python 的 Book() 一样，库是空的也能直接用）
const ready = new WeakMap<D1Database, Promise<void>>();

export function ensureSchema(db: D1Database, force = false): Promise<void> {
  let p = force ? undefined : ready.get(db);
  if (!p) {
    p = db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s))).then(() => undefined);
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

const RETRYABLE = /UNIQUE constraint failed|FOREIGN KEY constraint failed/i;
const ATTEMPTS = 5;
const CONSTRAINT = /constraint failed|SQLITE_CONSTRAINT/i;
const NO_TABLE = /no such table/i;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Stmt = D1PreparedStatement;
type Bindable = string | number | null;

export class Book {
  constructor(
    readonly db: D1Database,
    readonly clock: Clock,
  ) {}

  private q(sql: string, ...args: Bindable[]): Stmt {
    return this.db.prepare(sql).bind(...args);
  }

  private async first<T = Record<string, any>>(sql: string, ...args: Bindable[]): Promise<T | null> {
    return (await this.q(sql, ...args).first<T>()) ?? null;
  }

  private async rows<T = Record<string, any>>(sql: string, ...args: Bindable[]): Promise<T[]> {
    return (await this.q(sql, ...args).all<T>()).results;
  }

  /** 表被人删了（比如在 Cloudflare 后台）：重建一次再来；撞了编号：重新读一遍再写 */
  private async run<T>(fn: () => Promise<T>, retry = true): Promise<T> {
    await ensureSchema(this.db);
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof Bad || e instanceof PyError || attempt >= ATTEMPTS) throw e;
        if (NO_TABLE.test(msg(e))) await ensureSchema(this.db, true);
        else if (!retry || !RETRYABLE.test(msg(e))) throw e;
        else await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * attempt)); // 错开一点再来，别又撞上
      }
    }
  }

  // ── 几点 / 今天
  today(): string {
    return today(this.clock);
  }

  // ── 设置：你在哪座城
  async setting(k: string, def = ""): Promise<string | null> {
    return this.run(async () => {
      const r = await this.first<{ v: string | null }>("SELECT v FROM setting WHERE k=?", k);
      return r ? r.v : def;
    });
  }

  async setSetting(k: string, v: string): Promise<void> {
    await this.setSettings([[k, v]]);
  }

  async setSettings(kv: [string, string][]): Promise<void> {
    await this.run(() =>
      this.db.batch(
        kv.map(([k, v]) => this.q("INSERT INTO setting(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v)),
      ),
    );
  }

  async here(): Promise<Here> {
    const [city, spot] = await Promise.all([this.setting("city"), this.setting("spot")]);
    return { city, spot, home: "", today: this.today() };
  }

  // ── 读整本
  async all(): Promise<Data> {
    return this.run(async () => {
      const r = await this.db.batch([
        this.q("SELECT id,name,cuisine,note,verdict,created_at FROM shop ORDER BY id"),
        this.q("SELECT id,shop_id,city,area,label,address,platform,note FROM branch ORDER BY id"),
        this.q(
          "SELECT id,branch_id,eaten_on,slot,place,city,photo,src,how,total,currency,verdict,note,created_at " +
            "FROM meal ORDER BY eaten_on DESC, id DESC",
        ),
        this.q("SELECT id,shop_id,name,note FROM dish ORDER BY id"),
        this.q("SELECT id,meal_id,dish_id,name,verdict,price,note FROM dish_log ORDER BY id"),
        this.q("SELECT id,kind,item,scope,note,away,src,updated_at FROM taste ORDER BY updated_at DESC, id DESC"),
        this.q("SELECT k, v FROM setting WHERE k IN ('city','spot')"),
      ]);
      const set = new Map((r[6].results as { k: string; v: string | null }[]).map((x) => [x.k, x.v]));
      return {
        shops: r[0].results as unknown as Shop[],
        branches: r[1].results as unknown as Branch[],
        meals: r[2].results as unknown as Meal[],
        dishes: r[3].results as unknown as Dish[],
        logs: r[4].results as unknown as Log[],
        taste: (r[5].results as any[]).map((t) => ({ ...t, away: !!t.away })) as Taste[],
        here: {
          city: set.has("city") ? set.get("city")! : "",
          spot: set.has("spot") ? set.get("spot")! : "",
          home: "",
          today: this.today(),
        },
      };
    });
  }

  // ── 下一个编号（SQLite 自己给也是最大的 +1）
  private async maxIds(): Promise<Record<"shop" | "branch" | "meal" | "dish" | "dish_log", number>> {
    const r = await this.first<Record<string, number>>(
      "SELECT (SELECT COALESCE(MAX(id),0) FROM shop) AS shop, (SELECT COALESCE(MAX(id),0) FROM branch) AS branch, " +
        "(SELECT COALESCE(MAX(id),0) FROM meal) AS meal, (SELECT COALESCE(MAX(id),0) FROM dish) AS dish, " +
        "(SELECT COALESCE(MAX(id),0) FROM dish_log) AS dish_log",
    );
    return r as any;
  }

  // ── 记一顿
  async log(b: any): Promise<{ ok: true; shop_id: number | null; branch_id: number | null; meal_id: number }> {
    b = asObj(b);
    const sh = asObj(b.shop);
    const br = asObj(b.branch);
    const ml = asObj(b.meal);
    const name = _s(sh.name, 120);
    const city = _s(br.city, 60);
    const fromShop = pyTruthy(sh.id) || !!name;
    const hereCity = await this.setting("city");
    if (fromShop && !pyTruthy(br.id) && !city) throw new Bad("城市要写 —— 不同城市的雷分开放，别挡错路");
    const meal0 = {
      eaten_on: this._date(ml.eaten_on),
      slot: this._slot(ml.slot),
      place: _s(ml.place, 120),
      city: _s(ml.city, 60) || city || hereCity || null,
      photo: _s(ml.photo, 300),
      src: ml.src === "chat" ? "chat" : "page",
      how: _how(ml.how),
      total: _money(ml.total),
      currency: _s(ml.currency, 8) || curFor(city || hereCity),
      verdict: _verdict(ml.verdict),
      note: _s(ml.note, 2000),
    };
    const dishes: { id: unknown; name: string | null; verdict: string | null; price: number | null; note: string | null }[] = [];
    for (const d0 of asList(b.dishes).slice(0, 40)) {
      const d = asObj(d0);
      const dn = _s(d.name, 120);
      if (!dn && !pyTruthy(d.id)) continue;
      dishes.push({ id: d.id ?? null, name: dn, verdict: _verdict(d.verdict), price: _money(d.price), note: _s(d.note, 1000) });
    }
    if (!fromShop && !dishes.length && !meal0.note && !meal0.photo) throw new Bad("吃了什么写一样呀");

    return this.run(async () => {
      const meal = { ...meal0 };
      const ids = await this.maxIds();
      const st: Stmt[] = [];
      let shopId: number | null = null;
      let branchId: number | null = null;
      const known = { byId: new Set<number>(), byKey: new Map<string, number>() };
      const newDishes: [number, number, string][] = [];
      if (fromShop) {
        let r: { id: number; cuisine: string | null } | null;
        let fresh = false;
        if (pyTruthy(sh.id)) {
          r = await this.first("SELECT id, cuisine FROM shop WHERE id=?", pyInt(sh.id));
          if (!r) throw new Bad("这家店不在了");
        } else {
          r = await this.first("SELECT id, cuisine FROM shop WHERE lower(trim(name))=lower(trim(?))", name);
          if (!r) {
            r = { id: ++ids.shop, cuisine: _s(sh.cuisine, 40) };
            fresh = true;
            st.push(this.q("INSERT INTO shop(id,name,cuisine) VALUES(?,?,?)", r.id, name, r.cuisine));
          }
        }
        shopId = r.id;
        const cu = _s(sh.cuisine, 40);
        if (cu && !r.cuisine) {
          st.push(
            this.q(
              "UPDATE shop SET cuisine=?, updated_at=datetime('now') WHERE id=? AND (cuisine IS NULL OR cuisine='')",
              cu,
              shopId,
            ),
          );
        }
        let rb: { id: number; city: string } | null;
        if (pyTruthy(br.id)) {
          const bid = pyInt(br.id);
          rb = fresh ? null : await this.first("SELECT id, city FROM branch WHERE id=? AND shop_id=?", bid, shopId);
          if (!rb) throw new Bad("这家分店对不上");
        } else {
          const area = _s(br.area, 60) || "";
          const label = _s(br.label, 60) || "";
          rb = fresh
            ? null
            : await this.first(
                "SELECT id, city FROM branch WHERE shop_id=? AND lower(trim(city))=lower(trim(?)) " +
                  "AND lower(trim(area))=lower(trim(?)) AND lower(trim(label))=lower(trim(?))",
                shopId,
                city,
                area,
                label,
              );
          if (!rb) {
            rb = { id: ++ids.branch, city: city! };
            st.push(
              this.q(
                "INSERT INTO branch(id,shop_id,city,area,label,address,platform) VALUES(?,?,?,?,?,?,?)",
                rb.id,
                shopId,
                city,
                area,
                label,
                _s(br.address, 300),
                _s(br.platform, 40),
              ),
            );
          }
        }
        branchId = rb.id;
        meal.city = rb.city;
        if (!pyTruthy(ml.currency)) meal.currency = curFor(rb.city);
        for (const [col, n] of [
          ["address", 300],
          ["platform", 40],
        ] as const) {
          const v = _s(br[col], n);
          if (v) st.push(this.q(`UPDATE branch SET ${col}=? WHERE id=? AND (${col} IS NULL OR ${col}='')`, v, branchId));
        }
        if (!fresh) {
          for (const x of await this.rows<{ id: number; name: string }>("SELECT id, name FROM dish WHERE shop_id=?", shopId)) {
            known.byId.add(x.id);
            if (!known.byKey.has(sqlKey(x.name))) known.byKey.set(sqlKey(x.name), x.id);
          }
        }
      }
      const mealId = ++ids.meal;
      st.push(
        this.q(
          "INSERT INTO meal(id,branch_id,eaten_on,slot,place,city,photo,src,how,total,currency,verdict,note) " +
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          mealId,
          branchId,
          meal.eaten_on,
          meal.slot,
          meal.place,
          meal.city,
          meal.photo,
          meal.src,
          meal.how,
          meal.total,
          meal.currency,
          meal.verdict,
          meal.note,
        ),
      );
      const logs: Bindable[][] = [];
      for (const d of dishes) {
        if (!fromShop) {
          logs.push([++ids.dish_log, mealId, null, d.name, d.verdict, d.price, d.note]);
          continue;
        }
        let did: number | undefined;
        if (pyTruthy(d.id)) {
          did = pyInt(d.id);
          if (!known.byId.has(did)) throw new Bad("这道菜对不上这家店");
        } else {
          const k = sqlKey(d.name!);
          did = known.byKey.get(k);
          if (did === undefined) {
            did = ++ids.dish;
            known.byKey.set(k, did);
            known.byId.add(did);
            newDishes.push([did, shopId!, d.name!]);
          }
        }
        logs.push([++ids.dish_log, mealId, did, null, d.verdict, d.price, d.note]);
      }
      st.push(...this.multiInsert("INSERT INTO dish(id,shop_id,name) VALUES", newDishes));
      st.push(...this.multiInsert("INSERT INTO dish_log(id,meal_id,dish_id,name,verdict,price,note) VALUES", logs));
      if (fromShop) st.push(this.q("UPDATE shop SET updated_at=datetime('now') WHERE id=?", shopId));
      // 你现在在哪座城，跟着最近记的那一顿走（手动设的只是兜底）
      if (meal.city) {
        // 换了城，原来写的「具体在哪」就不作数了
        st.push(
          this.q(
            "UPDATE setting SET v='' WHERE k='spot' AND lower(trim(?)) <> lower(trim(COALESCE((SELECT v FROM setting WHERE k='city'),'')))",
            meal.city,
          ),
        );
        st.push(this.q("INSERT INTO setting(k,v) VALUES('city',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", meal.city));
      }
      await this.db.batch(st);
      return { ok: true as const, shop_id: shopId, branch_id: branchId, meal_id: mealId };
    });
  }

  /** 一条 INSERT 带好几行（D1 一条最多 100 个参数） */
  private multiInsert(head: string, rows: Bindable[][]): Stmt[] {
    if (!rows.length) return [];
    const per = Math.max(1, Math.floor(100 / rows[0].length));
    const out: Stmt[] = [];
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      const ph = chunk.map((r) => "(" + r.map(() => "?").join(",") + ")").join(",");
      out.push(this.q(head + ph, ...chunk.flat()));
    }
    return out;
  }

  // ── 口味单
  /** 口味单记一样。scope：配哪类菜（「炒菜」里不要姜葱蒜、「面」加麻油），空＝什么都算；away：爱吃但现在吃不到（不传＝不动）。
   *  同一样东西又配同一类菜的已经在了＝挪档、有备注就换备注。 */
  async taste(
    item0: unknown,
    kind0: unknown,
    note0: unknown = null,
    src: unknown = "page",
    scope0: unknown = "",
    away: unknown = null,
  ): Promise<{ ok: true; id: number; moved: boolean }> {
    const item = _s(item0, 60);
    const scope = _s(scope0, 40) || "";
    if (!item) throw new Bad("写一样吃的呀");
    const kind = lookup(TKIN, pyTruthy(kind0) ? kind0 : "");
    if (!kind) throw new Bad("爱吃 / 不爱吃 / 不能吃 只认这三样");
    const note = _s(note0, 300);
    const aw = away === null || away === undefined ? null : pyTruthy(away) ? 1 : 0;
    return this.run(async () => {
      const r = await this.first<{ id: number }>(
        "SELECT id FROM taste WHERE lower(trim(item))=lower(trim(?)) AND lower(trim(scope))=lower(trim(?))",
        item,
        scope,
      );
      if (r) {
        await this.q(
          "UPDATE taste SET kind=?, note=COALESCE(?, note), away=COALESCE(?, away), updated_at=datetime('now') WHERE id=?",
          kind,
          note,
          aw,
          r.id,
        ).run();
        return { ok: true as const, id: r.id, moved: true };
      }
      const res = await this.q(
        "INSERT INTO taste(kind,item,scope,note,src,away) VALUES(?,?,?,?,?,?)",
        kind,
        item,
        scope,
        note,
        src === "chat" ? "chat" : "page",
        aw || 0,
      ).run();
      return { ok: true as const, id: Number(res.meta.last_row_id), moved: false };
    });
  }

  // ── 改一条 / 删一条
  async edit(kind: unknown, rid: unknown, fields: unknown): Promise<{ ok: boolean }> {
    const allow = lookup(EDITABLE, kind);
    if (!allow) throw new Bad("没有这一种");
    const sets: string[] = [];
    const vals: Bindable[] = [];
    for (const [k, v0] of Object.entries(asObj(fields))) {
      if (!allow.has(k)) continue;
      let v: Bindable;
      if (k === "verdict") v = _verdict(v0);
      else if (k === "how") v = _how(v0);
      else if (k === "total" || k === "price") v = _money(v0);
      else if (k === "eaten_on") v = this._date(v0);
      else if (k === "slot") v = this._slot(v0);
      else if (k === "away") v = pyTruthy(v0) ? 1 : 0;
      else if (k === "scope") v = _s(v0, 40) || "";
      else if (k === "kind") {
        v = lookup(TKIN, pyTruthy(v0) ? v0 : "") ?? null;
        if (!v) throw new Bad("爱吃 / 不爱吃 / 不能吃 只认这三样");
      } else if (k === "area" || k === "label") v = _s(v0, 60) || "";
      else if (k === "name" || k === "city" || k === "item") {
        v = _s(v0, 120);
        if (!v) throw new Bad("这一栏不能空");
      } else v = _s(v0, 2000);
      sets.push(`${k}=?`);
      vals.push(v);
    }
    if (!sets.length) throw new Bad("没有要改的");
    if (kind === "shop" || kind === "taste") sets.push("updated_at=datetime('now')");
    const id = pyInt(rid);
    try {
      const r = await this.run(() =>
        this.q(`UPDATE ${TABLE.get(kind as string)} SET ${sets.join(", ")} WHERE id=?`, ...vals, id).run(), false,
      );
      return { ok: r.meta.changes > 0 };
    } catch (e) {
      if (!(e instanceof Bad) && CONSTRAINT.test(msg(e))) throw new Bad("已经有一条同名的了");
      throw e;
    }
  }

  /** 记好的一顿再加一道菜 */
  async addlog(mealId0: unknown, d0: unknown): Promise<{ ok: true; log_id: number }> {
    const d = asObj(d0);
    const dn = _s(d.name, 120);
    if (!dn) throw new Bad("菜名要写");
    const verdict = _verdict(d.verdict);
    const note = _s(d.note, 1000);
    const price = _money(d.price);
    return this.run(async () => {
      const m = await this.first<{ id: number; shop_id: number | null }>(
        "SELECT m.id, b.shop_id FROM meal m LEFT JOIN branch b ON b.id = m.branch_id WHERE m.id=?",
        pyInt(mealId0),
      );
      if (!m) throw new Bad("这一顿不在了");
      const ids = await this.maxIds();
      const st: Stmt[] = [];
      const logId = ++ids.dish_log;
      if (m.shop_id === null) {
        st.push(this.q("INSERT INTO dish_log(id,meal_id,name,verdict,price,note) VALUES(?,?,?,?,?,?)", logId, m.id, dn, verdict, price, note));
      } else {
        const rd = await this.first<{ id: number }>(
          "SELECT id FROM dish WHERE shop_id=? AND lower(trim(name))=lower(trim(?))",
          m.shop_id,
          dn,
        );
        let did = rd?.id;
        if (did === undefined) {
          did = ++ids.dish;
          st.push(this.q("INSERT INTO dish(id,shop_id,name) VALUES(?,?,?)", did, m.shop_id, dn));
        }
        st.push(
          this.q("INSERT INTO dish_log(id,meal_id,dish_id,verdict,price,note) VALUES(?,?,?,?,?,?)", logId, m.id, did, verdict, price, note),
        );
      }
      await this.db.batch(st);
      return { ok: true as const, log_id: logId };
    });
  }

  async delete(kind: unknown, rid: unknown): Promise<{ ok: boolean }> {
    const table = lookup(TABLE, kind);
    if (!table) throw new Bad("没有这一种");
    return this.run(async () => {
      // 删一道菜、删一顿：这道菜再没有一次记录，就跟着删掉（留下来骰子还会丢到、换名字会撞名）
      let ds: number[] = [];
      if (kind === "log") {
        ds = (await this.rows<{ dish_id: number }>("SELECT dish_id FROM dish_log WHERE id=? AND dish_id IS NOT NULL", pyInt(rid))).map(
          (r) => r.dish_id,
        );
      } else if (kind === "meal") {
        ds = (
          await this.rows<{ dish_id: number }>("SELECT DISTINCT dish_id FROM dish_log WHERE meal_id=? AND dish_id IS NOT NULL", pyInt(rid))
        ).map((r) => r.dish_id);
      }
      const res = await this.db.batch([
        this.q(`DELETE FROM ${table} WHERE id=?`, pyInt(rid)),
        ...ds.map((did) => this.q("DELETE FROM dish WHERE id=? AND NOT EXISTS (SELECT 1 FROM dish_log WHERE dish_id=?)", did, did)),
      ]);
      return { ok: res[0].meta.changes > 0 };
    });
  }

  /** 改评价（core.Book.rate）：先记了一笔，吃完再说好不好吃。找最近那一顿里叫这个名字的菜，改它的评价和那一句话；
   *  dish 不写＝改那一顿整体。shop、date 用来收窄。返回 {ok, meal, name, wave}。 */
  async rate(
    dish: unknown = "",
    verdict: unknown = null,
    note0: unknown = null,
    shop: unknown = "",
    date: unknown = "",
  ): Promise<{ ok: true; meal: Meal; name: string | null; wave: string }> {
    const v = _verdict(verdict);
    const note = _s(note0, 1000);
    if (!v && !note) throw new Bad("好吃 / 一般 / 踩雷，或者一句话，至少说一样");
    const d = await this.all();
    const X = _index(d);
    const shopOf = (m: Meal) => {
      const b = m.branch_id ? X.branch.get(m.branch_id) : undefined;
      return b ? X.shop.get(b.shop_id) : undefined;
    };
    let meals = [...d.meals].sort((a, b) => cmpTuple(_mkey(b), _mkey(a)));
    const sl = pyStrip(strArg(shop)).toLowerCase();
    if (sl) meals = meals.filter((m) => shopOf(m) && shopOf(m)!.name.toLowerCase().includes(sl));
    if (pyStrip(strArg(date))) {
      const day = this._date(date);
      meals = meals.filter((m) => m.eaten_on === day);
    }
    if (!meals.length) throw new Bad("没找到那一顿 —— 先记一笔，或者说清是哪天、哪家");
    const f: Record<string, string> = {};
    if (v) f.verdict = v;
    if (note) f.note = note;
    const nm = pyStrip(strArg(dish)).toLowerCase();
    if (!nm) {
      await this.edit("meal", meals[0].id, f);
      return { ok: true, meal: meals[0], name: null, wave: "" };
    }
    const lname = (l: Log) => pyStrip((l.dish_id ? X.dish.get(l.dish_id)?.name : undefined) || l.name || "");
    for (const exact of [true, false]) {
      // 先找一字不差的，找不到再找名字互相包含的（「酸豆角」→「酸豆角炒肉末」）
      for (const m of meals.slice(0, 30)) {
        for (const l of X.by_meal.get(m.id) || []) {
          const n = lname(l).toLowerCase();
          if (exact ? n === nm : !!n && (n.includes(nm) || nm.includes(n))) {
            await this.edit("log", l.id, f);
            let wave = "";
            if (l.dish_id) {
              const X2 = _index(await this.all());
              wave = _wave(_stat(X2.by_dish.get(l.dish_id) || [], X2));
            }
            return { ok: true, meal: m, name: lname(l), wave };
          }
        }
      }
    }
    throw new Bad(`最近这几顿里没有「${pyStr(dish)}」 —— 是哪天、哪家的？`);
  }

  // ── 给 AI 看的：翻本子
  async bookText(view: string = "", city0: string = "", q: string = "", days: unknown = 7): Promise<string> {
    const d = await this.all();
    return bookText(d, view, city0, q, days, this.clock);
  }

  /** 每轮接在系统提示末尾的那一小段（自己搭前端 / 网关的人用）。 */
  async contextText(): Promise<string> {
    return contextText(await this.all(), this.clock);
  }

  // ── 跟时钟有关的两个
  _date(v: unknown): string {
    const s = _s(v, 10);
    if (s === null) return this.today();
    const ok = parseIsoDate(s);
    if (!ok) throw new Bad("日期看不懂");
    return ok;
  }

  _slot(v: unknown): string | null {
    const s = _s(v, 8);
    if (s === null) return null;
    if (s === "auto") {
      const h = (localHour(this.clock) + 23) % 24; // 多半是吃完才记：按一个钟头以前猜
      return 5 <= h && h < 10 ? "早饭" : 10 <= h && h < 16 ? "午饭" : 16 <= h && h < 22 ? "晚饭" : "夜宵";
    }
    if (!SLOTS.includes(s)) throw new Bad("早饭 / 午饭 / 晚饭 / 夜宵 / 纯记录 只认这几样");
    return s;
  }
}

// ───────── 小工具（跟 core.py 底下那一串一一对应）

/** (x or "")：空的给 ""；是字符串就用；别的照 Python 报错（.strip() 不在） */
function strArg(v: unknown): string {
  if (!pyTruthy(v)) return "";
  if (typeof v === "string") return v;
  throw new PyError("'" + typeof v + "' object has no attribute 'strip'");
}

export function curFor(city: string | null | undefined): string {
  return city && AU.some((k) => city.includes(k)) ? "AUD" : "CNY";
}

export function _money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  let f: number;
  try {
    f = pyFloat(pyStrip(pyStr(v).replaceAll(",", "").replaceAll("$", "").replaceAll("¥", "")));
  } catch {
    throw new Bad("价钱看不懂");
  }
  if (Number.isNaN(f)) return null; // Python 那边 nan 过得了这一关，可存进 SQLite 就成了 NULL
  if (f < 0 || f > 99999) throw new Bad("价钱不对");
  return pyRound(f, 2);
}

export function _verdict(v: unknown): string | null {
  const s = _s(v, 8);
  if (s === null) return null;
  const r = VIN.get(s);
  if (!r) throw new Bad("好吃 / 一般 / 踩雷 只认这三样");
  return r;
}

export function _how(v: unknown): string | null {
  const s = _s(v, 8);
  if (s === null) return null;
  if (!HOW.includes(s) && s !== "自己做") throw new Bad("外卖 / 堂食 / 自取 只认这三样");
  return s;
}

export function _moneyS(v: number | null, cur: string | null): string {
  if (v === null || v === undefined) return "";
  const t = pyFixed(Number(v), 2).replace(/0+$/, "").replace(/\.$/, "");
  const sym: Record<string, string> = { CNY: "¥", AUD: "A$", USD: "$", GBP: "£", EUR: "€", JPY: "JP¥" };
  return (Object.prototype.hasOwnProperty.call(sym, cur || "") ? sym[cur || ""] : (cur || "") + " ") + t;
}

function _wd(iso: string): string {
  return "周" + "一二三四五六日"[weekday(iso)];
}

function _at(here: Here): string {
  const c = here.city || "（还没设城市）";
  return c + (here.spot && here.city ? " " + here.spot : "");
}

export interface Index {
  shop: Map<number, Shop>;
  branch: Map<number, Branch>;
  meal: Map<number, Meal>;
  dish: Map<number, Dish>;
  by_meal: Map<number, Log[]>;
  by_dish: Map<number, Log[]>;
  branches_of: Map<number, Branch[]>;
  dishes_of: Map<number, Dish[]>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

export function _index(d: Data): Index {
  const X: Index = {
    shop: new Map(d.shops.map((s) => [s.id, s])),
    branch: new Map(d.branches.map((b) => [b.id, b])),
    meal: new Map(d.meals.map((m) => [m.id, m])),
    dish: new Map(d.dishes.map((x) => [x.id, x])),
    by_meal: new Map(),
    by_dish: new Map(),
    branches_of: new Map(),
    dishes_of: new Map(),
  };
  for (const b of d.branches) push(X.branches_of, b.shop_id, b);
  for (const x of d.dishes) push(X.dishes_of, x.shop_id, x);
  for (const l of d.logs) {
    push(X.by_meal, l.meal_id, l);
    if (l.dish_id) push(X.by_dish, l.dish_id, l);
  }
  return X;
}

function mustGet<K, V>(m: Map<K, V>, k: K): V {
  const v = m.get(k);
  if (v === undefined) throw new PyError("KeyError: " + String(k));
  return v;
}

export function _mkey(m: Meal): (string | number)[] {
  const i = m.slot === null ? -1 : SLOTS.indexOf(m.slot);
  return [m.eaten_on, i >= 0 ? i : 9, m.id];
}

interface Stat {
  n: number;
  good: number;
  meh: number;
  bad: number;
  last: string | null;
  note: string;
  date: string;
  cities: Set<string>;
  trail: [string, string][]; // 每一次表过态：(哪天, 评价)
  mixed: boolean; // 好吃过也踩过雷＝时好时坏
}

function _stat(logs: Log[], X: Index): Stat {
  const r: Stat = { n: 0, good: 0, meh: 0, bad: 0, last: null, note: "", date: "", cities: new Set(), trail: [], mixed: false };
  const ls = [...logs].sort((a, b) =>
    cmpTuple([..._mkey(mustGet(X.meal, a.meal_id)), a.id], [..._mkey(mustGet(X.meal, b.meal_id)), b.id]),
  );
  for (const l of ls) {
    const m = mustGet(X.meal, l.meal_id);
    r.n += 1;
    if (l.verdict) {
      (r as any)[l.verdict] += 1;
      r.last = l.verdict;
      r.trail.push([m.eaten_on, l.verdict]);
    }
    if (l.note) r.note = l.note;
    r.date = m.eaten_on;
    if (m.city) r.cities.add(m.city);
  }
  r.mixed = !!(r.good && r.bad);
  return r;
}

/** 同一道菜好吃过也踩过雷：时好时坏，把哪天好吃、哪天踩雷列出来（core._wave） */
export function _wave(st: Partial<Stat>): string {
  if (!st.mixed) return "";
  return "时好时坏：" + st.trail!.slice(-4).map(([d, v]) => `${d.slice(5)} ${V[v]}`).join("、") + `（最近一次${V[st.last!]}）`;
}

interface Item {
  name: string;
  shop: Shop | null;
  where: string;
  st: Stat;
}

function _items(d: Data, X: Index): Item[] {
  const out: Item[] = [];
  for (const x of d.dishes) {
    if (!X.by_dish.get(x.id)?.length) continue; // 一次都没吃过的不算
    const s = X.shop.get(x.shop_id) ?? null;
    out.push({ name: x.name, shop: s, where: s ? s.name : "", st: _stat(X.by_dish.get(x.id) || [], X) });
  }
  const named = new Map<string, Log[]>();
  for (const l of d.logs) if (!l.dish_id && l.name) push(named, pyStrip(l.name).toLowerCase(), l);
  for (const ls of named.values()) {
    const last = ls[ls.length - 1];
    const m = X.meal.get(last.meal_id);
    out.push({ name: last.name!, shop: null, where: (m && m.place) || "没挂店的", st: _stat(ls, X) });
  }
  return out;
}

function _meal_line(m: Meal, X: Index): string {
  const b = m.branch_id ? X.branch.get(m.branch_id) : undefined;
  const where = b ? mustGet(X.shop, b.shop_id).name + (b.area ? `（${b.area}）` : "") : m.place || "没写在哪";
  const ds = (X.by_meal.get(m.id) || [])
    .map((l) => (l.dish_id ? mustGet(X.dish, l.dish_id).name : l.name) + (l.verdict ? `（${V[l.verdict]}）` : ""))
    .join("、");
  return (
    `${m.eaten_on.slice(5)} ${m.slot || ""} ${where}：${ds || m.note || "—"}` +
    (m.total !== null && m.total !== undefined ? ` ${_moneyS(m.total, m.currency)}` : "") +
    (m.src === "chat" ? " ·你记的" : "")
  );
}

function _whole_bad(d: Data, X: Index, keep: (m: Meal) => boolean): [Shop, Meal][] {
  // 这顿整体记成踩雷、但没有哪道菜标踩雷的：一家只算最近那顿；整家拉黑的不重复
  const out: [Shop, Meal][] = [];
  const seen = new Set<number>();
  for (const m of [...d.meals].sort((a, b) => cmpTuple(_mkey(b), _mkey(a)))) {
    const b = m.branch_id ? X.branch.get(m.branch_id) : undefined;
    const s = b ? X.shop.get(b.shop_id) : undefined;
    if (m.verdict !== "bad" || !s || s.verdict === "bad" || seen.has(s.id) || !keep(m)) continue;
    if ((X.by_meal.get(m.id) || []).some((l) => l.verdict === "bad")) continue;
    seen.add(s.id);
    out.push([s, m]);
  }
  return out;
}

function _care_lines(d: Data, X: Index, clock: Clock): string[] {
  // 关心吃饭的那一两行：今天吃了没、上一顿离现在多久。
  const t = d.here.today;
  const real = d.meals.filter((m) => m.slot !== "纯记录"); // 纯记录不算吃了一顿
  const todays = real.filter((m) => m.eaten_on === t).sort((a, b) => cmpTuple(_mkey(a), _mkey(b)));
  const lines = todays.length
    ? [`今天记了 ${todays.length} 顿：` + todays.map((m) => _meal_line(m, X).slice(6)).join("；")]
    : ["今天还没记一顿。"];
  if (real.length) {
    let last = real[0];
    for (const m of real) if (m.created_at > last.created_at) last = m;
    const at = parseNaiveUtc(String(last.created_at).replace(" ", "T")); // 库里存的是 UTC
    if (at !== null) {
      const h = Math.floor((clock.now().getTime() - at) / 1000 / 3600);
      lines.push(h >= 1 ? `上一顿是 ${h} 个小时前记的（${_meal_line(last, X)}）。` : `刚刚记过一顿（${_meal_line(last, X)}）。`);
    }
  }
  return lines;
}

/** 口味单一样东西说成人话：配了哪类菜的说成「炒菜里不要姜葱蒜」「面加麻油」。 */
export function tname(t: { item: string; scope?: string | null; kind: string }): string {
  const sc = pyStrip(t.scope || "");
  const it = t.item;
  if (!sc) return it;
  const m: Record<string, string> = { love: `${sc}加${it}`, hate: `${sc}里不要${it}`, never: `${sc}里不能有${it}` };
  return Object.prototype.hasOwnProperty.call(m, t.kind) ? m[t.kind] : `${sc}·${it}`;
}

function _taste_line(d: Data): string {
  const tl = d.taste || [];
  if (!tl.length) return "【口味单】还没写。";
  const one = (t: Taste) => {
    const extra = [...(t.away ? ["现在吃不到"] : []), ...(t.note ? [t.note] : [])];
    return tname(t) + extra.map((x) => `（${x}）`).join("");
  };
  return (
    "【口味单】" +
    ["never", "hate", "love"]
      .filter((k) => tl.some((t) => t.kind === k))
      .map((k) => TK[k] + "：" + tl.filter((t) => t.kind === k).map(one).join("、"))
      .join("；")
  );
}

function sortStable<T>(a: T[], cmp: (x: T, y: T) => number): T[] {
  return a.sort(cmp); // Array.prototype.sort 是稳的（ES2019），跟 Python 的 sort 一样
}

export function bookText(d: Data, view: string, city0: string, q: string, days: unknown, clock: Clock): string {
  const here = d.here;
  const city = pyStrip(city0 || here.city || "");
  const allc = city === "" || city === "全部" || city === "all";
  const X = _index(d);
  const out = [`〔吃了吗 · ${allc ? "所有城市" : city}〕Ta 现在在${_at(here)}，今天 ${here.today}（${_wd(here.today)}）。`];
  out.push(..._care_lines(d, X, clock));
  out.push(_taste_line(d));
  if (!d.meals.length) {
    out.push("本子里还一顿都没记。别编店名。");
    return out.join("\n");
  }
  const inCity = allc ? (_m: Meal) => true : (m: Meal) => (m.city || "") === city;
  if (view === "" || view === "recent") {
    const since = addDays(here.today, -(pyInt(pyTruthy(days) ? days : 7) - 1));
    const ms = sortStable(
      d.meals.filter((m) => m.eaten_on >= since && inCity(m)),
      (a, b) => cmpTuple(_mkey(b), _mkey(a)),
    );
    out.push(`【这 ${pyStr(days)} 天】` + (!ms.length ? "一顿都没记。" : ""));
    for (const m of ms.slice(0, view ? 25 : 8)) out.push("· " + _meal_line(m, X));
  }
  let items = _items(d, X);
  items = items.filter((it) => allc || it.st.cities.has(city));
  if (view === "" || view === "often") {
    const ok = items.filter((it) => it.st.last !== "bad" && !(it.shop && it.shop.verdict === "bad"));
    sortStable(ok, (a, b) => (a.st.date < b.st.date ? 1 : a.st.date > b.st.date ? -1 : 0));
    sortStable(ok, (a, b) => cmpTuple([-a.st.n, -a.st.good], [-b.st.n, -b.st.good]));
    out.push("【常吃的】" + (!ok.length ? "还看不出来。" : ""));
    for (const it of ok.slice(0, view ? 15 : 6)) {
      const st = it.st;
      const w = _wave(st);
      out.push(`· ${it.name} · ${it.where} · 吃过 ${st.n} 次` + (st.good ? ` · 好吃×${st.good}` : "") + ` · 最近 ${st.date.slice(5)}` + (w ? ` · ${w}` : ""));
    }
  }
  if (view === "" || view === "bad") {
    const black = d.shops.filter(
      (s) => s.verdict === "bad" && (allc || (X.branches_of.get(s.id) || []).some((b) => b.city === city)),
    );
    const bad = items.filter((it) => it.st.last === "bad");
    const whole = _whole_bad(d, X, inCity);
    out.push("【避雷】" + (!black.length && !bad.length && !whole.length ? "没有。" : ""));
    for (const s of black) out.push(`· 整家拉黑：${s.name}` + (s.cuisine ? `（${s.cuisine}）` : "") + (s.note ? ` —— ${s.note}` : ""));
    for (const it of bad.slice(0, 20)) {
      const w = _wave(it.st);
      out.push(`· 踩雷：${it.name} · ${it.where}` + (w ? ` · ${w}` : "") + (it.st.note ? ` —— Ta 说：${it.st.note}` : ""));
    }
    for (const [s, m] of whole.slice(0, 10)) out.push(`· 整顿踩雷：${s.name}（${m.eaten_on.slice(5)} 那顿）` + (m.note ? ` —— Ta 说：${m.note}` : ""));
  }
  if (view === "shop") {
    const ql = pyStrip(q || "").toLowerCase();
    const hits = d.shops.filter((s) => ql && s.name.toLowerCase().includes(ql));
    if (!hits.length) out.push(`【查店】没找到名字里带「${q}」的店 —— 没记过，或者叫法不一样，问 Ta 一句。`);
    for (const s of hits.slice(0, 3)) {
      const bs = X.branches_of.get(s.id) || [];
      const tag = s.verdict === "bad" ? "整家拉黑" : s.verdict === "good" ? "认准这家" : "看菜";
      out.push(
        `【${s.name}】${s.cuisine || ""} · ` +
          tag +
          " · 分店：" +
          bs.map((b) => [b.city, b.area, b.label].filter((x) => x).join(" ")).join("、"),
      );
      for (const x of X.dishes_of.get(s.id) || []) {
        const st = _stat(X.by_dish.get(x.id) || [], X);
        const w = _wave(st);
        out.push(
          `  · ${x.name}：吃过 ${st.n} 次` +
            (["good", "meh", "bad"] as const)
              .filter((k) => st[k])
              .map((k) => ` ${V[k]}×${st[k]}`)
              .join("") +
            (w ? ` · ${w}` : "") +
            (st.note ? ` —— ${st.note}` : ""),
        );
      }
      if (s.note) out.push(`  Ta 对这家说：${s.note}`);
    }
  }
  return out.join("\n");
}

export function contextText(d: Data, clock: Clock): string {
  const X = _index(d);
  const here = d.here;
  const lines = [`〔吃了吗〕今天 ${here.today}（${_wd(here.today)}），Ta 在${_at(here)}。`];
  lines.push(..._care_lines(d, X, clock));
  lines.push(_taste_line(d));
  const bad = _items(d, X).filter((it) => it.st.last === "bad" && (!here.city || it.st.cities.has(here.city)));
  const whole = _whole_bad(d, X, (m) => !here.city || (m.city || "") === here.city);
  if (bad.length || whole.length) {
    lines.push(
      "这座城里踩过的雷：" +
        [...bad.slice(0, 8).map((it) => `${it.name}（${it.where}）`), ...whole.slice(0, 4).map(([s]) => `${s.name} 整顿`)].join("、"),
    );
  }
  lines.push("Ta 跟你说吃了什么，用 food_note 记；说爱吃 / 不吃什么，用 food_taste；推荐吃的之前先 food_book。");
  return lines.join("\n");
}
