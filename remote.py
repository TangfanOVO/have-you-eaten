#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""吃了吗 · have-you-eaten —— 放在你自己服务器上的远程版（MCP Streamable HTTP，2025-06-18）。只用标准库，Python 3.9+。

  python3 remote.py                                    # 开在 127.0.0.1:8780，前面套一层 HTTPS（见 docs/self-host.md）
  python3 remote.py --public-url https://food.example.com --web

口子：
  POST /mcp/<暗号>           MCP（JSON-RPC）：initialize / tools/list / tools/call / ping。claude.ai「自定义连接器」贴这个网址
  POST /mcp                  同上，暗号放在 Authorization: Bearer <暗号>
  GET  /mcp/<暗号>/export    整本导出成一个 JSON（格式见 porter.py；Bearer 的走 /mcp/export）
  GET  /u/<暗号>/            加了 --web 才有：那一页「吃过的」，和它的接口（/u/<暗号>/api/food …）

四只手跟 mcp_server.py 是同一份（TOOLS / call），网页跟 web.py 是同一套处理，这里只管门口。

暗号：--token，或环境变量 HAVE_YOU_EATEN_TOKEN；都没有就第一次起来时生成一个，存在数据目录的 remote-token 里，以后一直用它。
暗号不对一律 404（走 Bearer 的是 401），不多说一个字；日志里的暗号打成 ***。
"""
import argparse
import hashlib
import hmac
import http.cookies
import http.server
import json
import os
import re
import secrets
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import core  # noqa: E402
import mcp_server  # noqa: E402
import porter  # noqa: E402

TOKEN_FILE = "remote-token"
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{16,200}")
COOKIE = "hye_web"
MAX_BODY = 4 * 1024 * 1024          # MCP 一条消息；网页上传照片走 web.py 自己的上限
LATEST = "2025-06-18"
EMPTY = {"resources/list": {"resources": []}, "resources/templates/list": {"resourceTemplates": []}, "prompts/list": {"prompts": []}}
try:
    VERSION = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))["version"]
except Exception:
    VERSION = "0.1.0"


class TooBig(Exception):
    pass


def load_token(given=None):
    """返回 (暗号, 是不是刚生成的)。"""
    t = (given or os.environ.get("HAVE_YOU_EATEN_TOKEN") or "").strip()
    if t:
        if not TOKEN_RE.fullmatch(t):
            raise SystemExit("暗号至少 16 位，只能用字母、数字、- 和 _（它要放进网址里）。不写 --token 就自动生成一个够长的。")
        return t, False
    f = core.data_dir() / TOKEN_FILE
    if f.is_file():
        t = f.read_text(encoding="utf-8").strip()
        if not TOKEN_RE.fullmatch(t):
            raise SystemExit(f"{f} 里的暗号不对（至少 16 位，字母、数字、- 和 _）。删掉这个文件再起，会重新生成一个。")
        return t, False
    t = secrets.token_urlsafe(32)
    fd = os.open(str(f), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(t + "\n")
    return t, True


def tool_text(book, name, args, page=None):
    """跟 mcp_server.py 里一样：一只手出错不卡死连接，说一句人话。"""
    if name == "food_page":   # 远程版的本子页在这台服务器上（1008）
        return (f"本子在 {page} （手机、电脑的浏览器都能开；能记、改、删。地址里带着暗号，只给 Ta 本人）。" if page
                else "这台服务器没开本子页 —— 起的时候加 --web 才有。")
    try:
        return mcp_server.call(book, name, args if isinstance(args, dict) else {})
    except core.Bad as e:
        return "（没记上：" + str(e) + "）"
    except Exception as e:
        return "（本子没翻开：" + str(e)[:200] + "）"


def _ok(rid, result):
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _err(rid, code, msg):
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": msg}}


def rpc(book, m, page=None):
    """一条 JSON-RPC → 回话；通知和客户端回给我们的 response 不回话（None）。"""
    if not isinstance(m, dict):
        return _err(None, -32600, "Invalid Request")
    if "method" not in m or "id" not in m:
        return None
    rid, meth, p = m["id"], m["method"], m.get("params")
    p = p if isinstance(p, dict) else {}
    if meth == "initialize":
        return _ok(rid, {"protocolVersion": p.get("protocolVersion") or LATEST, "capabilities": {"tools": {}},
                         "serverInfo": {"name": "have-you-eaten", "version": VERSION}})
    if meth == "ping":
        return _ok(rid, {})
    if meth == "tools/list":
        return _ok(rid, {"tools": mcp_server.TOOLS})
    if meth == "tools/call":
        name = p.get("name")
        if name not in {t["name"] for t in mcp_server.TOOLS}:
            return _err(rid, -32602, f"Unknown tool: {name}")
        return _ok(rid, {"content": [{"type": "text", "text": tool_text(book, name, p.get("arguments"), page)}]})
    if meth in EMPTY:
        return _ok(rid, EMPTY[meth])
    return _err(rid, -32601, "Method not found")


def _page_handler(book):
    """借 web.py 那套处理（页面、/api/…、上传、/food/…）：让它起一个临时的本机服务、拿到处理类，马上关掉，不留端口。"""
    import web
    srv = web.make_server(book, port=0)
    srv.server_close()
    return srv.RequestHandlerClass


def build_handler(book, token, web_on=False):
    Base = _page_handler(book) if web_on else http.server.BaseHTTPRequestHandler
    cookie_val = hmac.new(token.encode(), b"have-you-eaten/web", hashlib.sha256).hexdigest()   # 饼干里放的不是暗号本身

    class R(Base):
        server_version = "have-you-eaten"
        sys_version = ""
        extra = ()

        # ── 日志：暗号打成 ***
        def log_message(self, fmt, *args):
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), (fmt % args).replace(token, "***")))

        def end_headers(self):
            for k, v in self.extra:
                self.send_header(k, v)
            self.send_header("Referrer-Policy", "no-referrer")       # 网址里有暗号，别带去别的网站
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def _reply(self, code, body=b"", ctype=None, headers=()):
            if isinstance(body, (dict, list)):
                body, ctype = json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8"
            self.send_response(code)
            if ctype:
                self.send_header("Content-Type", ctype)
            for k, v in headers:
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(body)

        # ── 认人
        def _good(self, s):
            return bool(s) and hmac.compare_digest(s.encode("utf-8"), token.encode("utf-8"))

        def _bearer(self):
            h = (self.headers.get("Authorization") or "").strip()
            return h[:7].lower() == "bearer " and self._good(h[7:].strip())

        def _cookie(self):
            c = http.cookies.SimpleCookie()
            try:
                c.load(self.headers.get("Cookie") or "")
            except http.cookies.CookieError:
                return False
            m = c.get(COOKIE)
            return bool(m) and hmac.compare_digest(m.value.encode("utf-8"), cookie_val.encode("utf-8"))

        def _ok_origin(self):
            """web.py 问「是不是自己人」的那一下：带了 Origin 的，得是本站（防别的网站借浏览器来写）。"""
            o = self.headers.get("Origin")
            if o is None:
                return True
            hosts = {self.headers.get("Host"), self.headers.get("X-Forwarded-Host")} - {None, ""}
            return any(o in (f"https://{h}", f"http://{h}") for h in hosts)

        # ── 分路
        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def do_DELETE(self):
            self._route("DELETE")

        def _route(self, method):
            path, _, query = self.path.partition("?")
            if path.rstrip("/") in ("/mcp", "/mcp/export"):
                if not self._bearer():
                    return self._reply(401, headers=[("WWW-Authenticate", "Bearer")])
                return self._export(method) if path.rstrip("/").endswith("/export") else self._mcp(method)
            if path.startswith("/mcp/"):
                s, _, sub = path[5:].partition("/")
                if not self._good(s):
                    return self._reply(404)
                sub = sub.strip("/")
                if sub == "":
                    return self._mcp(method)
                if sub == "export":
                    return self._export(method)
                return self._reply(404)
            if web_on and path.startswith("/u/"):
                s, _, sub = path[3:].partition("/")
                if not self._good(s):
                    return self._reply(404)
                # 页面里的请求都写死在根上（/api/food、/app.js、/uploads/…）：进门这一下发一块饼干，根上那些认饼干
                secure = (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"
                self.extra = [("Set-Cookie", f"{COOKIE}={cookie_val}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax"
                               + ("; Secure" if secure else ""))]
                return self._page(method, "/" + sub, query)
            if web_on and (self._cookie() or self._bearer()):
                return self._page(method, path, query)
            return self._reply(404)

        def _page_url(self):
            if not web_on:
                return None
            host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
            proto = (self.headers.get("X-Forwarded-Proto") or ("http" if host.startswith(("127.0.0.1", "localhost")) else "https")).split(",")[0].strip()
            return f"{proto}://{host}/u/{token}/" if host else None

        def _page(self, method, path, query):
            self.path = path + ("?" + query if query else "")
            if method == "GET":
                return super().do_GET()
            if method == "POST":
                return super().do_POST()
            return self._reply(405, headers=[("Allow", "GET, POST")])

        # ── MCP
        def _body(self):
            n = self.headers.get("Content-Length")
            if n is not None:
                n = int(n)
                if n > MAX_BODY:
                    raise TooBig
                return self.rfile.read(n)
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                buf = b""
                while True:
                    size = int(self.rfile.readline(1024).split(b";")[0].strip() or b"0", 16)
                    if size == 0:
                        while self.rfile.readline(1024) not in (b"\r\n", b"\n", b""):
                            pass
                        return buf
                    buf += self.rfile.read(size)
                    self.rfile.readline(1024)
                    if len(buf) > MAX_BODY:
                        raise TooBig
            return b""

        def _mcp(self, method):
            if method != "POST":            # 不开服务器推送的那条流：GET / DELETE 一律 405，客户端照规范就只走 POST
                return self._reply(405, headers=[("Allow", "POST")])
            try:
                raw = self._body()
            except TooBig:
                return self._reply(413)
            except ValueError:
                return self._reply(400)
            try:
                msg = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return self._reply(400, _err(None, -32700, "Parse error"))
            if isinstance(msg, list):         # 老一点的客户端（2025-03-26）会一次发一串
                if not msg:
                    return self._reply(400, _err(None, -32600, "Invalid Request"))
                out = [r for r in (rpc(book, m, self._page_url()) for m in msg) if r is not None] or None
            else:
                out = rpc(book, msg, self._page_url())
            if out is None:                   # 只有通知 / 回话：收到了，不回话
                return self._reply(202)
            return self._reply(200, out)

        def _export(self, method):
            if method != "GET":
                return self._reply(405, headers=[("Allow", "GET")])
            d = porter.dump(book)
            name = "have-you-eaten-" + d["exported_at"][:10].replace("-", "") + ".json"
            return self._reply(200, (json.dumps(d, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                               "application/json; charset=utf-8", [("Content-Disposition", f'attachment; filename="{name}"')])

    return R


def make_server(book, token, host="127.0.0.1", port=8780, web_on=False):
    return http.server.ThreadingHTTPServer((host, port), build_handler(book, token, web_on))


def main(argv=None):
    ap = argparse.ArgumentParser(description="「吃了吗」远程版：MCP over HTTP，给 claude.ai 自定义连接器用")
    ap.add_argument("--host", default="127.0.0.1", help="听哪个地址。前面的 HTTPS 代理在同一台机器上就别改；要让别的机器直连才写 0.0.0.0")
    ap.add_argument("--port", type=int, default=8780)
    ap.add_argument("--token", help="自己定暗号（至少 16 位，字母、数字、- 和 _）。不写：用数据目录里存的，没有就生成一个")
    ap.add_argument("--web", action="store_true", help="顺便开那一页「吃过的」，在 /u/<暗号>/")
    ap.add_argument("--public-url", help="外面看到的网址，比如 https://food.example.com，只用来把连接器网址打全")
    a = ap.parse_args(argv)
    token, new = load_token(a.token)
    book = core.Book()
    srv = make_server(book, token, a.host, a.port, a.web)
    port = srv.server_address[1]
    local = f"http://{'127.0.0.1' if a.host in ('', '0.0.0.0') else a.host}:{port}"
    pub = (a.public_url or "").rstrip("/")
    print(f"「吃了吗」远程版开在 {local}（数据在 {core.data_dir()}）", flush=True)
    if new:
        print(f"第一次起来，生成了一个暗号，存在 {core.data_dir() / TOKEN_FILE}", flush=True)
    if pub:
        print(f"连接器网址（贴进 claude.ai → 设置 → 连接器 → 添加自定义连接器）：\n  {pub}/mcp/{token}", flush=True)
        if a.web:
            print(f"网页：\n  {pub}/u/{token}/", flush=True)
    else:
        print(f"本机试：{local}/mcp/{token}", flush=True)
        print(f"claude.ai 要 https：套上 HTTPS 以后，连接器网址是 https://<你的域名>/mcp/{token}", flush=True)
        if a.web:
            print(f"网页：{local}/u/{token}/", flush=True)
    print("这个网址就是钥匙，别发给别人、别截进图里。", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
