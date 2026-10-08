#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""冒烟测试：一个临时数据目录里把本子、网页接口、三只手各走一遍，跑完删掉。
    python3 tests/smoke_test.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = tempfile.mkdtemp(prefix="hye-test-")
os.environ["HAVE_YOU_EATEN_DATA"] = TMP
sys.path.insert(0, str(ROOT))
import core  # noqa: E402
import web  # noqa: E402

ok = True


def check(name, cond, extra=""):
    global ok
    print(("  ok  " if cond else "  ✗✗  ") + name + (f"  {extra}" if extra != "" else ""))
    ok = ok and bool(cond)


try:
    b = core.Book()
    check("空本子", b.all()["meals"] == [])
    b.set_setting("city", "重庆")
    r = b.log({"shop": {"name": "川味小馆", "cuisine": "川菜"}, "branch": {"city": "重庆", "area": "解放碑"},
               "meal": {"slot": "晚饭", "how": "外卖", "total": 32},
               "dishes": [{"name": "辣子鸡", "verdict": "踩雷", "note": "裹粉油炸"}, {"name": "空心菜", "verdict": "good"}]})
    check("记一顿", r["ok"] and r["shop_id"])
    r2 = b.log({"shop": {"name": " 川味小馆"}, "branch": {"city": "重庆", "area": "解放碑"}, "dishes": [{"name": "空心菜"}]})
    check("同名店、同名菜认成同一个", r2["shop_id"] == r["shop_id"] and r2["branch_id"] == r["branch_id"] and len(b.all()["dishes"]) == 2)
    r3 = b.log({"meal": {"place": "家里"}, "dishes": [{"name": "煎蛋"}]})
    check("不挂店的日记", r3["ok"] and r3["shop_id"] is None)
    ra = b.addlog(r["meal_id"], {"name": "米饭", "verdict": "good"})
    dd = b.all()
    check("记好的一顿再加一道", ra["ok"] and any(l["meal_id"] == r["meal_id"] and l["dish_id"] and [x for x in dd["dishes"] if x["id"] == l["dish_id"]][0]["name"] == "米饭" for l in dd["logs"]))
    rb = b.addlog(r3["meal_id"], {"name": "白粥"})
    check("不挂店的那顿也能加", rb["ok"] and any(l["meal_id"] == r3["meal_id"] and l["name"] == "白粥" for l in b.all()["logs"]))
    try:
        b.addlog(r["meal_id"], {"name": " "})
        check("加菜不写名挡下", False)
    except core.Bad:
        check("加菜不写名挡下", True)
    rp = b.addlog(r["meal_id"], {"name": "冰粉", "price": 8})
    check("加菜带价钱", [l for l in b.all()["logs"] if l["id"] == rp["log_id"]][0]["price"] == 8)
    b.delete("log", rp["log_id"])
    b.delete("log", ra["log_id"])
    b.delete("log", rb["log_id"])
    check("删掉最后一次记录，菜跟着走", not any(x["name"] in ("米饭", "冰粉") for x in b.all()["dishes"]))
    check("加的删回去", len(b.all()["dishes"]) == 2 and len(b.all()["logs"]) == 4)
    # 改评价、时好时坏（1008）
    import mcp_server
    rl = b.log({"shop": {"name": "东北人家"}, "branch": {"city": "重庆", "area": "Mascot"}, "meal": {"eaten_on": "2026-10-01", "slot": "午饭"},
                "dishes": [{"name": "酸豆角炒肉末"}, {"name": "米饭"}]})
    t = mcp_server.call(b, "food_rate", {"dish": "酸豆角", "verdict": "好吃", "note": "下饭"})
    lg = [l for l in b.all()["logs"] if l["meal_id"] == rl["meal_id"]]
    check("改评价：名字包含也认、改到最近那一顿", "改好了" in t and any(l["verdict"] == "good" and l["note"] == "下饭" for l in lg), t)
    check("改评价：只有一次好吃还不算时好时坏", "时好时坏" not in t, t)
    b.log({"shop": {"name": "东北人家"}, "branch": {"city": "重庆", "area": "Mascot"}, "meal": {"eaten_on": "2026-10-03", "slot": "晚饭"},
           "dishes": [{"name": "酸豆角炒肉末", "verdict": "踩雷", "note": "齁咸"}]})
    t = mcp_server.call(b, "food_rate", {"dish": "米饭", "verdict": "一般", "date": "2026-10-01"})
    check("改评价：按日子找回那一顿", "10-01" in t and "米饭" in t, t)
    t2 = mcp_server.call(b, "food_rate", {"verdict": "一般", "shop": "东北人家", "date": "2026-10-01"})
    check("改评价：不写菜＝这一顿整体", "这一顿整体" in t2 and [m for m in b.all()["meals"] if m["id"] == rl["meal_id"]][0]["verdict"] == "meh", t2)
    bk = b.book_text("bad", "重庆")
    check("翻本子：时好时坏带日子", "时好时坏：10-01 好吃、10-03 踩雷（最近一次踩雷）" in bk, bk)
    try:
        b.rate("鱼香肉丝", "好吃")
        check("改评价：没吃过的菜挡下", False)
    except core.Bad:
        check("改评价：没吃过的菜挡下", True)
    check("给我本子链接：本机地址", "127.0.0.1" in mcp_server.call(b, "food_page", {}))
    for m in [m for m in b.all()["meals"] if m["eaten_on"] in ("2026-10-01", "2026-10-03")]:
        b.delete("meal", m["id"])
    check("改评价那几顿删回去", len(b.all()["logs"]) == 4 and not any(x["name"] in ("酸豆角炒肉末", "米饭") for x in b.all()["dishes"]))
    d = b.all()
    check("币种按城市（重庆＝人民币）", all(m["currency"] == "CNY" for m in d["meals"]))
    check("日记那顿城市按设置", [m for m in d["meals"] if m["id"] == r3["meal_id"]][0]["city"] == "重庆")
    for bad, body in [("没城市", {"shop": {"name": "x"}, "branch": {}}), ("什么都没写", {"meal": {}}),
                      ("乱写评价", {"meal": {}, "dishes": [{"name": "a", "verdict": "yum"}]}),
                      ("乱写价钱", {"meal": {"total": "很贵"}, "dishes": [{"name": "a"}]})]:
        try:
            b.set_setting("city", "") if bad == "没城市" else None
            b.log(body)
            check(f"{bad}挡下", False)
        except core.Bad:
            check(f"{bad}挡下", True)
        finally:
            b.set_setting("city", "重庆")
    try:
        b.log({"shop": {"name": "半截店"}, "branch": {"city": "重庆"}, "dishes": [{"id": 9999, "name": "x"}]})
    except core.Bad:
        pass
    check("记到一半对不上，整笔退回", not any(s["name"] == "半截店" for s in b.all()["shops"]))
    check("口味：记", b.taste("火锅", "爱吃")["moved"] is False)
    check("口味：同名挪档", b.taste(" 火锅 ", "不爱吃")["moved"] is True and b.all()["taste"][0]["kind"] == "hate")
    b.taste("咖啡", "不能吃", "过敏")
    r1 = b.taste("姜葱蒜", "不爱吃", scope="炒菜")
    r2 = b.taste("姜葱蒜", "不爱吃")
    check("同一样东西配不同的菜＝两条", r1["id"] != r2["id"] and not r2["moved"])
    b.taste("麻油", "爱吃", scope="面")
    b.taste("霸王茶姬奶茶", "爱吃", away=True)
    tt = {(t["item"], t["scope"]): t for t in b.all()["taste"]}
    check("吃不到读回来是真假值", tt[("霸王茶姬奶茶", "")]["away"] is True and tt[("麻油", "面")]["away"] is False)
    b.log({"meal": {"slot": "纯记录", "place": "家里"}, "dishes": [{"name": "想起来记一笔"}]})
    txt = b.book_text()
    check("翻本子：今天吃了没", "今天记了" in txt, txt.splitlines()[1])
    check("翻本子：口味单、避雷都在", "不能吃：咖啡（过敏）" in txt and "踩雷：辣子鸡" in txt)
    check("翻本子：搭配说成人话、吃不到标出来", "炒菜里不要姜葱蒜" in txt and "面加麻油" in txt and "霸王茶姬奶茶（现在吃不到）" in txt)
    check("纯记录不算今天吃的一顿", "今天记了 3 顿" in txt, txt.splitlines()[1][:30])
    check("翻本子：常吃不含踩雷那道", "· 辣子鸡 ·" not in txt.split("【常吃的】")[1].split("【避雷】")[0])
    check("每轮注入那段", "Ta 跟你说吃了什么" in b.context_text())
    was = b.here()["city"]
    b.set_setting("city", "悉尼"); b.set_setting("spot", "Mascot")
    check("具体在哪：带进 AI 看的那段", "Ta 在悉尼 Mascot" in b.context_text())
    b.log({"shop": {"name": "换城小店"}, "branch": {"city": "墨尔本"}, "meal": {"city": "墨尔本"}, "dishes": [{"name": "x"}]})
    check("换了城，具体在哪清掉", b.here()["city"] == "墨尔本" and b.here()["spot"] == "")
    b.delete("shop", [x for x in b.all()["shops"] if x["name"] == "换城小店"][0]["id"])
    b.set_setting("city", was)
    ms = b.all()["meals"]
    check("改哪一顿", b.edit("meal", ms[0]["id"], {"slot": "午饭"})["ok"])
    check("删店，底下跟着走", b.delete("shop", r["shop_id"])["ok"] and not b.all()["dishes"] and len(b.all()["meals"]) == 2)   # 剩下：家里那顿煎蛋 ＋ 纯记录那笔

    # 网页接口
    srv = web.make_server(b, port=0)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    def req(path, body=None, headers=None):
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        rq = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=h,
                                    method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(rq, timeout=5) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    check("页面", req("/")[0] == 200 and "吃了吗" in req("/")[1])
    check("app.js", req("/app.js")[0] == 200)
    check("整本", json.loads(req("/api/food")[1])["here"]["city"] == "重庆")
    check("网页记一顿", json.loads(req("/api/food/log", {"meal": {"place": "学校"}, "dishes": [{"name": "面"}]})[1])["ok"])
    check("网页口味单", json.loads(req("/api/food/taste", {"item": "蛙", "kind": "love"})[1])["ok"])
    check("乱写挡下（400）", req("/api/food/taste", {"item": "x", "kind": "yum"})[0] == 400)
    check("别的网站来写：403", req("/api/food/taste", {"item": "x", "kind": "love"}, {"Origin": "https://evil.example"})[0] == 403)
    check("改了 Host 的：403", req("/api/food", headers={"Host": "evil.example"})[0] == 403)
    check("不是 JSON 的写：415", req("/api/settings", {"city": "x"}, {"Content-Type": "text/plain"})[0] == 415)
    check("/food/context", "吃了吗" in req("/food/context")[1])
    check("/food/tools", [t["name"] for t in json.loads(req("/food/tools")[1])] == ["food_note", "food_taste", "food_book", "food_dice", "food_rate", "food_page"])
    check("/food/ai", "记上了" in req("/food/ai", {"tool": "food_taste", "input": {"item": "奶茶", "kind": "爱吃"}})[1])
    srv.shutdown()

    # 三只手（MCP，stdio）
    lines = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
             {"jsonrpc": "2.0", "method": "notifications/initialized"},
             {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
             {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "food_note", "arguments": {"shop": "面馆", "dishes": [{"name": "小面", "verdict": "好吃"}]}}},
             {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "food_taste", "arguments": {"item": "香菜", "kind": "不爱吃"}}},
             {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "food_book", "arguments": {}}},
             {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "food_note", "arguments": {}}},
             {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "food_taste", "arguments": {"items": ["牛蛙", "毛血旺"], "kind": "爱吃"}}},
             {"jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": {"name": "food_taste", "arguments": {"item": "麻油", "kind": "拿掉", "scope": "面"}}}]
    p = subprocess.run([sys.executable, str(ROOT / "mcp_server.py")], input="\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n",
                       capture_output=True, text=True, timeout=20, env={**os.environ, "HAVE_YOU_EATEN_NO_WEB": "1"})
    out = {j["id"]: j for j in (json.loads(l) for l in p.stdout.splitlines() if l.strip())}
    check("MCP：握手", out[1]["result"]["serverInfo"]["name"] == "have-you-eaten")
    check("MCP：通知不回话", len(out) == 8, sorted(out))
    check("MCP：六只手", [t["name"] for t in out[2]["result"]["tools"]] == ["food_note", "food_taste", "food_book", "food_dice", "food_rate", "food_page"])
    check("MCP：记一笔（城市按设置）", "记下了" in out[3]["result"]["content"][0]["text"])
    check("MCP：口味单", "不爱吃 · 香菜" in out[4]["result"]["content"][0]["text"])
    t5 = out[5]["result"]["content"][0]["text"]
    check("MCP：翻本子看得到刚记的", "小面（好吃）" in t5 and "香菜" in t5)
    check("MCP：什么都没写不崩，说人话", "没记上" in out[6]["result"]["content"][0]["text"])
    check("MCP：一次记一串", "爱吃 · 牛蛙；爱吃 · 毛血旺" in out[7]["result"]["content"][0]["text"], out[7]["result"]["content"][0]["text"])
    check("MCP：按搭配拿掉", "拿掉了「面加麻油」" in out[8]["result"]["content"][0]["text"], out[8]["result"]["content"][0]["text"])
    check("MCP：没有报错输出", p.stderr.strip() == "", p.stderr[:200])

    # ── 这顿吃什么：照口味单剔
    import random
    import dice
    fx = Path(TMP) / "menu.txt"
    fx.write_text("\n".join([
        "宫保鸡丁|川菜|菜|鸡肉,花生,辣椒,花椒,葱,姜,蒜",
        "肥牛饭|日料|饭|牛肉,米饭,洋葱",
        "三文鱼寿司|日料|小吃|鱼,米饭,芥末,紫菜",
        "牛蛙火锅|川菜|锅|牛蛙,辣椒,花椒,葱",
        "葱油拌面|江浙菜|面粉|面条,葱,香油",
        "洋葱圈|快餐|小吃|洋葱",
        "南瓜粥|家常菜|汤粥|南瓜,糯米",
        "石锅拌饭|韩餐|饭|米饭,鸡蛋,豆芽,菠菜,辣椒,芝麻",
        "写错的行|火星菜|饭|米饭",
    ]), encoding="utf-8")
    dice.MENU_FILE, dice._MENU = fx, None
    check("菜单：写错的行跳过", [x["name"] for x in dice.menu()][-1] == "石锅拌饭" and len(dice.menu()) == 8)
    taste = [{"item": "牛羊", "kind": "never"}, {"item": "葱", "kind": "hate"}, {"item": "寿司", "kind": "hate"},
             {"item": "南瓜", "kind": "hate"}, {"item": "韩国料理", "kind": "hate"}, {"item": "炒菜", "kind": "hate", "scope": ""}]
    R = dice.rules(taste)
    left = {x["name"]: dice.judge(x, R) for x in dice.menu()}
    check("骰子：牛羊整道剔，牛蛙不算牛", left["肥牛饭"] is None and left["牛蛙火锅"] is not None)
    check("骰子：葱只在配料里＝留着、提醒备注", left["宫保鸡丁"] and "不要葱" in left["宫保鸡丁"][1][0])
    check("骰子：葱在菜名里＝剔；洋葱不是葱", left["葱油拌面"] is None and left["洋葱圈"] is not None)
    check("骰子：不爱吃寿司只剔寿司，不爱吃南瓜剔南瓜粥", left["三文鱼寿司"] is None and left["南瓜粥"] is None)
    check("骰子：写了一个菜系＝整个菜系剔", left["石锅拌饭"] is None)
    R2 = dice.rules([{"item": "日料", "kind": "hate"}])
    check("骰子：不爱日料，日料全剔", all(dice.judge(x, R2) is None for x in dice.menu() if x["cuisine"] == "日料"))
    R3 = dice.rules([{"item": "鸡", "kind": "love"}], want="川菜")
    check("骰子：爱吃的、想吃的更容易丢中", dice.judge(dice.menu()[0], R3)[0] == 60)
    R4 = dice.rules([{"item": "丸子这类半成品", "kind": "never"}, {"item": "鸡鸭鱼蛙这类白肉", "kind": "love"}])
    check("骰子：认「这类」前面那几个字", dice.judge({"name": "四喜丸子", "cuisine": "鲁菜", "kind": "菜", "tags": ["猪肉"]}, R4) is None
          and dice.judge(dice.menu()[3], R4)[0] == 3 and dice.judge(dice.menu()[0], R4)[0] == 3)
    d0 = b.all()
    d0["taste"] = taste
    r = dice.roll(d0, "dish", rng=random.Random(1))
    check("骰子：丢一道", r["ok"] and r["name"] and r["removed"] >= 5, r)
    w = dice.roll(d0, "way", rng=random.Random(2))
    check("骰子：丢一个方向", w["cuisine"] in dice.CUISINES and w["examples"], w)
    o = dice.roll(d0, "dish", only="日料", rng=random.Random(3))
    check("骰子：只在一个菜系里丢", o.get("empty") or o["cuisine"] == "日料", o)
    d0["taste"] = [{"item": "中国菜", "kind": "hate"}, {"item": "外国菜", "kind": "hate"}]
    check("骰子：剔光了说人话", dice.roll(d0)["empty"] and "一道都不剩" in dice.text(dice.roll(d0)))
    dice.MENU_FILE, dice._MENU = ROOT / "dishes.txt", None
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print("全过" if ok else "有没过的")
sys.exit(0 if ok else 1)
