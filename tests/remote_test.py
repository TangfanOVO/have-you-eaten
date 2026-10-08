#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""远程版的测试：临时数据目录里起一个 remote.py（端口在 8780–8789 里挑空的），
MCP 握手、四只手、暗号、网页、导出 → 导进新的一本，各走一遍，跑完删掉。
    python3 tests/remote_test.py
"""
import json
import os
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="hye-remote-test-"))
A, B, C = TMP / "a", TMP / "b", TMP / "c"
for d in (A, B, C):
    d.mkdir()
os.environ["HAVE_YOU_EATEN_DATA"] = str(A)          # 这个进程里 import core 也只碰临时目录
os.environ.pop("HAVE_YOU_EATEN_TOKEN", None)
sys.path.insert(0, str(ROOT))
import core  # noqa: E402

ok = True


def check(name, cond, extra=""):
    global ok
    print(("  ok  " if cond else "  ✗✗  ") + name + (f"  {extra}" if extra != "" else ""))
    ok = ok and bool(cond)


def env_for(d):
    e = {**os.environ, "HAVE_YOU_EATEN_DATA": str(d)}
    e.pop("HAVE_YOU_EATEN_TOKEN", None)
    return e


def free_port():
    for p in range(8780, 8790):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    raise SystemExit("8780–8789 都被占了")


def porter(*args, data):
    return subprocess.run([sys.executable, str(ROOT / "porter.py"), *args], capture_output=True, text=True, timeout=30, env=env_for(data))


proc = None
try:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    out_f, err_f = open(TMP / "out.txt", "w+"), open(TMP / "err.txt", "w+")
    proc = subprocess.Popen([sys.executable, str(ROOT / "remote.py"), "--port", str(port), "--web"],
                            stdout=out_f, stderr=err_f, env=env_for(A))
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            if proc.poll() is not None:
                break
            time.sleep(0.1)
    check("起来了", proc.poll() is None, open(TMP / "err.txt").read()[-300:])
    tf = A / "remote-token"
    TOKEN = tf.read_text().strip()
    check("没给暗号：自动生成、存进数据目录", len(TOKEN) >= 40 and (os.name != "posix" or stat.S_IMODE(tf.stat().st_mode) == 0o600))
    time.sleep(0.2)
    check("打出完整的连接器网址", f"{base}/mcp/{TOKEN}" in open(TMP / "out.txt").read())
    import remote  # noqa: E402
    check("再起来用的还是同一个暗号", remote.load_token() == (TOKEN, False))

    def http(method, path, body=None, headers=None, raw=None):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
        rq = urllib.request.Request(base + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(rq, timeout=10) as r:
                return r.status, r.read().decode(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), e.headers

    MCP = f"/mcp/{TOKEN}"
    n = [0]

    def rpc(method, params=None, path=MCP, headers=None):
        n[0] += 1
        st, body, h = http("POST", path, {"jsonrpc": "2.0", "id": n[0], "method": method, **({"params": params} if params is not None else {})}, headers)
        return st, (json.loads(body) if body else None), h

    def tool(name, args):
        st, j, _ = rpc("tools/call", {"name": name, "arguments": args})
        return j["result"]["content"][0]["text"] if st == 200 and "result" in j else f"<{st} {j}>"

    # ── MCP 握手
    st, j, h = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}})
    check("握手", st == 200 and j["result"]["serverInfo"]["name"] == "have-you-eaten" and "tools" in j["result"]["capabilities"], j)
    check("握手：照客户端的版本回", j["result"]["protocolVersion"] == "2025-06-18")
    check("回的是 application/json", (h.get("Content-Type") or "").startswith("application/json"))
    check("握手：老版本也照回", rpc("initialize", {"protocolVersion": "2025-03-26"})[1]["result"]["protocolVersion"] == "2025-03-26")
    st, body, _ = http("POST", MCP, {"jsonrpc": "2.0", "method": "notifications/initialized"})
    check("通知：202、不回话", st == 202 and body == "", (st, body))
    st, j, _ = rpc("tools/list")
    check("六只手", [t["name"] for t in j["result"]["tools"]] == ["food_note", "food_taste", "food_book", "food_dice", "food_rate", "food_page"])
    pg = tool("food_page", {})
    check("给我本子链接：远程地址带暗号（开了 --web）", "/u/" + TOKEN + "/" in pg, pg)
    check("ping", rpc("ping")[1]["result"] == {})
    check("没有的方法：-32601", rpc("no/such")[1]["error"]["code"] == -32601)
    check("没有的手：-32602", rpc("tools/call", {"name": "food_fly", "arguments": {}})[1]["error"]["code"] == -32602)
    check("问资源、提示词：空的", rpc("resources/list")[1]["result"] == {"resources": []} and rpc("prompts/list")[1]["result"] == {"prompts": []})
    st, body, _ = http("POST", MCP, [{"jsonrpc": "2.0", "id": "a", "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                                     {"jsonrpc": "2.0", "id": "b", "method": "tools/list"}])
    check("一次一串：只回有 id 的", st == 200 and [x["id"] for x in json.loads(body)] == ["a", "b"], body[:120])
    check("一串全是通知：202", http("POST", MCP, [{"jsonrpc": "2.0", "method": "notifications/initialized"}])[0] == 202)
    st, body, _ = http("POST", MCP, raw=b"{not json")
    check("看不懂的：400 / -32700", st == 400 and json.loads(body)["error"]["code"] == -32700)
    st, _, h = http("GET", MCP)
    check("GET：405（不开推送流）", st == 405 and h.get("Allow") == "POST")
    check("DELETE：405", http("DELETE", MCP)[0] == 405)

    # ── 四只手，从头到尾
    t = tool("food_note", {"shop": "川味小馆", "city": "重庆", "area": "解放碑", "how": "外卖", "total": 32,
                           "dishes": [{"name": "辣子鸡", "verdict": "踩雷", "note": "裹粉油炸"}, {"name": "空心菜", "verdict": "好吃"}]})
    check("food_note：记一顿带踩雷", "记下了" in t and "辣子鸡（踩雷）" in t, t)
    t = tool("food_taste", {"item": "香菜", "kind": "不爱吃"})
    check("food_taste：口味单记一样", "不爱吃 · 香菜" in t, t)
    t = tool("food_taste", {"items": ["咖啡"], "kind": "不能吃", "note": "过敏"})
    check("food_taste：一次一串", "不能吃 · 咖啡" in t, t)
    t = tool("food_dice", {})
    check("food_dice：丢一道", t.startswith("丢到：") and "剔掉了" in t, t)
    t = tool("food_dice", {"mode": "way", "want": "川菜"})
    check("food_dice：丢一个方向", t.startswith("丢到：") and "往「川菜」上偏了" in t, t)
    t = tool("food_book", {})
    check("food_book：看得到踩的雷", "踩雷：辣子鸡" in t, t)
    check("food_book：看得到口味单", "不爱吃：香菜" in t and "不能吃：咖啡（过敏）" in t, t)
    check("food_book：今天吃了没", "今天记了 1 顿" in t, t.splitlines()[1] if len(t.splitlines()) > 1 else t)
    t = tool("food_note", {})
    check("什么都没写：说人话、不崩", "没记上" in t, t)

    # ── 暗号
    check("Bearer 也认", rpc("ping", path="/mcp", headers={"Authorization": f"Bearer {TOKEN}"})[0] == 200)
    check("Bearer 不对：401", rpc("ping", path="/mcp", headers={"Authorization": "Bearer nope-nope-nope-nope"})[0] == 401)
    check("没暗号：401", rpc("ping", path="/mcp")[0] == 401)
    wrong = TOKEN[:-1] + ("x" if TOKEN[-1] != "x" else "y")
    st, body, _ = http("POST", f"/mcp/{wrong}", {"jsonrpc": "2.0", "id": 1, "method": "ping"})
    check("暗号错一位：404，一个字不说", st == 404 and body == "", (st, body))
    check("暗号短一截：404", http("POST", f"/mcp/{TOKEN[:20]}", {"jsonrpc": "2.0", "id": 1, "method": "ping"})[0] == 404)
    check("导出也要暗号", http("GET", f"/mcp/{wrong}/export")[0] == 404 and http("GET", "/mcp/export")[0] == 401)
    check("根上没饼干：404", http("GET", "/")[0] == 404 and http("GET", "/api/food")[0] == 404)
    check("网页暗号不对：404", http("GET", f"/u/{wrong}/")[0] == 404)
    r = subprocess.run([sys.executable, str(ROOT / "remote.py"), "--token", "abc", "--port", str(port)],
                       capture_output=True, text=True, timeout=20, env=env_for(C))
    check("太短的暗号不让起", r.returncode != 0 and "16" in r.stderr, r.stderr[-120:])

    # ── 网页（--web）
    st, body, h = http("GET", f"/u/{TOKEN}/")
    sc = h.get("Set-Cookie") or ""
    check("网页：进门", st == 200 and "吃了吗" in body)
    check("网页：发饼干（HttpOnly、SameSite、不是暗号本身）", sc.startswith("hye_web=") and "HttpOnly" in sc and "SameSite=Lax" in sc and TOKEN not in sc, sc)
    check("网页：不带 Referer 出去", h.get("Referrer-Policy") == "no-referrer")
    ck = {"Cookie": sc.split(";")[0]}
    check("网页：根上 app.js 认饼干", http("GET", "/app.js", headers=ck)[0] == 200)
    st, body, _ = http("GET", "/api/food", headers=ck)
    check("网页：整本看得到 AI 记的那顿", st == 200 and any(s["name"] == "川味小馆" for s in json.loads(body)["shops"]))
    check("网页：饼干不对 404", http("GET", "/api/food", headers={"Cookie": "hye_web=nope"})[0] == 404)
    st, body, _ = http("POST", "/api/food/taste", {"item": "火锅", "kind": "爱吃"}, {**ck, "Origin": base})
    check("网页：本站来写", st == 200 and json.loads(body)["ok"], body)
    check("网页：别的网站来写 403", http("POST", "/api/food/taste", {"item": "x", "kind": "爱吃"}, {**ck, "Origin": "https://evil.example"})[0] == 403)
    st, body, _ = http("POST", f"/u/{TOKEN}/api/food/log", {"meal": {"place": "家里"}, "dishes": [{"name": "番茄炒蛋", "verdict": "好吃"}]})
    check("网页接口：暗号路径直接写", st == 200 and json.loads(body)["ok"], body)
    check("网页接口：/food/context", "吃了吗" in http("GET", f"/u/{TOKEN}/food/context")[1])
    check("网页接口：乱写 400", http("POST", f"/u/{TOKEN}/api/food/taste", {"item": "x", "kind": "yum"})[0] == 400)

    # ── 导出 → 导进新的一本
    st, body, h = http("GET", f"{MCP}/export")
    ex = json.loads(body)
    check("导出：200、带文件名", st == 200 and "attachment" in (h.get("Content-Disposition") or ""))
    check("导出：最外层就是约好的那几样、那个顺序", list(ex) == ["format", "version", "exported_at", "settings", "shops", "branches", "meals", "dishes", "logs", "taste"], list(ex))
    check("导出：format / version", ex["format"] == "have-you-eaten" and ex["version"] == 1 and ex["exported_at"].endswith("Z"))
    mem = sqlite3.connect(":memory:")
    mem.executescript(core.SCHEMA)
    want = {k: [r[1] for r in mem.execute(f"PRAGMA table_info({t})")] for k, t in
            (("shops", "shop"), ("branches", "branch"), ("meals", "meal"), ("dishes", "dish"), ("logs", "dish_log"), ("taste", "taste"))}
    check("导出：每一行的栏目跟 SCHEMA 一模一样", all(ex[k] and all(list(r) == want[k] for r in ex[k]) for k in want),
          {k: (list(ex[k][0]) if ex[k] else None) for k in want})
    check("导出：设置也在", ex["settings"].get("city") == "重庆")
    check("导出：网页和手写的都在", {"辣子鸡", "空心菜", "番茄炒蛋"} <= {r["name"] for r in ex["dishes"]} | {r["name"] for r in ex["logs"] if r["name"]}
          and {"香菜", "咖啡", "火锅"} <= {r["item"] for r in ex["taste"]})
    check("导出：Bearer 也行", http("GET", "/mcp/export", headers={"Authorization": f"Bearer {TOKEN}"})[0] == 200)
    f = TMP / "export.json"
    f.write_text(body, encoding="utf-8")
    r = porter("export", str(TMP / "cli.json"), data=A)
    cli = json.loads((TMP / "cli.json").read_text(encoding="utf-8"))
    check("命令行导出跟网址导出一样", r.returncode == 0 and {k: v for k, v in cli.items() if k != "exported_at"} == {k: v for k, v in ex.items() if k != "exported_at"}, r.stderr)

    r = porter("import", str(f), data=B)
    check("导进空的一本", r.returncode == 0 and "导进来了" in r.stdout, r.stderr or r.stdout)
    a_all, b_all = core.Book(A / "food.db").all(), core.Book(B / "food.db").all()
    check("导完：all() 一模一样", a_all == b_all and len(a_all["meals"]) == 2,
          [k for k in a_all if a_all[k] != b_all.get(k)])
    r = porter("import", str(f), data=B)
    check("有东西了：不加 --force 不导", r.returncode != 0 and "--force" in r.stderr, r.stderr)
    r = porter("import", str(f), "--force", data=B)
    check("--force：先备份再换", r.returncode == 0 and list(B.glob("food.db.bak-before-import-*")), r.stderr or r.stdout)
    check("--force 以后还是一模一样", core.Book(B / "food.db").all() == a_all)
    bad = TMP / "bad.json"
    bad.write_text(json.dumps({"format": "something-else", "version": 1}), encoding="utf-8")
    r = porter("import", str(bad), data=C)
    check("别的文件：不导", r.returncode != 0 and core.Book(C / "food.db").all()["meals"] == [], r.stderr)
    half = dict(ex, logs=ex["logs"] + [{"id": 999, "meal_id": 12345, "dish_id": None, "name": "对不上", "verdict": None, "price": None, "note": None, "created_at": "2026-01-01 00:00:00"}])
    (TMP / "half.json").write_text(json.dumps(half, ensure_ascii=False), encoding="utf-8")
    r = porter("import", str(TMP / "half.json"), data=C)
    check("导到一半对不上：整笔退回", r.returncode != 0 and core.Book(C / "food.db").all()["shops"] == [], r.stderr)
    newer = dict(ex, version=2)
    (TMP / "v2.json").write_text(json.dumps(newer, ensure_ascii=False), encoding="utf-8")
    r = porter("import", str(TMP / "v2.json"), data=C)
    check("新版本的文件：先更新再导", r.returncode != 0 and "version 2" in r.stderr, r.stderr)

    # ── 日志里没有暗号
    time.sleep(0.2)
    log = open(TMP / "err.txt").read()
    check("日志里暗号打成 ***", TOKEN not in log and "/mcp/***" in log, log[-200:])
finally:
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    shutil.rmtree(TMP, ignore_errors=True)

print("全过" if ok else "有没过的")
sys.exit(0 if ok else 1)
