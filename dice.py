# -*- coding: utf-8 -*-
"""这顿吃什么 —— 菜谱骰子。只用标准库。

菜单在 dishes.txt：一行一道「菜名|菜系|类别|用料,用料」。菜名是大家都在叫的名字，这份清单是我们自己编的。
再并上本子里 Ta 自己记过的菜（踩过雷的不进来）。

怎么剔，全照口味单：
  · 写的是一个菜系（川菜、日料、东南亚、外国菜…）：不能吃 / 不爱吃 ＝ 那个菜系整个不丢；爱吃 ＝ 更容易丢中
  · 不能吃：菜名或用料里有，整道剔掉（牛羊 ＝ 牛肉、羊肉；牛蛙不算牛）
  · 不爱吃：菜名里有、或者它就是主料，整道剔掉；只在配料里（葱、香菜、辣椒…），留着，提醒「点的时候备注不要 X」
  · 带搭配的（炒菜里不要姜）：不剔，只提醒
  · 爱吃的：更容易丢中（×3）；临时想吃的（want）：×20，大约八成丢到它
两种丢法：dish 丢一道菜；way 丢一个方向（只出菜系，给几道例子）。
"""
import random
from pathlib import Path

CUISINES = ("川菜", "湘菜", "粤菜", "港式", "闽菜", "江浙菜", "鲁菜", "京菜", "徽菜", "东北菜", "西北菜", "新疆菜",
            "云贵菜", "台湾菜", "家常菜", "日料", "韩餐", "泰国菜", "越南菜", "东南亚", "印度菜", "西餐", "快餐", "轻食")
FOREIGN = {"日料", "韩餐", "泰国菜", "越南菜", "东南亚", "印度菜", "西餐", "快餐", "轻食"}
KINDS = ("饭", "面粉", "菜", "汤粥", "小吃", "锅")

