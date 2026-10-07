#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""吃了吗 · have-you-eaten —— 搬家：整本导出成一个 JSON，再导进另一处。只用标准库，Python 3.9+。

  python3 porter.py export out.json          # 「-」＝打到屏幕上
  python3 porter.py import in.json           # 只往空本子里导
  python3 porter.py import in.json --force   # 本子里有东西也导：先把原来的整份备份，再整本换掉

导哪一本：跟别处一样看环境变量 HAVE_YOU_EATEN_DATA，不设就是 ~/.have-you-eaten。
照片不在这个文件里，在数据目录的 uploads/，要的话一起拷走。

文件长这样（各个版本之间通用，别改）：
  {"format": "have-you-eaten", "version": 1, "exported_at": "2026-10-08T03:12:45Z",
   "settings": {"city": "…", "spot": "…"},
   "shops": […], "branches": […], "meals": […], "dishes": […], "logs": […], "taste": […]}
每一行的栏目跟 core.py 里 SCHEMA 那几张表一模一样（logs ＝ dish_log 表），值原样照抄（away 是 0/1）。
"""
import argparse
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402

FORMAT, VERSION = "have-you-eaten", 1
PARTS = (("shops", "shop"), ("branches", "branch"), ("meals", "meal"), ("dishes", "dish"), ("logs", "dish_log"), ("taste", "taste"))
NAMES = {"shops": "家店", "branches": "家分店", "meals": "顿", "dishes": "道菜", "logs": "条菜的记录", "taste": "条口味"}


def _columns():
    """栏目照 core.SCHEMA 现建一份拿：表怎么定义的，导出就是哪几栏、什么顺序。"""
    c = sqlite3.connect(":memory:")
    try:
        c.executescript(core.SCHEMA)
        return {key: [r[1] for r in c.execute(f"PRAGMA table_info({t})")] for key, t in PARTS}
    finally:
        c.close()


COLS = _columns()


def dump(book=None):
    """整本 → 一个 dict（就是文件里那个样子）。"""
    book = book or core.Book()

    def q(c):
        d = {"format": FORMAT, "version": VERSION,
             "exported_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "settings": {r["k"]: r["v"] for r in c.execute("SELECT k, v FROM setting ORDER BY k")}}
        for key, t in PARTS:
            d[key] = [dict(r) for r in c.execute(f"SELECT {', '.join(COLS[key])} FROM {t} ORDER BY id")]
        return d
    return book._tx(q)


def is_empty(book):
    def q(c):
        return all(c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == 0 for _, t in PARTS)
    return book._tx(q)


def _check(data):
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise core.Bad("这不是「吃了吗」导出的文件")
    v = data.get("version")
    if not isinstance(v, int) or v < 1:
        raise core.Bad("文件里的 version 看不懂")
    if v > VERSION:
        raise core.Bad(f"这个文件是新版本导出的（version {v}），先把这边更新一下再导")
    if not isinstance(data.get("settings") or {}, dict):
        raise core.Bad("settings 应该是一组 键: 值")
    for key, _ in PARTS:
        rows = data.get(key) or []
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise core.Bad(f"{key} 应该是一串记录")


def _backup(book):
    """整本换掉之前，原来的库原样存一份在旁边。"""
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    p = Path(book.path).with_name(Path(book.path).name + f".bak-before-import-{stamp}")
    src, dst = sqlite3.connect(book.path), sqlite3.connect(str(p))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return str(p)


def load(data, book=None, force=False):
    """文件内容 → 本子。空本子直接导；有东西要 force，先备份再整本换掉（设置也换成文件里的）。整笔一个事务，错一行全不动。"""
    _check(data)
    book = book or core.Book()
    with core._LOCK:
        backup = None
        if not is_empty(book):
            if not force:
                raise core.Bad("本子里已经有东西了，只往空本子里导。真要整本换掉，加 --force（会先备份原来的）")
            backup = _backup(book)
        skipped = set()

        def w(c):
            for _, t in reversed(PARTS):           # 先删底下的，再删上面的
                c.execute(f"DELETE FROM {t}")
            c.execute("DELETE FROM setting")
            for k, v in (data.get("settings") or {}).items():
                c.execute("INSERT INTO setting(k, v) VALUES(?, ?)", (str(k), None if v is None else str(v)))
            for key, t in PARTS:
                for r in data.get(key) or []:
                    cols = [k for k in COLS[key] if k in r]
                    skipped.update(f"{key}.{k}" for k in r if k not in COLS[key])
                    if not cols:
                        continue
                    c.execute(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                              [r[k] for k in cols])
        try:
            book._tx(w)
        except sqlite3.Error as e:
            raise core.Bad(f"导到一半对不上，整笔退回了，本子没动：{e}")
    return {"ok": True, "counts": {key: len(data.get(key) or []) for key, _ in PARTS}, "backup": backup, "skipped": sorted(skipped)}


def _say_counts(counts):
    return "、".join(f"{counts[k]} {NAMES[k]}" for k, _ in PARTS)


def main(argv=None):
    ap = argparse.ArgumentParser(description="「吃了吗」搬家：整本导出 / 导入一个 JSON 文件")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export", help="整本导出")
    e.add_argument("file", help="写到哪个文件；「-」＝打到屏幕上")
    i = sub.add_parser("import", help="从文件导入")
    i.add_argument("file", help="哪个文件；「-」＝从标准输入读")
    i.add_argument("--force", action="store_true", help="本子里有东西也导：先备份，再整本换掉")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "export":
            d = dump()
            text = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
            if a.file == "-":
                sys.stdout.write(text)
            else:
                Path(a.file).write_text(text, encoding="utf-8")
                print(f"导出了 {_say_counts({k: len(d[k]) for k, _ in PARTS})} → {a.file}")
            return 0
        try:
            raw = sys.stdin.read() if a.file == "-" else Path(a.file).read_text(encoding="utf-8")
            data = json.loads(raw)
        except (OSError, ValueError) as er:
            raise core.Bad(f"文件读不了：{er}")
        r = load(data, force=a.force)
        print(f"导进来了 {_say_counts(r['counts'])}（数据在 {core.data_dir()}）")
        if r["backup"]:
            print(f"原来的那本备份在 {r['backup']}")
        if r["skipped"]:
            print("这几栏这边不认，没导：" + "、".join(r["skipped"]))
        return 0
    except core.Bad as er:
        print(str(er), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
