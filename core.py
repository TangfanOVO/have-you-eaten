# -*- coding: utf-8 -*-
"""吃了吗 · have-you-eaten —— 存储和规矩。只用标准库（sqlite3），Python 3.9+。

一本「吃过的」：
  店（牌子）→ 分店（城市 · 区 · 哪家店）→ 一顿（哪天 · 哪一顿 · 外卖/堂食 · 花多少）→ 这顿吃的每道菜
  一顿也可以不挂店（自己做的、随手吃的），那就是一页吃饭日记。
  口味单：不记日期的 爱吃 / 不爱吃 / 不能吃。

规矩：
  · 同名的店、同一家店里同名的菜，认成同一个（不分大小写、去两头空白），记录叠在它身上，不新开。
  · 从店里来的那顿，城市必填 —— 不同城市的雷分开放，别挡错路。
  · 好吃 / 一般 / 踩雷 都可以不填。一道菜「现在算不算雷」＝它最后一次表过态的那条。
  · 不算热量。只看清最近到底吃了什么。
"""
import datetime as dt
import json
import os
import sqlite3
import threading
from pathlib import Path

V = {"good": "好吃", "meh": "一般", "bad": "踩雷"}
VIN = {"好吃": "good", "一般": "meh", "踩雷": "bad", "难吃": "bad", "good": "good", "meh": "meh", "bad": "bad"}
HOW = ("外卖", "堂食", "自取")
SLOTS = ("早饭", "午饭", "加餐", "晚饭", "夜宵", "纯记录")    # 纯记录：想起来随手记的，不算哪一顿
TK = {"love": "爱吃", "hate": "不爱吃", "never": "不能吃"}
TKIN = {"爱吃": "love", "不爱吃": "hate", "不能吃": "never", "love": "love", "hate": "hate", "never": "never"}
AU = ("悉尼", "墨尔本", "阿德莱德", "布里斯班", "珀斯", "堪培拉", "霍巴特", "达尔文", "黄金海岸", "凯恩斯")