# 口味单里写的菜系，各种叫法都认
ALIAS = {
    "四川菜": "川菜", "重庆菜": "川菜", "湖南菜": "湘菜", "广东菜": "粤菜", "港餐": "港式", "茶餐厅": "港式", "福建菜": "闽菜",
    "浙菜": "江浙菜", "苏菜": "江浙菜", "上海菜": "江浙菜", "本帮菜": "江浙菜", "山东菜": "鲁菜", "北京菜": "京菜", "安徽菜": "徽菜",
    "东北": "东北菜", "西北": "西北菜", "新疆": "新疆菜", "清真": "新疆菜", "云南菜": "云贵菜", "贵州菜": "云贵菜", "台湾": "台湾菜",
    "日本菜": "日料", "日本料理": "日料", "日式": "日料", "日餐": "日料", "韩国菜": "韩餐", "韩国料理": "韩餐", "韩式": "韩餐", "韩料": "韩餐",
    "泰餐": "泰国菜", "泰式": "泰国菜", "泰国": "泰国菜", "越南": "越南菜", "越餐": "越南菜", "印度": "印度菜", "印度料理": "印度菜",
    "西式": "西餐", "洋快餐": "快餐", "炸鸡汉堡": "快餐", "沙拉": "轻食", "东南亚菜": "东南亚", "南洋菜": "东南亚",
    "外国菜": "外国菜", "洋餐": "外国菜", "中餐": "中国菜", "中国菜": "中国菜",
}
GROUP = {
    "东南亚": {"泰国菜", "越南菜", "东南亚"},
    "粤菜": {"粤菜", "港式"},
    "西北菜": {"西北菜", "新疆菜"},
    "外国菜": set(FOREIGN),
    "中国菜": set(CUISINES) - FOREIGN,
}
# 一个字、一个大类 → 菜单里用的那几个用料词
ROOT = {
    "牛": ("牛肉",), "羊": ("羊肉",), "猪": ("猪肉",), "鸡": ("鸡肉",), "鸭": ("鸭肉",), "鹅": ("鹅肉",), "兔": ("兔肉",),
    "鱼": ("鱼",), "虾": ("虾",), "蟹": ("蟹",), "葱": ("葱",), "姜": ("姜",), "蒜": ("蒜",), "辣": ("辣椒",), "麻": ("花椒",),
    "蛋": ("鸡蛋",), "蛙": ("牛蛙",), "奶": ("牛奶", "奶酪", "奶油"),
    "海鲜": ("鱼", "虾", "蟹", "贝类", "鱿鱼"), "水产": ("鱼", "虾", "蟹", "贝类", "鱿鱼"), "红肉": ("牛肉", "羊肉", "猪肉"),
    "内脏": ("内脏",), "下水": ("内脏",), "麻酱": ("芝麻酱",), "芝麻": ("芝麻", "芝麻酱", "香油"), "麻油": ("香油",),
    "乳制品": ("牛奶", "奶酪", "奶油"), "奶制品": ("牛奶", "奶酪", "奶油"), "芝士": ("奶酪",), "坚果": ("坚果", "花生"),
    "葱花": ("葱",), "大葱": ("葱",), "小葱": ("葱",), "生姜": ("姜",), "大蒜": ("蒜",), "蒜蓉": ("蒜",), "辣椒": ("辣椒",),
    "蘑菇": ("菌菇",), "菇": ("菌菇",), "香菇": ("菌菇",), "豆腐": ("豆腐", "豆制品"), "鸡蛋": ("鸡蛋",), "加工肉": ("加工肉",),
}
# 拿一个字去对菜名时，这些词里的那个字不算（牛蛙不是牛，洋葱不是葱，鱼香肉丝里没有鱼）
NOT_IN_NAME = {
    "牛": ("牛蛙", "牛油果", "牛奶", "蜗牛", "牛轧", "牛肝菌"), "葱": ("洋葱",), "鱼": ("鱼香", "鱿鱼", "鱼露", "鱼豆腐", "鱼腥草"),
    "鸡": ("鸡蛋", "鸡枞", "鸡腿菇", "鸡头米"), "麻": ("芝麻", "麻酱", "麻油", "麻薯"), "羊": ("羊城", "羊肚菌"), "奶": ("奶茶",),
    "蟹": ("蟹味菇",), "鸭": ("鸭梨",),
}
VOCAB = set("""猪肉 牛肉 羊肉 鸡肉 鸭肉 鹅肉 兔肉 内脏 加工肉 牛蛙 鱼 虾 蟹 贝类 鱿鱼 海带 紫菜 鸡蛋 牛奶 奶酪 奶油 豆腐 豆制品
土豆 番茄 茄子 青椒 白菜 包菜 菌菇 木耳 莲藕 黄瓜 豆芽 酸菜 萝卜 洋葱 韭菜 芹菜 生菜 菠菜 西兰花 玉米 竹笋 豆角 苦瓜 山药 芋头 南瓜 红薯 蒜苔 莴笋 空心菜 秋葵 牛油果
米饭 面条 米粉 粉丝 年糕 糯米 面皮 葱 姜 蒜 香菜 辣椒 花椒 芝麻 芝麻酱 花生 香油 醋 咖喱 椰奶 鱼露 芥末 孜然 柠檬 罗勒 紫苏 酒 坚果 菠萝""".split())

HERE = Path(__file__).resolve().parent
MENU_FILE = HERE / "dishes.txt"   # 换地方放菜单改这一行
_MENU = None


def menu(path=None):
    """读 dishes.txt；写错的行跳过"""
    global _MENU
    if _MENU is not None and path is None:
        return _MENU
    out, seen = [], set()
    p = Path(path) if path else MENU_FILE
    for line in p.read_text(encoding="utf-8").splitlines():
        f = [x.strip() for x in line.split("|")]
        if len(f) != 4 or not f[0] or f[1] not in CUISINES or f[2] not in KINDS or f[0] in seen:
            continue
        seen.add(f[0])
        out.append({"name": f[0], "cuisine": f[1], "kind": f[2], "tags": [t for t in f[3].split(",") if t.strip() in VOCAB]})
    if path is None:
        _MENU = out
    return out


def cuisine_of(item):
    """口味单里这一样是不是在说一整个菜系；是就给出它包含的菜系"""
    k = (item or "").strip()
    for tail in ("系", "料理"):
        if k.endswith(tail) and k[:-len(tail)] in CUISINES:
            k = k[:-len(tail)]
    k = ALIAS.get(k, k)
    if k in GROUP:
        return set(GROUP[k])
    if k in CUISINES:
        return {k}
    return None


