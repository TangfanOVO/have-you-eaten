#!/bin/bash
# 双击开「吃了吗」那一页（不用 Claude 桌面 App 的时候、或者自己搭了前端的时候用）
cd "$(dirname "$0")"
( sleep 1; open "http://127.0.0.1:8770" ) &
exec python3 web.py
