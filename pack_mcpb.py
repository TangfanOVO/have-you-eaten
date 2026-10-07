#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打成 Claude 桌面 App 能双击安装的 .mcpb（就是一个 zip）。

    python3 pack_mcpb.py        # 产出 have-you-eaten-<版本>.mcpb
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
M = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
OUT = ROOT / f"{M['name']}-{M['version']}.mcpb"
FILES = ["manifest.json", "mcp_server.py", "core.py", "web.py", "dice.py", "dishes.txt", "README.md", "LICENSE", "COMMERCIAL.md",
         "web/index.html", "web/app.js", "web/icon.svg"]

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        z.write(ROOT / f, f)
print(f"✓ {OUT.name}（{len(FILES)} 个文件，{OUT.stat().st_size // 1024} KB）")
print("  在 Claude 桌面 App 里打开它就能装；装完浏览器打开 http://127.0.0.1:8770")