EDITABLE = {
    "shop": {"name", "cuisine", "note", "verdict"},
    "branch": {"city", "area", "label", "address", "platform", "note"},
    "meal": {"eaten_on", "slot", "place", "city", "photo", "how", "total", "currency", "verdict", "note"},
    "dish": {"name", "note"},
    "log": {"name", "verdict", "price", "note"},
    "taste": {"item", "kind", "note", "away", "scope"},
}
TABLE = {"shop": "shop", "branch": "branch", "meal": "meal", "dish": "dish", "log": "dish_log", "taste": "taste"}

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS shop (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, cuisine TEXT, note TEXT,
  verdict TEXT CHECK (verdict IN ('good','meh','bad')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS shop_name_uq ON shop (lower(trim(name)));
CREATE TABLE IF NOT EXISTS branch (
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  city TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '',
  address TEXT, platform TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS branch_uq ON branch (shop_id, lower(trim(city)), lower(trim(area)), lower(trim(label)));
CREATE TABLE IF NOT EXISTS meal (
  id INTEGER PRIMARY KEY, branch_id INTEGER REFERENCES branch(id) ON DELETE CASCADE,
  eaten_on TEXT NOT NULL, slot TEXT CHECK (slot IN ('早饭','午饭','晚饭','夜宵','加餐','纯记录')),
  place TEXT, city TEXT, photo TEXT, src TEXT NOT NULL DEFAULT 'page' CHECK (src IN ('page','chat')),
  how TEXT CHECK (how IN ('外卖','堂食','自取','自己做')), total REAL, currency TEXT NOT NULL DEFAULT 'CNY',
  verdict TEXT CHECK (verdict IN ('good','meh','bad')), note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS meal_day ON meal (eaten_on DESC, id DESC);
CREATE TABLE IF NOT EXISTS dish (
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  name TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS dish_uq ON dish (shop_id, lower(trim(name)));
CREATE TABLE IF NOT EXISTS dish_log (
  id INTEGER PRIMARY KEY, meal_id INTEGER NOT NULL REFERENCES meal(id) ON DELETE CASCADE,
  dish_id INTEGER REFERENCES dish(id) ON DELETE CASCADE, name TEXT,
  verdict TEXT CHECK (verdict IN ('good','meh','bad')), price REAL, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (dish_id IS NOT NULL OR (name IS NOT NULL AND trim(name) <> '')));
CREATE TABLE IF NOT EXISTS taste (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('love','hate','never')),
  item TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', away INTEGER NOT NULL DEFAULT 0,
  note TEXT, src TEXT NOT NULL DEFAULT 'page' CHECK (src IN ('page','chat')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS setting (k TEXT PRIMARY KEY, v TEXT);
"""


class Bad(Exception):
    """给人看的一句话。"""


def data_dir() -> Path:
    d = Path(os.environ.get("HAVE_YOU_EATEN_DATA") or (Path.home() / ".have-you-eaten"))
    d.mkdir(parents=True, exist_ok=True)
    return d


_LOCK = threading.RLock()     # 网页和 AI 的手可能同时来：一次只放一个进库


class Book:
    def __init__(self, path=None):
        self.path = str(path or (data_dir() / "food.db"))
        with self._db() as c:
            c.executescript(SCHEMA)
            # 口味单：scope（配哪类菜）、away（爱吃但现在吃不到）。老的库补上这两列；同一样东西配不同的菜算两条
            cols = {r["name"] for r in c.execute("PRAGMA table_info(taste)")}
            if "scope" not in cols:
                c.execute("ALTER TABLE taste ADD COLUMN scope TEXT NOT NULL DEFAULT ''")
            if "away" not in cols:
                c.execute("ALTER TABLE taste ADD COLUMN away INTEGER NOT NULL DEFAULT 0")
            c.execute("DROP INDEX IF EXISTS taste_uq")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS taste_uq2 ON taste (lower(trim(item)), lower(trim(scope)))")

    # ── 连接：一次操作一条，出错整笔回滚
    def _db(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        return c

    def _tx(self, fn):
        with _LOCK:
            c = self._db()
            try:
                r = fn(c)
                c.commit()
                return r
            except Exception:
                c.rollback()
                raise
            finally:
                c.close()

    # ── 设置：你在哪座城
    def setting(self, k, default=""):
        with _LOCK:
            c = self._db()
            try:
                r = c.execute("SELECT v FROM setting WHERE k=?", (k,)).fetchone()
                return r["v"] if r else default
            finally:
                c.close()

    def set_setting(self, k, v):
        self._tx(lambda c: c.execute("INSERT INTO setting(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v)))

    def here(self):
        return {"city": self.setting("city"), "spot": self.setting("spot"), "home": "", "today": today().isoformat()}

    # ── 读整本
    def all(self):
        def q(c):
            g = lambda sql: [dict(r) for r in c.execute(sql).fetchall()]
            return {
                "shops": g("SELECT id,name,cuisine,note,verdict,created_at FROM shop ORDER BY id"),
                "branches": g("SELECT id,shop_id,city,area,label,address,platform,note FROM branch ORDER BY id"),
                "meals": g("SELECT id,branch_id,eaten_on,slot,place,city,photo,src,how,total,currency,verdict,note,created_at "
                           "FROM meal ORDER BY eaten_on DESC, id DESC"),
                "dishes": g("SELECT id,shop_id,name,note FROM dish ORDER BY id"),
                "logs": g("SELECT id,meal_id,dish_id,name,verdict,price,note FROM dish_log ORDER BY id"),
                "taste": [dict(t, away=bool(t["away"])) for t in g("SELECT id,kind,item,scope,note,away,src,updated_at FROM taste ORDER BY updated_at DESC, id DESC")],
            }
        d = self._tx(q)
        d["here"] = self.here()
        return d

    # ── 记一顿
    def log(self, b):
        sh, br, ml = b.get("shop") or {}, b.get("branch") or {}, b.get("meal") or {}
        name, city = _s(sh.get("name"), 120), _s(br.get("city"), 60)
        from_shop = bool(sh.get("id") or name)
        here_city = self.setting("city")
        if from_shop and not br.get("id") and not city:
            raise Bad("城市要写 —— 不同城市的雷分开放，别挡错路")
        meal = dict(eaten_on=_date(ml.get("eaten_on")), slot=_slot(ml.get("slot")),
                    place=_s(ml.get("place"), 120), city=_s(ml.get("city"), 60) or city or here_city or None,
                    photo=_s(ml.get("photo"), 300), src="chat" if ml.get("src") == "chat" else "page",
                    how=_how(ml.get("how")), total=_money(ml.get("total")),
                    currency=_s(ml.get("currency"), 8) or cur_for(city or here_city),
                    verdict=_verdict(ml.get("verdict")), note=_s(ml.get("note"), 2000))
        dishes = []
        for d in (b.get("dishes") or [])[:40]:
            dn = _s(d.get("name"), 120)
            if not dn and not d.get("id"):
                continue
            dishes.append(dict(id=d.get("id"), name=dn, verdict=_verdict(d.get("verdict")),
                               price=_money(d.get("price")), note=_s(d.get("note"), 1000)))
        if not from_shop and not dishes and not meal["note"] and not meal["photo"]:
            raise Bad("吃了什么写一样呀")

        def w(c):
            shop_id = branch_id = None
            if from_shop:
                if sh.get("id"):
                    r = c.execute("SELECT id, cuisine FROM shop WHERE id=?", (int(sh["id"]),)).fetchone()
                    if not r:
                        raise Bad("这家店不在了")
                else:
                    r = c.execute("SELECT id, cuisine FROM shop WHERE lower(trim(name))=lower(trim(?))", (name,)).fetchone()
                    if not r:
                        c.execute("INSERT INTO shop(name,cuisine) VALUES(?,?)", (name, _s(sh.get("cuisine"), 40)))
                        r = c.execute("SELECT id, cuisine FROM shop WHERE id=last_insert_rowid()").fetchone()
                shop_id = r["id"]
                cu = _s(sh.get("cuisine"), 40)
                if cu and not r["cuisine"]:
                    c.execute("UPDATE shop SET cuisine=?, updated_at=datetime('now') WHERE id=?", (cu, shop_id))
                if br.get("id"):
                    rb = c.execute("SELECT id, city FROM branch WHERE id=? AND shop_id=?", (int(br["id"]), shop_id)).fetchone()
                    if not rb:
                        raise Bad("这家分店对不上")
                else:
                    area, label = _s(br.get("area"), 60) or "", _s(br.get("label"), 60) or ""
                    rb = c.execute("SELECT id, city FROM branch WHERE shop_id=? AND lower(trim(city))=lower(trim(?)) "
                                   "AND lower(trim(area))=lower(trim(?)) AND lower(trim(label))=lower(trim(?))",
                                   (shop_id, city, area, label)).fetchone()
                    if not rb:
                        c.execute("INSERT INTO branch(shop_id,city,area,label,address,platform) VALUES(?,?,?,?,?,?)",
                                  (shop_id, city, area, label, _s(br.get("address"), 300), _s(br.get("platform"), 40)))
                        rb = c.execute("SELECT id, city FROM branch WHERE id=last_insert_rowid()").fetchone()
                branch_id = rb["id"]
                meal["city"] = rb["city"]
                if not ml.get("currency"):
                    meal["currency"] = cur_for(rb["city"])
                for col, n in (("address", 300), ("platform", 40)):
                    v = _s(br.get(col), n)
                    if v:
                        c.execute(f"UPDATE branch SET {col}=? WHERE id=? AND ({col} IS NULL OR {col}='')", (v, branch_id))
            c.execute("INSERT INTO meal(branch_id,eaten_on,slot,place,city,photo,src,how,total,currency,verdict,note) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                      (branch_id, meal["eaten_on"], meal["slot"], meal["place"], meal["city"], meal["photo"], meal["src"],
                       meal["how"], meal["total"], meal["currency"], meal["verdict"], meal["note"]))
            meal_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            for d in dishes:
                if not from_shop:
                    c.execute("INSERT INTO dish_log(meal_id,name,verdict,price,note) VALUES(?,?,?,?,?)",
                              (meal_id, d["name"], d["verdict"], d["price"], d["note"]))
                    continue
                if d["id"]:
                    rd = c.execute("SELECT id FROM dish WHERE id=? AND shop_id=?", (int(d["id"]), shop_id)).fetchone()
                    if not rd:
                        raise Bad("这道菜对不上这家店")
                else:
                    rd = c.execute("SELECT id FROM dish WHERE shop_id=? AND lower(trim(name))=lower(trim(?))",
                                   (shop_id, d["name"])).fetchone()
                    if not rd:
                        c.execute("INSERT INTO dish(shop_id,name) VALUES(?,?)", (shop_id, d["name"]))
                        rd = c.execute("SELECT id FROM dish WHERE id=last_insert_rowid()").fetchone()
                c.execute("INSERT INTO dish_log(meal_id,dish_id,verdict,price,note) VALUES(?,?,?,?,?)",
                          (meal_id, rd["id"], d["verdict"], d["price"], d["note"]))
            if from_shop:
                c.execute("UPDATE shop SET updated_at=datetime('now') WHERE id=?", (shop_id,))
            # 你现在在哪座城，跟着最近记的那一顿走（手动设的只是兜底）
            if meal["city"]:
                # 换了城，原来写的「具体在哪」就不作数了
                c.execute("UPDATE setting SET v='' WHERE k='spot' AND lower(trim(?)) <> lower(trim(COALESCE((SELECT v FROM setting WHERE k='city'),'')))", (meal["city"],))
                c.execute("INSERT INTO setting(k,v) VALUES('city',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (meal["city"],))
            return {"ok": True, "shop_id": shop_id, "branch_id": branch_id, "meal_id": meal_id}
        return self._tx(w)

    # ── 口味单
    def taste(self, item, kind, note=None, src="page", scope="", away=None):
        """口味单记一样。scope：配哪类菜（「炒菜」里不要姜葱蒜、「面」加麻油），空＝什么都算；away：爱吃但现在吃不到（不传＝不动）。
        同一样东西又配同一类菜的已经在了＝挪档、有备注就换备注。"""
        item = _s(item, 60)
        scope = _s(scope, 40) or ""
        if not item:
            raise Bad("写一样吃的呀")
        kind = TKIN.get(kind or "")
        if not kind:
            raise Bad("爱吃 / 不爱吃 / 不能吃 只认这三样")
        note = _s(note, 300)

        def w(c):
            r = c.execute("SELECT id FROM taste WHERE lower(trim(item))=lower(trim(?)) AND lower(trim(scope))=lower(trim(?))", (item, scope)).fetchone()
            aw = None if away is None else int(bool(away))
            if r:
                c.execute("UPDATE taste SET kind=?, note=COALESCE(?, note), away=COALESCE(?, away), updated_at=datetime('now') WHERE id=?",
                          (kind, note, aw, r["id"]))
                return {"ok": True, "id": r["id"], "moved": True}
            c.execute("INSERT INTO taste(kind,item,scope,note,src,away) VALUES(?,?,?,?,?,?)",
                      (kind, item, scope, note, "chat" if src == "chat" else "page", aw or 0))
            return {"ok": True, "id": c.execute("SELECT last_insert_rowid()").fetchone()[0], "moved": False}
        return self._tx(w)

    # ── 改一条 / 删一条
    def edit(self, kind, rid, fields):
        if kind not in EDITABLE:
            raise Bad("没有这一种")
        sets, vals = [], []
        for k, v in (fields or {}).items():
            if k not in EDITABLE[kind]:
                continue
            if k == "verdict":
                v = _verdict(v)
            elif k == "how":
                v = _how(v)
            elif k in ("total", "price"):
                v = _money(v)
            elif k == "eaten_on":
                v = _date(v)
            elif k == "slot":
                v = _slot(v)
            elif k == "away":
                v = int(bool(v))
            elif k == "scope":
                v = _s(v, 40) or ""
            elif k == "kind":
                v = TKIN.get(v or "")
                if not v:
                    raise Bad("爱吃 / 不爱吃 / 不能吃 只认这三样")
            elif k in ("area", "label"):
                v = _s(v, 60) or ""
            elif k in ("name", "city", "item"):
                v = _s(v, 120)
                if not v:
                    raise Bad("这一栏不能空")
            else:
                v = _s(v, 2000)
            sets.append(f"{k}=?")
            vals.append(v)
        if not sets:
            raise Bad("没有要改的")
        if kind in ("shop", "taste"):
            sets.append("updated_at=datetime('now')")
        try:
            n = self._tx(lambda c: c.execute(f"UPDATE {TABLE[kind]} SET {', '.join(sets)} WHERE id=?", (*vals, int(rid))).rowcount)
        except sqlite3.IntegrityError:
            raise Bad("已经有一条同名的了")
        return {"ok": bool(n)}

    def addlog(self, meal_id, d):
        """记好的一顿再加一道菜（1008 第六轮：存了以后菜只能改名、不能加）"""
        d = d or {}
        dn = _s(d.get("name"), 120)
        if not dn:
            raise Bad("菜名要写")
        verdict, note, price = _verdict(d.get("verdict")), _s(d.get("note"), 1000), _money(d.get("price"))

        def w(c):
            m = c.execute("SELECT m.id, b.shop_id FROM meal m LEFT JOIN branch b ON b.id = m.branch_id WHERE m.id=?", (int(meal_id),)).fetchone()
            if not m:
                raise Bad("这一顿不在了")
            if m["shop_id"] is None:
                c.execute("INSERT INTO dish_log(meal_id,name,verdict,price,note) VALUES(?,?,?,?,?)", (m["id"], dn, verdict, price, note))
            else:
                rd = c.execute("SELECT id FROM dish WHERE shop_id=? AND lower(trim(name))=lower(trim(?))", (m["shop_id"], dn)).fetchone()
                if not rd:
                    c.execute("INSERT INTO dish(shop_id,name) VALUES(?,?)", (m["shop_id"], dn))
                    rd = c.execute("SELECT id FROM dish WHERE id=last_insert_rowid()").fetchone()
                c.execute("INSERT INTO dish_log(meal_id,dish_id,verdict,price,note) VALUES(?,?,?,?,?)", (m["id"], rd["id"], verdict, price, note))
            return {"ok": True, "log_id": c.execute("SELECT last_insert_rowid()").fetchone()[0]}
        return self._tx(w)

    def delete(self, kind, rid):
        if kind not in TABLE:
            raise Bad("没有这一种")
        def w(c):
            # 删一道菜、删一顿：这道菜再没有一次记录，就跟着删掉（1008 第七轮：留下来骰子还会丢到、换名字会撞名）
            ds = []
            if kind == "log":
                ds = [r[0] for r in c.execute("SELECT dish_id FROM dish_log WHERE id=? AND dish_id IS NOT NULL", (int(rid),))]
            elif kind == "meal":
                ds = [r[0] for r in c.execute("SELECT DISTINCT dish_id FROM dish_log WHERE meal_id=? AND dish_id IS NOT NULL", (int(rid),))]
            n = c.execute(f"DELETE FROM {TABLE[kind]} WHERE id=?", (int(rid),)).rowcount
            for did in ds:
                c.execute("DELETE FROM dish WHERE id=? AND NOT EXISTS (SELECT 1 FROM dish_log WHERE dish_id=?)", (did, did))
            return n
        n = self._tx(w)
        return {"ok": bool(n)}

    # ── 给 AI 看的：翻本子
    def book_text(self, view="", city="", q="", days=7):
        d = self.all()
        here = d["here"]
        city = (city or here["city"] or "").strip()
        allc = city in ("", "全部", "all")
        X = _index(d)
        out = [f"〔吃了吗 · {'所有城市' if allc else city}〕Ta 现在在{_at(here)}，今天 {here['today']}（{_wd(here['today'])}）。"]
        out += _care_lines(d, X)
        out.append(_taste_line(d))
        if not d["meals"]:
            out.append("本子里还一顿都没记。别编店名。")
            return "\n".join(out)

        in_city = (lambda m: True) if allc else (lambda m: (m.get("city") or "") == city)
        if view in ("", "recent"):
            since = (dt.date.fromisoformat(here["today"]) - dt.timedelta(days=int(days or 7) - 1)).isoformat()
            ms = sorted([m for m in d["meals"] if m["eaten_on"] >= since and in_city(m)], key=_mkey, reverse=True)
            out.append(f"【这 {days} 天】" + ("一顿都没记。" if not ms else ""))
            for m in ms[:25 if view else 8]:
                out.append("· " + _meal_line(m, X))
        items = _items(d, X)
        items = [it for it in items if allc or city in it["st"]["cities"]]
        if view in ("", "often"):
            ok = [it for it in items if it["st"]["last"] != "bad" and not (it["shop"] and it["shop"]["verdict"] == "bad")]
            ok.sort(key=lambda it: it["st"]["date"], reverse=True)
            ok.sort(key=lambda it: (-it["st"]["n"], -it["st"]["good"]))
            out.append("【常吃的】" + ("还看不出来。" if not ok else ""))
            for it in ok[:15 if view else 6]:
                st = it["st"]
                out.append(f"· {it['name']} · {it['where']} · 吃过 {st['n']} 次" + (f" · 好吃×{st['good']}" if st["good"] else "") + f" · 最近 {st['date'][5:]}")
        if view in ("", "bad"):
            black = [s for s in d["shops"] if s["verdict"] == "bad" and (allc or any(b["city"] == city for b in X["branches_of"].get(s["id"], [])))]
            bad = [it for it in items if it["st"]["last"] == "bad"]
            whole = _whole_bad(d, X, in_city)
            out.append("【避雷】" + ("没有。" if not black and not bad and not whole else ""))
            for s in black:
                out.append(f"· 整家拉黑：{s['name']}" + (f"（{s['cuisine']}）" if s["cuisine"] else "") + (f" —— {s['note']}" if s["note"] else ""))
            for it in bad[:20]:
                out.append(f"· 踩雷：{it['name']} · {it['where']}" + (f" —— Ta 说：{it['st']['note']}" if it["st"]["note"] else ""))
            for s, m in whole[:10]:
                out.append(f"· 整顿踩雷：{s['name']}（{m['eaten_on'][5:]} 那顿）" + (f" —— Ta 说：{m['note']}" if m["note"] else ""))
        if view == "shop":
            ql = (q or "").strip().lower()
            hits = [s for s in d["shops"] if ql and ql in s["name"].lower()]
            if not hits:
                out.append(f"【查店】没找到名字里带「{q}」的店 —— 没记过，或者叫法不一样，问 Ta 一句。")
            for s in hits[:3]:
                bs = X["branches_of"].get(s["id"], [])
                out.append(f"【{s['name']}】{s['cuisine'] or ''} · " + {"bad": "整家拉黑", "good": "认准这家"}.get(s["verdict"] or "", "看菜")
                           + " · 分店：" + "、".join(" ".join(x for x in (b["city"], b["area"], b["label"]) if x) for b in bs))
                for x in X["dishes_of"].get(s["id"], []):
                    st = _stat(X["by_dish"].get(x["id"], []), X)
                    out.append(f"  · {x['name']}：吃过 {st['n']} 次" + "".join(f" {V[k]}×{st[k]}" for k in ("good", "meh", "bad") if st[k])
                               + (f" —— {st['note']}" if st["note"] else ""))
                if s["note"]:
                    out.append(f"  Ta 对这家说：{s['note']}")
        return "\n".join(out)

    def context_text(self):
        """每轮接在系统提示末尾的那一小段（自己搭前端 / 网关的人用）。"""
        d = self.all()
        X = _index(d)
        here = d["here"]
        lines = [f"〔吃了吗〕今天 {here['today']}（{_wd(here['today'])}），Ta 在{_at(here)}。"]
        lines += _care_lines(d, X)
        lines.append(_taste_line(d))
        bad = [it for it in _items(d, X) if it["st"]["last"] == "bad" and (not here["city"] or here["city"] in it["st"]["cities"])]
        whole = _whole_bad(d, X, lambda m: not here["city"] or (m.get("city") or "") == here["city"])
        if bad or whole:
            lines.append("这座城里踩过的雷：" + "、".join([f"{it['name']}（{it['where']}）" for it in bad[:8]] + [f"{s['name']} 整顿" for s, m in whole[:4]]))
        lines.append("Ta 跟你说吃了什么，用 food_note 记；说爱吃 / 不吃什么，用 food_taste；推荐吃的之前先 food_book。")
        return "\n".join(lines)


# ───────── 小工具 ─────────
DAY_STARTS = 5   # 一天从凌晨 5 点算起：熬到两三点补记的那顿还算昨天（1008 复查：半夜 12 点就翻篇，跟夜猫子的一天对不上）


def today():
    return (dt.datetime.now() - dt.timedelta(hours=DAY_STARTS)).date()          # 电脑在哪，今天就按哪儿算


def _whole_bad(d, X, keep):
    """这顿整体记成踩雷、但没有哪道菜标踩雷的：一家只算最近那顿；整家拉黑的不重复"""
    out, seen = [], set()
    for m in sorted(d["meals"], key=_mkey, reverse=True):
        b = X["branch"].get(m["branch_id"]) if m["branch_id"] else None
        s = X["shop"].get(b["shop_id"]) if b else None
        if m["verdict"] != "bad" or not s or s["verdict"] == "bad" or s["id"] in seen or not keep(m):
            continue
        if any(l["verdict"] == "bad" for l in X["by_meal"].get(m["id"], [])):
            continue
        seen.add(s["id"])
        out.append((s, m))
    return out


def _at(here):
    """Ta 现在在哪：城市，写了具体在哪就带上"""
    c = here.get("city") or "（还没设城市）"
    return c + (" " + here["spot"] if here.get("spot") and here.get("city") else "")


def _wd(iso):
    return "周" + "一二三四五六日"[dt.date.fromisoformat(iso).weekday()]


def cur_for(city):
    return "AUD" if city and any(k in city for k in AU) else "CNY"


def _s(v, n=200):
    if v is None:
        return None
    v = str(v).strip()
    return v[:n] if v else None


def _money(v):
    if v in (None, ""):
        return None
    try:
        f = float(str(v).replace(",", "").replace("$", "").replace("¥", "").strip())
    except ValueError:
        raise Bad("价钱看不懂")
    if f < 0 or f > 99999:
        raise Bad("价钱不对")
    return round(f, 2)


def _verdict(v):
    v = _s(v, 8)
    if v is None:
        return None
    v = VIN.get(v)
    if not v:
        raise Bad("好吃 / 一般 / 踩雷 只认这三样")
    return v


def _how(v):
    v = _s(v, 8)
    if v is None:
        return None
    if v not in HOW + ("自己做",):
        raise Bad("外卖 / 堂食 / 自取 只认这三样")
    return v


def _slot(v):
    v = _s(v, 8)
    if v is None:
        return None
    if v == "auto":
        h = (dt.datetime.now().hour + 23) % 24     # 多半是吃完才记：按一个钟头以前猜
        return "早饭" if 5 <= h < 10 else "午饭" if 10 <= h < 16 else "晚饭" if 16 <= h < 22 else "夜宵"
    if v not in SLOTS:
        raise Bad("早饭 / 午饭 / 晚饭 / 夜宵 / 纯记录 只认这几样")
    return v


def _date(v):
    v = _s(v, 10)
    if v is None:
        return today().isoformat()
    try:
        return dt.date.fromisoformat(v).isoformat()
    except ValueError:
        raise Bad("日期看不懂")


def _money_s(v, cur):
    if v is None:
        return ""
    t = f"{float(v):.2f}".rstrip("0").rstrip(".")
    return {"CNY": "¥", "AUD": "A$", "USD": "$", "GBP": "£", "EUR": "€", "JPY": "JP¥"}.get(cur or "", (cur or "") + " ") + t


def _index(d):
    X = {"shop": {s["id"]: s for s in d["shops"]}, "branch": {b["id"]: b for b in d["branches"]},
         "meal": {m["id"]: m for m in d["meals"]}, "dish": {x["id"]: x for x in d["dishes"]},
         "by_meal": {}, "by_dish": {}, "branches_of": {}, "dishes_of": {}}
    for b in d["branches"]:
        X["branches_of"].setdefault(b["shop_id"], []).append(b)
    for x in d["dishes"]:
        X["dishes_of"].setdefault(x["shop_id"], []).append(x)
    for l in d["logs"]:
        X["by_meal"].setdefault(l["meal_id"], []).append(l)
        if l["dish_id"]:
            X["by_dish"].setdefault(l["dish_id"], []).append(l)
    return X


def _mkey(m):
    return (m["eaten_on"], SLOTS.index(m["slot"]) if m["slot"] in SLOTS else 9, m["id"])


def _stat(logs, X):
    r = {"n": 0, "good": 0, "meh": 0, "bad": 0, "last": None, "note": "", "date": "", "cities": set()}
    for l in sorted(logs, key=lambda l: (_mkey(X["meal"][l["meal_id"]]), l["id"])):
        m = X["meal"][l["meal_id"]]
        r["n"] += 1
        if l["verdict"]:
            r[l["verdict"]] += 1
            r["last"] = l["verdict"]
        if l["note"]:
            r["note"] = l["note"]
        r["date"] = m["eaten_on"]
        if m.get("city"):
            r["cities"].add(m["city"])
    return r


def _items(d, X):
    out = []
    for x in d["dishes"]:
        if not X["by_dish"].get(x["id"]):   # 一次都没吃过的不算（1008 第七轮）
            continue
        s = X["shop"].get(x["shop_id"])
        out.append({"name": x["name"], "shop": s, "where": s["name"] if s else "", "st": _stat(X["by_dish"].get(x["id"], []), X)})
    named = {}
    for l in d["logs"]:
        if not l["dish_id"] and l["name"]:
            named.setdefault(l["name"].strip().lower(), []).append(l)
    for ls in named.values():
        m = X["meal"].get(ls[-1]["meal_id"]) or {}
        out.append({"name": ls[-1]["name"], "shop": None, "where": m.get("place") or "自己做的 · 别的", "st": _stat(ls, X)})
    return out


def _meal_line(m, X):
    b = X["branch"].get(m["branch_id"]) if m["branch_id"] else None
    where = (X["shop"][b["shop_id"]]["name"] + (f"（{b['area']}）" if b.get("area") else "")) if b else (m.get("place") or "自己做的")
    ds = "、".join((X["dish"][l["dish_id"]]["name"] if l["dish_id"] else l["name"]) + (f"（{V[l['verdict']]}）" if l["verdict"] else "")
                   for l in X["by_meal"].get(m["id"], []))
    return (f"{m['eaten_on'][5:]} {m['slot'] or ''} {where}：{ds or m.get('note') or '—'}"
            + (f" {_money_s(m['total'], m['currency'])}" if m["total"] is not None else "")
            + (" ·你记的" if m.get("src") == "chat" else ""))


def _care_lines(d, X):
    """关心吃饭的那一两行：今天吃了没、上一顿离现在多久。"""
    t = d["here"]["today"]
    real = [m for m in d["meals"] if m.get("slot") != "纯记录"]      # 纯记录不算吃了一顿
    todays = sorted([m for m in real if m["eaten_on"] == t], key=_mkey)
    if todays:
        lines = [f"今天记了 {len(todays)} 顿：" + "；".join(_meal_line(m, X)[6:] for m in todays)]
    else:
        lines = ["今天还没记一顿。"]
    if real:
        last = max(real, key=lambda m: m["created_at"])
        try:
            ago = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) - dt.datetime.fromisoformat(last["created_at"].replace(" ", "T"))   # 库里存的是 UTC
            h = int(ago.total_seconds() // 3600)
            lines.append(f"上一顿是 {h} 个小时前记的（{_meal_line(last, X)}）。" if h >= 1 else f"刚刚记过一顿（{_meal_line(last, X)}）。")
        except Exception:
            pass
    return lines


def tname(t):
    """口味单一样东西说成人话：配了哪类菜的说成「炒菜里不要姜葱蒜」「面加麻油」。"""
    sc, it = (t.get("scope") or "").strip(), t["item"]
    if not sc:
        return it
    return {"love": f"{sc}加{it}", "hate": f"{sc}里不要{it}", "never": f"{sc}里不能有{it}"}.get(t["kind"], f"{sc}·{it}")


def _taste_line(d):
    tl = d.get("taste") or []
    if not tl:
        return "【口味单】还没写。"
    def one(t):
        extra = (["现在吃不到"] if t.get("away") else []) + ([t["note"]] if t.get("note") else [])
        return tname(t) + "".join(f"（{x}）" for x in extra)
    return "【口味单】" + "；".join(TK[k] + "：" + "、".join(one(t) for t in tl if t["kind"] == k)
                                 for k in ("never", "hate", "love") if any(t["kind"] == k for t in tl))