def _terms(item):
    """一样东西 → (对用料的词, 对菜名的词)。「丸子这类半成品」「鸡鸭鱼蛙这类白肉」：认「这类」前面那几个字"""
    item = (item or "").strip()
    for sep in ("这类", "之类", "这种", "一类", "那类"):
        head = item.split(sep)[0].strip()
        if sep in item and head:
            _, t2, n2 = _terms(head)
            return item, t2, n2 | {item}
    tags = set(ROOT.get(item, ()))
    if item in VOCAB:
        tags.add(item)
    roots = list(item) if len(item) > 1 and all(c in ROOT for c in item) else []   # 牛羊、葱姜蒜
    for c in roots:
        tags |= set(ROOT[c])
    names = {item} | {t for t in tags if len(t) > 1} | set(roots)
    return item, tags, names


def _hit_name(name, words):
    for w in words:
        clean = name
        for ex in NOT_IN_NAME.get(w, ()):
            clean = clean.replace(ex, "")
        if w and w in clean:
            return True
    return False


def _hit(x, tags, names):
    return bool(tags & set(x["tags"])) or _hit_name(x["name"], names)


def rules(taste, want=""):
    R = {"ex_cuis": set(), "love_cuis": set(), "never": [], "hate": [], "love": [], "scoped": [], "want": None, "want_cuis": set()}
    for t in taste or []:
        item, kind, scope = (t.get("item") or "").strip(), t.get("kind"), (t.get("scope") or "").strip()
        if not item or kind not in ("never", "hate", "love"):
            continue
        cs = None if scope else cuisine_of(item)
        if cs:
            (R["ex_cuis"] if kind in ("never", "hate") else R["love_cuis"]).update(cs)
        elif scope:
            if kind != "love":
                R["scoped"].append(_terms(item))
        else:
            R[kind].append(_terms(item))
    if (want or "").strip():
        cs = cuisine_of(want)
        if cs:
            R["want_cuis"] = cs
        else:
            R["want"] = _terms(want)
    return R


def judge(x, R):
    """这道菜能不能丢：不能 → None；能 → (分量, 提醒)"""
    if x["cuisine"] in R["ex_cuis"]:
        return None
    for item, tags, names in R["never"]:
        if _hit(x, tags, names):
            return None
    garnish = []
    for item, tags, names in R["hate"]:
        if _hit_name(x["name"], names) or (x["tags"] and x["tags"][0] in tags):
            return None
        if tags & set(x["tags"]):
            garnish.append(item)
    for item, tags, names in R["scoped"]:
        if _hit(x, tags, names):
            garnish.append(item)
    w = 1.0
    if any(_hit(x, tags, names) for item, tags, names in R["love"]):
        w *= 3
    if x["cuisine"] in R["love_cuis"]:
        w *= 3
    if R["want"] and _hit(x, R["want"][1], R["want"][2]):
        w *= 20   # 临时想吃的：大约八成丢到它，又不至于只剩它
    if x["cuisine"] in R["want_cuis"]:
        w *= 20
    if x.get("own") == "good":
        w *= 2
    notes = []
    if garnish:
        notes.append("点的时候备注：不要" + "、".join(dict.fromkeys(garnish)))
    return w, notes


def _norm(s):
    return (s or "").strip().lower()


