#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""吃了吗 · have-you-eaten —— 本机那一页，和给自建前端用的接口。只用标准库。

  python3 web.py              # 开在 http://127.0.0.1:8770（端口用 HAVE_YOU_EATEN_PORT 换）

页面用的：
  GET  /api/food              整本
  POST /api/food/log          记一顿
  POST /api/food/taste        口味单记一样 {item, kind: 爱吃|不爱吃|不能吃, note}
  POST /api/food/edit         改一条 {kind, id, fields}
  POST /api/food/del          删一条 {kind, id}
  POST /api/settings          {city, spot}：你现在在哪座城、具体在哪（可以空着）
  POST /api/upload            {dataURL}：一顿饭的照片
  POST /api/food/dice         这顿吃什么 {mode: dish|way, kind?, want?, only?}：照口味单丢一次（only＝只在这个菜系里丢）
自建前端 / 网关用的（见 README「接口接入」）：
  GET  /food/context          每轮接在给 AI 的系统提示末尾的那一小段（纯文字）
  GET  /food/tools            四只手的定义
  POST /food/ai               {"tool": "food_note" | "food_taste" | "food_book" | "food_dice", "input": {...}} → 纯文字回执

只听本机（127.0.0.1）。别的网站借你的浏览器往这儿写东西：查 Host 和 Origin，对不上就 403。
"""
import base64
import http.server
import json
import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import core  # noqa: E402

PORT = int(os.environ.get("HAVE_YOU_EATEN_PORT") or 8770)
STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "application/javascript; charset=utf-8"), "/icon.svg": ("icon.svg", "image/svg+xml"),
          # 加到主屏幕用（1008）
          "/icon-180.png": ("icon-180.png", "image/png"), "/icon-192.png": ("icon-192.png", "image/png"), "/icon-512.png": ("icon-512.png", "image/png"),
          "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json")}


def make_server(book=None, port=None):
    book = book or core.Book()
    port = PORT if port is None else port
    hosts, origins = set(), set()      # 起来以后按真拿到的端口填（port=0 时由系统挑）

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _ok_origin(self):
            if (self.headers.get("Host") or "") not in hosts:
                return False
            o = self.headers.get("Origin")
            return o is None or o in origins

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            if not isinstance(body, (bytes, bytearray)):
                body = (json.dumps(body, ensure_ascii=False) if not isinstance(body, str) else body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def _json(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 30 * 1024 * 1024:
                raise core.Bad("太大了")
            try:
                return json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                raise core.Bad("看不懂")

        def do_GET(self):
            if not self._ok_origin():
                return self._send(403, {"ok": False, "err": "只给本机用"})
            path = self.path.split("?")[0]
            if path in STATIC:
                f, ct = STATIC[path]
                return self._send(200, (HERE / "web" / f).read_bytes(), ct)
            if path == "/api/food":
                return self._send(200, book.all())
            if path == "/food/context":
                return self._send(200, book.context_text(), "text/plain; charset=utf-8")
            if path == "/food/tools":
                import mcp_server
                return self._send(200, mcp_server.TOOLS)
            if path.startswith("/uploads/"):
                p = core.data_dir() / "uploads" / os.path.basename(path)
                if p.is_file():
                    return self._send(200, p.read_bytes(), "image/png" if p.suffix == ".png" else "image/jpeg")
            return self._send(404, {"ok": False, "err": "没有这一页"})

        def do_POST(self):
            if not self._ok_origin():
                return self._send(403, {"ok": False, "err": "只给本机用"})
            if "application/json" not in (self.headers.get("Content-Type") or ""):
                return self._send(415, {"ok": False, "err": "要 JSON"})
            path = self.path.split("?")[0]
            try:
                b = self._json()
                if path == "/api/food/log":
                    return self._send(200, book.log(b))
                if path == "/api/food/taste":
                    return self._send(200, book.taste(b.get("item"), b.get("kind"), b.get("note"), b.get("src") or "page",
                                                      b.get("scope") or "", b.get("away")))
                if path == "/api/food/edit":
                    return self._send(200, book.edit(b.get("kind"), b.get("id"), b.get("fields")))
                if path == "/api/food/addlog":   # 1008：记好的一顿再加一道
                    return self._send(200, book.addlog(b.get("meal_id"), b.get("dish") or {}))
                if path == "/api/food/del":
                    return self._send(200, book.delete(b.get("kind"), b.get("id")))
                if path == "/api/settings":
                    book.set_setting("city", core._s(b.get("city"), 60) or "")
                    book.set_setting("spot", core._s(b.get("spot"), 80) or "")
                    return self._send(200, {"ok": True})
                if path == "/api/upload":
                    data = b.get("dataURL") or ""
                    if "," not in data or not data.startswith("data:image"):
                        raise core.Bad("这不是一张图")
                    head, b64 = data.split(",", 1)
                    raw = base64.b64decode(b64)
                    d = core.data_dir() / "uploads"
                    d.mkdir(exist_ok=True)
                    name = f"{uuid.uuid4().hex}.{'png' if 'png' in head else 'jpg'}"
                    (d / name).write_bytes(raw)
                    return self._send(200, {"ok": True, "url": f"/uploads/{name}"})
                if path == "/api/food/dice":
                    import dice
                    return self._send(200, dice.roll(book.all(), b.get("mode") or "dish", b.get("kind") or "", b.get("want") or "", only=b.get("only") or ""))
                if path == "/food/ai":
                    import mcp_server
                    return self._send(200, mcp_server.call(book, b.get("tool") or "", b.get("input") or {}), "text/plain; charset=utf-8")
                return self._send(404, {"ok": False, "err": "没有这个口子"})
            except core.Bad as e:
                return self._send(400, {"ok": False, "err": str(e)})
            except Exception as e:
                return self._send(500, {"ok": False, "err": "出错了：" + str(e)[:200]})

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    real = srv.server_address[1]
    hosts.update({f"127.0.0.1:{real}", f"localhost:{real}"})
    origins.update({f"http://{h}" for h in hosts})
    return srv


if __name__ == "__main__":
    srv = make_server()
    print(f"「吃了吗」开在 http://127.0.0.1:{srv.server_address[1]} （数据在 {core.data_dir()}）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
