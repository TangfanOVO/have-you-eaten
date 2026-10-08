#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""吃了吗 · have-you-eaten —— 给你的 AI 的四只手（MCP，stdio）。只用标准库，Python 3.9+。

  food_note   Ta 说吃了什么 → 当场记一笔（可以不打分）
  food_taste  不记日期的口味单：爱吃 / 不爱吃 / 不能吃
  food_book   推荐吃的之前先翻：今天吃了没、上一顿多久以前、口味单、常吃、踩过的雷
  food_dice   这顿吃什么：照口味单丢一次骰子（不能吃的、不爱吃的先剔掉）

起来的时候顺手在 http://127.0.0.1:8770 开一页「吃过的」给人用（端口被占就不开，手照样能用）。
"""
import json
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402

TOOLS = [
    {
        "name": "food_note",
        "description": (
            "把 Ta（跟你说话的那个人）吃的一顿记进「吃了吗」本子。Ta 说吃了什么——外卖、出去吃、自己煮的、随手垫的都算——就用它当场记，"
            "记完短短说一句就行。好吃难吃 Ta 没说就别替 Ta 打分。从店里来的写 shop＋city（城市必填，不同城市的雷分开放）；"
            "不是店里的写 place（家里、学校、朋友家）。slot 不知道就别填（按现在几点猜）。店名、菜名照 Ta 的原话抄；"
            "Ta 对这顿的评价、吐槽放 note（原话）；只是让你「记一下」没评价，就不写 note。先记了、吃完才说好不好吃，用 food_rate 改，别再记一顿。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "dishes": {"type": "array", "description": "吃了什么，一道一项", "items": {"type": "object", "properties": {
                    "name": {"type": "string", "description": "菜名，照 Ta 说的"},
                    "verdict": {"type": "string", "enum": ["好吃", "一般", "踩雷"], "description": "Ta 说了才填"},
                    "price": {"type": "number"},
                    "note": {"type": "string", "description": "Ta 对这道菜的原话"}}, "required": ["name"]}},
                "shop": {"type": "string", "description": "店名（从店里来的才写），照 Ta 说的原名"},
                "cuisine": {"type": "string", "description": "菜系，知道才写"},
                "city": {"type": "string", "description": "哪座城市。不写＝页面上设的那座"},
                "area": {"type": "string", "description": "哪个区 / 哪家分店，知道才写"},
                "platform": {"type": "string", "description": "外卖平台，知道才写"},
                "how": {"type": "string", "enum": ["外卖", "堂食", "自取"], "description": "从店里来的才写"},
                "place": {"type": "string", "description": "不是店里的：在哪吃（家里、学校、朋友家…）"},
                "slot": {"type": "string", "enum": ["早饭", "午饭", "晚饭", "夜宵", "纯记录"],
                         "description": "不写就按一个钟头以前猜。纯记录＝不算哪一顿，Ta 想起来随手记的（「那家的 XX 好吃」）"},
                "date": {"type": "string", "description": "YYYY-MM-DD，不写＝今天"},
                "verdict": {"type": "string", "enum": ["好吃", "一般", "踩雷"], "description": "这一顿整体，Ta 说了才填"},
                "total": {"type": "number", "description": "这顿一共多少钱"},
                "currency": {"type": "string", "enum": ["CNY", "AUD", "USD", "JPY", "GBP", "EUR"], "description": "不写：按城市猜"},
                "note": {"type": "string", "description": "Ta 对这一顿的评价、吐槽（原话）；没评价就不写"}},
            "required": []},
    },
    {
        "name": "food_taste",
        "description": (
            "「吃了吗」里那张不记日期的口味单：爱吃 / 不爱吃 / 不能吃（过敏、忌口）。Ta 说「我最爱 XX」「我不吃 XX」「XX 我过敏」这种不挂哪一顿的话，"
            "就用它记；一句里说了好几样就放 items 一次记。癖好、搭配用 scope：「炒菜里不要姜葱蒜」＝不爱吃 · 姜葱蒜 · scope 炒菜；"
            "「面要加麻油」＝爱吃 · 麻油 · scope 面；scope 空＝什么菜都算。爱吃但 Ta 现在吃不到的，away=true。"
            "同一样又配同一类菜再记＝挪档。kind=拿掉 是从单子上删掉。item 照 Ta 的原话抄，备注放 note。记完短短说一句。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "哪一样吃的，照 Ta 说的"},
                "items": {"type": "array", "items": {"type": "string"}, "description": "一句里说了好几样：一次记一串（同一档、同一个 scope）"},
                "kind": {"type": "string", "enum": ["爱吃", "不爱吃", "不能吃", "拿掉"]},
                "scope": {"type": "string", "description": "配哪类菜（炒菜、面…）；不写＝什么菜都算"},
                "away": {"type": "boolean", "description": "爱吃但现在吃不到"},
                "note": {"type": "string", "description": "一句备注（过敏、只吃红汤…），没有就不写"}},
            "required": ["kind"]},
    },
    {
        "name": "food_book",
        "description": (
            "翻「吃了吗」本子。最上面是：今天吃了没、上一顿离现在多久、口味单 —— Ta 一天没吃东西、或者问你吃什么好的时候先翻，"
            "推荐吃的、帮 Ta 点外卖、Ta 问「我最近吃了啥」「那家我吃过吗」之前也先翻，别凭印象说店名。不写 city 就按页面上设的那座城。"
            "view：recent 这几天吃了啥 · often 常吃的 · bad 拉黑的店和踩过的雷 · shop 查一家店（配 q）· 不写＝三样各给一点。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "view": {"type": "string", "enum": ["recent", "often", "bad", "shop"]},
                "city": {"type": "string", "description": "哪座城市；写「全部」看所有城市"},
                "q": {"type": "string", "description": "view=shop 时：店名里的几个字"},
                "days": {"type": "integer", "description": "view=recent 时往回翻几天，默认 7"}},
            "required": []},
    },
    {
        "name": "food_dice",
        "description": (
            "「这顿吃什么」的骰子：Ta 纠结吃什么、让你帮着挑、说「你丢一个」的时候用。照口味单先剔（不能吃的整道剔、不爱吃的主料剔、"
            "写了菜系的整个菜系剔），再随机丢。mode=way 只丢一个方向（川菜、日料…），dish 丢一道具体的菜。"
            "Ta 说今天特别想吃什么（鸡、面、川菜…）就放进 want，会往那边偏。丢完把结果和提醒（备注不要葱这种）原样说给 Ta，别自己另编一道。"
            "Ta 说这次不想吃什么（太油、不想吃辣、今天不要鸡…）：照常丢，丢到了你自己看，沾边就再丢一次，别写进口味单（口味单是长期的）。口味单里写着骰子认不出的（「油腻的」这种），也这样替 Ta 看一眼。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["dish", "way"], "description": "dish 一道菜（默认）；way 一个方向"},
                "kind": {"type": "string", "enum": ["饭", "面粉", "菜", "汤粥", "小吃", "锅"], "description": "只在这一类里丢，Ta 说了才写"},
                "want": {"type": "string", "description": "Ta 今天特别想吃的：一样东西（鸡、牛蛙）或一个菜系（川菜）"}},
            "required": []},
    },
    {
        "name": "food_rate",
        "description": (
            "改评价：已经记好的一顿，Ta 吃完才说好不好吃（「酸豆角好吃」「米饭有点硬」），或者想改之前的评价，就用它改到那一顿上，别再记一顿。"
            "默认改最近那一顿里叫这个名字的菜；说了哪天、哪家就写 date、shop。dish 不写＝改这一顿整体。"
            "同一道菜以前好吃过、这次踩雷（或反过来），回执里会写「时好时坏」和日子 —— 原样告诉 Ta，以后推荐这道也先提醒。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "dish": {"type": "string", "description": "哪道菜，照 Ta 说的；不写＝这一顿整体"},
                "verdict": {"type": "string", "enum": ["好吃", "一般", "踩雷"]},
                "note": {"type": "string", "description": "Ta 说的那句（原话），没有就不写"},
                "shop": {"type": "string", "description": "哪家，Ta 说了才写"},
                "date": {"type": "string", "description": "YYYY-MM-DD，Ta 说了是哪天才写；不写＝最近那一顿"}},
            "required": []},
    },
    {
        "name": "food_page",
        "description": "Ta 想看本子、问「在哪看」「给我链接」的时候，把「吃了吗」页面的地址给 Ta。在页面上能记、改、删。地址只发给 Ta 本人。",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
]


def call(book, name, a):
    """四只手。返回给 AI 看的一段纯文字。网页的 /food/ai 也走这儿。"""
    a = a or {}
    if name == "food_note":
        dishes = [{"name": str(d.get("name")).strip(), "verdict": core.VIN.get(d.get("verdict") or ""), "price": d.get("price"), "note": d.get("note")}
                  for d in (a.get("dishes") or []) if isinstance(d, dict) and str(d.get("name") or "").strip()]
        shop = (a.get("shop") or "").strip()
        body = {"meal": {"eaten_on": a.get("date"), "slot": a.get("slot") or "auto", "src": "chat",
                         "how": a.get("how") if shop else None, "place": None if shop else a.get("place"),
                         "city": a.get("city"), "total": a.get("total"), "currency": a.get("currency"),
                         "verdict": a.get("verdict") if shop else None, "note": a.get("note")},
                "dishes": dishes}
        if shop:
            body["shop"] = {"name": shop, "cuisine": a.get("cuisine")}
            body["branch"] = {"city": a.get("city") or book.setting("city"), "area": a.get("area") or "", "platform": a.get("platform")}
        r = book.log(body)
        what = "、".join(d["name"] + (f"（{core.V[d['verdict']]}）" if d["verdict"] else "") for d in dishes) or (a.get("note") or "")
        return f"记下了：{shop or a.get('place') or '没写在哪'} · {what}。Ta 在「吃了吗」页面上看得到。"
    if name == "food_taste":
        items = [str(x).strip() for x in (a.get("items") or []) if str(x).strip()]
        if str(a.get("item") or "").strip():
            items.insert(0, str(a.get("item")).strip())
        if not items:
            return "（没写是哪一样）"
        scope = str(a.get("scope") or "").strip()
        if a.get("kind") in ("拿掉", "删", "delete"):
            have, said = book.all()["taste"], []
            for item in items:
                hit = [t for t in have if t["item"].strip().lower() == item.lower() and (t.get("scope") or "").strip().lower() == scope.lower()]
                if hit:
                    book.delete("taste", hit[0]["id"])
                said.append(f"拿掉了「{core.tname(hit[0])}」" if hit else f"单子上本来就没有「{item}」")
            return "；".join(said) + "。"
        said = []
        for item in items:
            r = book.taste(item, a.get("kind"), a.get("note"), src="chat", scope=scope, away=a.get("away"))
            kind = core.TKIN[a.get("kind")]
            nm = core.tname({"item": item, "scope": scope, "kind": kind})
            said.append(f"「{nm}」挪到{core.TK[kind]}" if r.get("moved") else f"{core.TK[kind]} · {nm}" + ("（现在吃不到）" if a.get("away") else ""))
        return "记上了：" + "；".join(said) + "。"
    if name == "food_dice":
        import dice
        return dice.text(dice.roll(book.all(), a.get("mode") or "dish", a.get("kind") or "", a.get("want") or ""))
    if name == "food_book":
        return book.book_text(a.get("view") or "", a.get("city") or "", a.get("q") or "", a.get("days") or 7)
    if name == "food_rate":
        r = book.rate(a.get("dish") or "", a.get("verdict"), a.get("note"), a.get("shop") or "", a.get("date") or "")
        m = r["meal"]
        said = core.V.get(core.VIN.get(a.get("verdict") or "", ""), "") or "那一句记上了"
        return (f"改好了：{m['eaten_on'][5:]} {m['slot'] or ''} {r['name'] or '这一顿整体'} → {said}。"
                + (f" 这道{r['wave']}，以后推荐它先提醒 Ta。" if r["wave"] else ""))
    if name == "food_page":
        import web
        return f"本子在 http://127.0.0.1:{web.PORT} （Ta 自己电脑上，Claude 桌面 App 开着就能打开；能记、改、删）。"
    return "（没有这只手）"


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def serve_page(book):
    """顺手开网页。端口被占（比如另开了 run.command）就算了，不影响手。"""
    if os.environ.get("HAVE_YOU_EATEN_NO_WEB") == "1":
        return
    try:
        import web
        srv = web.make_server(book)
    except OSError:
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def main():
    book = core.Book()
    serve_page(book)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except ValueError:
            continue
        rid, m = req.get("id"), req.get("method")
        if m == "initialize":
            send({"jsonrpc": "2.0", "id": rid, "result": {
                "protocolVersion": (req.get("params") or {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "have-you-eaten", "version": "0.2.1"}}})
        elif m == "tools/list":
            send({"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}})
        elif m == "tools/call":
            p = req.get("params") or {}
            try:
                text = call(book, p.get("name", ""), p.get("arguments") or {})
            except core.Bad as e:
                text = "（没记上：" + str(e) + "）"
            except Exception as e:  # 别让一只手卡死整个连接
                text = "（本子没翻开：" + str(e)[:200] + "）"
            send({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": text}]}})
        elif rid is not None:
            send({"jsonrpc": "2.0", "id": rid, "result": {}})


if __name__ == "__main__":
    main()
