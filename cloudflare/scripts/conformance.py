#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对照：让上一层的 Python 那份（core.py / dice.py / mcp_server.py）照着 test/fixtures/scenario.json 走一遍，
把每一步的结果写进 test/fixtures/expected.json。TS 那份（test/conformance.test.ts）照同一张单子走，结果要一模一样。

    python3 scripts/conformance.py            # 写 expected.json
    python3 scripts/conformance.py --check    # 只对一下 expected.json 是不是最新的（不写）
    python3 scripts/conformance.py --dump 3   # 把第 3 个骰子用例剔完剩下的每一道都打出来（对不上的时候查）

只读上一层的代码；本子开在一个临时文件夹里，跑完删掉。不碰 ~/.have-you-eaten。
时间钉死在 scenario.json 写的那一刻（Python 的 datetime.now() 换成假的），骰子塞同一串随机数。
"""
import datetime as _dt
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import types
from pathlib import Path

sys.dont_write_bytecode = True          # 别往上一层写 __pycache__
HERE = Path(__file__).resolve().parent.parent
UP = HERE.parent
if not (UP / "core.py").is_file():
    sys.exit("✗ 上一层没有 core.py —— 要在 have-you-eaten 仓库里跑")
TMP = tempfile.mkdtemp(prefix="hye-conformance-")
os.environ["HAVE_YOU_EATEN_DATA"] = TMP          # 万一哪里要 data_dir()，也落在临时文件夹
os.environ["HAVE_YOU_EATEN_NO_WEB"] = "1"
sys.path.insert(0, str(UP))

import core  # noqa: E402
import dice  # noqa: E402
import mcp_server  # noqa: E402

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python 3.8
    sys.exit("✗ 要 Python 3.9 以上（zoneinfo）")


# ── 钉死时间
class Frozen:
    utc = None
    tz = None


class FakeDT(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return Frozen.utc.astimezone(ZoneInfo(Frozen.tz)).replace(tzinfo=None)
        return Frozen.utc.astimezone(tz)


core.dt = types.SimpleNamespace(datetime=FakeDT, date=_dt.date, timedelta=_dt.timedelta, timezone=_dt.timezone)


def set_clock(now_utc, tz):
    Frozen.utc = _dt.datetime.fromisoformat(now_utc.replace("Z", "+00:00"))
    Frozen.tz = tz


# ── 塞一串随机数
class Scripted:
    """random.Random 的 choices 只用到 self.random()；这里一次吐一个，吐完从头再来"""

    def __init__(self, seq):
        import random
        self._r = random.Random()
        self._seq, self._i = list(seq) or [0.5], 0
        self._r.random = self.random

    def random(self):
        v = self._seq[self._i % len(self._seq)]
        self._i += 1
        return v

    def choices(self, *a, **k):
        return self._r.choices(*a, **k)


_real_random = dice.random


def use_rng(seq):
    dice.random = types.SimpleNamespace(Random=lambda: Scripted(seq))


# ── 小工具
TS_COLS = ("created_at", "updated_at")
TABLES = [("shops", "shop"), ("branches", "branch"), ("meals", "meal"), ("dishes", "dish"), ("logs", "dish_log"), ("taste", "taste")]


def conn(book):
    c = sqlite3.connect(book.path)
    c.row_factory = sqlite3.Row
    return c


def resolve_id(book, v):
    if isinstance(v, dict) and "sql" in v:
        c = conn(book)
        try:
            r = c.execute(v["sql"]).fetchone()
            return r[0] if r else None
        finally:
            c.close()
    return v


def cols_of(c, t):
    return [r["name"] for r in c.execute(f"PRAGMA table_info({t})")]


def state(book):
    c = conn(book)
    try:
        out = {}
        for key, t in TABLES:
            cols = [x for x in cols_of(c, t) if x not in TS_COLS]
            out[key] = [dict(r) for r in c.execute(f"SELECT {','.join(cols)} FROM {t} ORDER BY id")]
        out["settings"] = {r["k"]: r["v"] for r in c.execute("SELECT k, v FROM setting ORDER BY k")}
        return out
    finally:
        c.close()


def export(book):
    """约好的导出格式（不含 exported_at）：每一行＝那张表的全部列"""
    c = conn(book)
    try:
        out = {"format": "have-you-eaten", "version": 1,
               "settings": {r["k"]: r["v"] for r in c.execute("SELECT k, v FROM setting ORDER BY k")}}
        for key, t in TABLES:
            out[key] = [dict(r) for r in c.execute(f"SELECT {','.join(cols_of(c, t))} FROM {t} ORDER BY id")]
        return out
    finally:
        c.close()


def schema_info(path):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    try:
        out = {}
        for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            out[name] = {
                "columns": [[r["name"], r["type"], r["notnull"], r["dflt_value"], r["pk"]] for r in c.execute(f"PRAGMA table_info({name})")],
                "fks": sorted([[r["from"], r["table"], r["to"], r["on_delete"]] for r in c.execute(f"PRAGMA foreign_key_list({name})")]),
            }
        out["_sql"] = sorted([r[0], r[1]] for r in c.execute("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL"))
        return out
    finally:
        c.close()


def run(fn):
    try:
        return {"ok": fn()}
    except core.Bad as e:
        return {"bad": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


PAGE = None   # food_page 回的本子地址（scenario.json 的 page）


def tool_text(book, name, args):
    """跟 mcp_server.main() 包的那一层一样：出错也回一段话。
    food_page 照 remote.py 的回法（Worker 跟远程版一样，本子页在自己身上）"""
    if name == "food_page":
        import remote
        return remote.tool_text(book, name, args, PAGE)
    try:
        return mcp_server.call(book, name, args)
    except core.Bad as e:
        return "（没记上：" + str(e) + "）"
    except Exception:  # noqa: BLE001
        return "（本子没翻开：…）"


def fmt_w(w):
    return str(int(w)) if float(w).is_integer() else repr(float(w))


def kept_lines(keep):
    out = []
    for x, w, notes in keep:
        hist = dice._hist_line(x["hist"]) if x.get("hist") else ""
        out.append("|".join([x["name"], x["cuisine"], x["kind"], fmt_w(w), "/".join(notes), hist, "mine" if x.get("mine") else ""]))
    return out


def sha(lines):
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def dice_case(d0, case):
    d = dict(d0)
    if case.get("taste") is not None:
        d["taste"] = case["taste"]
    kind, want, only, mode = case.get("kind", ""), case.get("want", ""), (case.get("only", "") or "").strip(), case.get("mode", "dish")
    R = dice.rules(d.get("taste"), want)
    keep, removed, removed_names = [], 0, []
    for x in dice.pool(d, kind):
        if only and x["cuisine"] != only:
            continue
        r = dice.judge(x, R)
        if r is None:
            removed += 1
            removed_names.append(x["name"])
            continue
        keep.append((x, r[0], r[1]))
    lines = kept_lines(keep)
    special = [ln for ln, (x, w, notes) in zip(lines, keep) if w != 1 or notes or x.get("hist") or x.get("mine")]
    by = {}
    for x, w, notes in keep:
        by.setdefault(x["cuisine"], []).append(x)
    ways = [[c, fmt_w((3 if c in R["love_cuis"] else 1) * (20 if c in R["want_cuis"] else 1) * (1 + 0.15 * min(len(v), 10))), len(v)] for c, v in by.items()]
    r = dice.roll(d, mode, kind, want, rng=Scripted(case.get("rng") or [0.5]), only=case.get("only", ""))
    return {"label": case["label"], "count": len(keep), "removed": removed, "kept_sha": sha(lines), "removed_sha": sha(removed_names),
            "special": special, "ways": ways, "roll": r, "text": dice.text(r)}


def main():
    global PAGE
    sc = json.loads((HERE / "test" / "fixtures" / "scenario.json").read_text(encoding="utf-8"))
    PAGE = sc["page"]
    set_clock(sc["clock"]["now_utc"], sc["clock"]["tz"])
    book = core.Book(Path(TMP) / "food.db")
    results = []
    for i, op in enumerate(sc["ops"]):
        k = op["op"]
        if k == "setting":
            res = run(lambda: book.set_setting(op["k"], op["v"]))
        elif k == "log":
            res = run(lambda: book.log(op["body"]))
        elif k == "taste":
            a = op["args"]
            res = run(lambda: book.taste(a.get("item"), a.get("kind"), a.get("note"), a.get("src", "page"), a.get("scope", ""), a.get("away")))
        elif k == "edit":
            res = run(lambda: book.edit(op["kind"], resolve_id(book, op["id"]), op["fields"]))
        elif k == "delete":
            res = run(lambda: book.delete(op["kind"], resolve_id(book, op["id"])))
        elif k == "addlog":
            res = run(lambda: book.addlog(op["meal_id"], op["dish"]))
        elif k == "tool":
            use_rng(op.get("rng") or [0.5])
            res = {"text": tool_text(book, op["name"], op.get("args") or {})}
            dice.random = _real_random
        elif k == "normalize_ts":
            c = sqlite3.connect(book.path)
            for s in sc["normalize_ts"]:
                c.execute(s)
            c.commit()
            c.close()
            res = {"ok": None}
        elif k == "clock":
            set_clock(op["now_utc"], op["tz"])
            res = {"ok": None}
        elif k == "book":
            a = op["args"]
            res = run(lambda: book.book_text(a.get("view", ""), a.get("city", ""), a.get("q", ""), a.get("days", 7)))
        elif k == "context":
            res = run(book.context_text)
        elif k == "all":
            res = run(book.all)
        elif k == "state":
            res = {"ok": state(book)}
        elif k == "export":
            res = {"ok": export(book)}
        else:
            raise SystemExit(f"不认得的一步：{k}")
        results.append({"i": i, "op": k, **res})

    d0 = book.all()
    cases = [dice_case(d0, c) for c in sc["dice"]]

    # 上一层要是有 porter.py（Python 那边的搬家），它导出来的跟约好的格式（也就是 TS 那份导出的）得一模一样；
    # 再把它导回一本空本子，导出来还是同一份
    porter_same = None
    if (UP / "porter.py").is_file():
        import porter
        mine = export(book)
        theirs = porter.dump(book)
        theirs.pop("exported_at", None)
        if theirs != mine or list(theirs) != list(mine) or any(
                list(a[0]) != list(b[0]) for k in ("shops", "branches", "meals", "dishes", "logs", "taste")
                for a, b in [(theirs[k], mine[k])] if a):
            raise SystemExit("✗ porter.py 导出来的跟约好的格式不一样")
        b2 = core.Book(Path(TMP) / "porter-roundtrip.db")
        porter.load(dict(theirs, exported_at="2026-10-08T03:30:00Z"), b2)
        again = porter.dump(b2)
        again.pop("exported_at", None)
        if again != mine:
            raise SystemExit("✗ porter.py 导进去再导出来变了")
        porter_same = True

    # 表：schema.sql 建出来的，跟 core.Book() 建出来的一样不一样
    a = schema_info(book.path)
    p2 = Path(TMP) / "schema-sql.db"
    c = sqlite3.connect(p2)
    c.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))
    c.close()
    b = schema_info(p2)
    if a != b:
        for t in sorted(set(a) | set(b)):
            if a.get(t) != b.get(t):
                print(f"✗ 表 {t} 对不上：\n  core.py    {a.get(t)}\n  schema.sql {b.get(t)}")
        raise SystemExit("✗ schema.sql 跟 core.py 的 SCHEMA 不一样")

    # 版本：manifest.json 写的，跟 mcp_server.py 真起来 initialize 回的，得是同一个
    import subprocess
    env = dict(os.environ, HAVE_YOU_EATEN_DATA=TMP, HAVE_YOU_EATEN_NO_WEB="1")
    out = subprocess.run([sys.executable, "-B", str(UP / "mcp_server.py")], input=json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}) + "\n", capture_output=True, text=True, env=env, timeout=30).stdout
    server_version = json.loads(out.splitlines()[0])["result"]["serverInfo"]["version"]
    manifest_version = json.loads((UP / "manifest.json").read_text(encoding="utf-8"))["version"]
    if server_version != manifest_version:
        raise SystemExit(f"✗ mcp_server.py 说 {server_version}，manifest.json 说 {manifest_version}")

    return {
        "_": "scripts/conformance.py 跑上一层 Python 那份写出来的，别手改。",
        "server_version": server_version,
        "python": sys.version.split()[0],
        "tools": mcp_server.TOOLS,
        "tables": {t: v["columns"] for t, v in a.items() if t != "_sql"},
        "menu_count": len(dice.menu()),
        "porter_same": porter_same,
        "ops": results,
        "dice": cases,
    }


if __name__ == "__main__":
    try:
        if "--dump" in sys.argv:
            n = int(sys.argv[sys.argv.index("--dump") + 1])
            sc = json.loads((HERE / "test" / "fixtures" / "scenario.json").read_text(encoding="utf-8"))
            exp = main()
            case = sc["dice"][n]
            d = core.Book(Path(TMP) / "food.db").all()
            if case.get("taste") is not None:
                d["taste"] = case["taste"]
            R = dice.rules(d.get("taste"), case.get("want", ""))
            keep = []
            for x in dice.pool(d, case.get("kind", "")):
                if case.get("only") and x["cuisine"] != case["only"]:
                    continue
                r = dice.judge(x, R)
                if r is not None:
                    keep.append((x, r[0], r[1]))
            print("\n".join(kept_lines(keep)))
            raise SystemExit(0)
        out = json.dumps(main(), ensure_ascii=False, indent=1) + "\n"
        dst = HERE / "test" / "fixtures" / "expected.json"
        if "--check" in sys.argv:
            same = dst.is_file() and dst.read_text(encoding="utf-8") == out
            print("expected.json 是最新的" if same else "✗ expected.json 不是最新的 —— 跑一下 npm run conformance")
            raise SystemExit(0 if same else 1)
        dst.write_text(out, encoding="utf-8")
        print(f"写好了 {dst.relative_to(HERE)}（{len(out) // 1024} KB）")
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