def pool(d, kind=""):
    """菜单 ＋ 本子里自己记过的菜。带上 Ta 吃过的记录"""
    shops = {s["id"]: s for s in d.get("shops", [])}
    branch = {b["id"]: b for b in d.get("branches", [])}
    meals = {m["id"]: m for m in d.get("meals", [])}
    dishes = {x["id"]: x for x in d.get("dishes", [])}
    seen = {}   # 菜名 → 最近一次 (日子, 店, 评价)
    for l in sorted(d.get("logs", []), key=lambda l: ((meals.get(l["meal_id"]) or {}).get("eaten_on") or "", l["id"])):
        nm = (dishes.get(l.get("dish_id")) or {}).get("name") or l.get("name")
        m = meals.get(l["meal_id"]) or {}
        b = branch.get(m.get("branch_id")) if m.get("branch_id") else None
        s = shops.get(b["shop_id"]) if b else None
        if nm:
            prev = seen.get(_norm(nm), {})
            seen[_norm(nm)] = {"shop": s, "verdict": l.get("verdict") or prev.get("verdict"), "date": m.get("eaten_on") or ""}
    out = [dict(x) for x in menu()]
    have = {_norm(x["name"]) for x in out}
    for x in d.get("dishes", []):   # 自己记过、菜单上没有的
        k = _norm(x["name"])
        h = seen.get(k) or {}
        s = shops.get(x.get("shop_id"))
        if k in have or not h or h.get("verdict") == "bad" or (s and s.get("verdict") == "bad"):   # not h：一次都没吃过的（删掉的菜留下的名字）不丢（1008 第七轮）
            continue
        have.add(k)
        c = ALIAS.get(((s or {}).get("cuisine") or "").strip(), ((s or {}).get("cuisine") or "").strip())
        out.append({"name": x["name"], "cuisine": c if c in CUISINES else "家常菜", "kind": "菜", "tags": [], "mine": True})
    for x in out:
        h = seen.get(_norm(x["name"]))
        if h:
            x["own"] = h["verdict"] or "seen"
            x["hist"] = h
    return [x for x in out if not kind or x["kind"] == kind]


def _hist_line(h):
    s = h.get("shop")
    where = s["name"] if s else ""
    if h.get("verdict") == "bad":
        return f"上回在{where}踩过雷，换一家点" if where else "上回吃这个踩过雷"
    if s and s.get("verdict") == "bad":
        return f"{where}已经拉黑了，换一家点"
    if h.get("verdict") == "good":
        return f"你在{where}吃过，好吃" if where else "你吃过，说好吃"
    return f"你在{where}吃过" if where else "你吃过"


def roll(d, mode="dish", kind="", want="", rng=None, only=""):
    """only＝只在这一个菜系里丢（页面上从「一个方向」点进来用）；want 只是往那边偏"""
    rng = rng or random.Random()
    R = rules(d.get("taste"), want)
    only = (only or "").strip()
    keep, removed = [], 0
    for x in pool(d, kind):
        if only and x["cuisine"] != only:
            continue
        r = judge(x, R)
        if r is None:
            removed += 1
            continue
        keep.append((x, r[0], r[1]))
    base = {"ok": True, "mode": mode, "count": len(keep), "removed": removed, "kind": kind or "", "want": want or "", "only": only}
    if not keep:
        return dict(base, empty=True)
    if mode == "way":
        by = {}
        for it in keep:
            by.setdefault(it[0]["cuisine"], []).append(it)
        cs = list(by)
        cw = [(3 if c in R["love_cuis"] else 1) * (20 if c in R["want_cuis"] else 1) * (1 + 0.15 * min(len(by[c]), 10)) for c in cs]
        c = rng.choices(cs, weights=cw)[0]
        items = by[c][:]
        ex = []
        while items and len(ex) < 3:
            it = rng.choices(items, weights=[i[1] for i in items])[0]
            items.remove(it)
            ex.append(it[0]["name"])
        return dict(base, cuisine=c, examples=ex, inside=len(by[c]), cuisines=len(cs))
    x, w, notes = rng.choices(keep, weights=[i[1] for i in keep])[0]
    if x.get("hist"):
        notes = notes + [_hist_line(x["hist"])]
    return dict(base, name=x["name"], cuisine=x["cuisine"], dish_kind=x["kind"], notes=notes, mine=bool(x.get("mine")))


def text(r):
    """给 AI 看的一句话"""
    if r.get("empty"):
        return "（按 Ta 的口味单剔完，" + (f"「{r['kind']}」这一类" if r.get("kind") else "菜单") + "里一道都不剩了。问问 Ta 想吃什么。）"
    tail = f"（{'只在' + r['only'] + '里丢，' if r.get('only') else ''}从 {r['count']} 道里丢的，按口味单剔掉了 {r['removed']} 道" + (f"，往「{r['want']}」上偏了" if r.get("want") else "") + "）"
    if r["mode"] == "way":
        return f"丢到：{r['cuisine']}。比如 {'、'.join(r['examples'])}。" + tail
    return f"丢到：{r['name']}（{r['cuisine']} · {r['dish_kind']}）。" + "".join(n + "。" for n in r["notes"]) + tail
