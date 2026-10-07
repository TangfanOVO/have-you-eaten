# 放在自己的服务器上

一键安装包只在装了它的那台电脑上能用。你要是有一台自己的服务器，可以把「吃了吗」放上去，
在 claude.ai 里加成一个**自定义连接器**。加好以后，手机上的 Claude App、电脑上的 Claude、网页版，
跟 Ta 聊天的时候都有这四只手，记的是同一本。

| 要准备的 | 说明 |
|---|---|
| 一台服务器 | 外网能访问到。claude.ai 是从它自己那边来连你的，只在你家里网络、内网里能连的不行 |
| Python 3.9 以上 | 只用标准库，不用装别的 |
| 一个域名 | 指到这台服务器（加一条 A 记录）。claude.ai 只认 **https** 网址 |
| Caddy | 在前面套 HTTPS，证书它自己去申请、自己续 |

---

## 一、跑起来

把整个文件夹拷到服务器上，进去跑：

```bash
python3 remote.py
```

第一次起来会生成一个暗号，存在数据目录的 `remote-token` 里，以后一直用它。屏幕上会打出连接器网址：

```
「吃了吗」远程版开在 http://127.0.0.1:8780（数据在 /home/你/.have-you-eaten）
第一次起来，生成了一个暗号，存在 /home/你/.have-you-eaten/remote-token
本机试：http://127.0.0.1:8780/mcp/<暗号>
claude.ai 要 https：套上 HTTPS 以后，连接器网址是 https://<你的域名>/mcp/<暗号>
```

| 参数 | 不写的话 | 干什么 |
|---|---|---|
| `--port` | `8780` | 听哪个端口 |
| `--host` | `127.0.0.1` | Caddy 跟它在同一台机器上就别改。HTTPS 代理在别的机器上，才写 `0.0.0.0` |
| `--token` | 自动生成 | 自己定暗号：至少 16 位，只用字母、数字、`-`、`_`。也能用环境变量 `HAVE_YOU_EATEN_TOKEN` |
| `--web` | 不开 | 顺便开那一页「吃过的」（见第五节） |
| `--public-url` | 不写 | 写上 `https://food.example.com`，屏幕上就打出完整的连接器网址 |

| 环境变量 | 干什么 |
|---|---|
| `HAVE_YOU_EATEN_DATA` | 数据放哪个文件夹，不设就是 `~/.have-you-eaten` |
| `TZ` | **「今天」按哪儿算**。服务器多半是 UTC，你在上海就写 `TZ=Asia/Shanghai`，在悉尼写 `TZ=Australia/Sydney`。不设的话，「今天吃了没」「这是早饭还是午饭」会按服务器的钟走 |

```bash
TZ=Asia/Shanghai python3 remote.py --public-url https://food.example.com
```

---

## 二、套上 HTTPS（Caddy）

1. 域名加一条 A 记录，指到服务器的 IP。服务器防火墙放开 80 和 443。
2. 装 Caddy：照 [caddyserver.com/docs/install](https://caddyserver.com/docs/install) 来。
3. 把 `/etc/caddy/Caddyfile` 写成这样（`food.example.com` 换成你的域名）：

   ```
   food.example.com {
       reverse_proxy 127.0.0.1:8780
   }
   ```

4. `sudo systemctl reload caddy`。过一会儿 Caddy 就把证书申请好了。

在你自己电脑上试一下，能看到四只手就通了：

```bash
curl -s https://food.example.com/mcp/<暗号> \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

没有域名的话，Cloudflare Tunnel、Tailscale Funnel 也能给你一个 https 网址，把它指到 `127.0.0.1:8780` 就行。

### 让它一直开着（systemd）

关掉终端它就停了。想让它开机自己起来、挂了自己重启，写一个 `/etc/systemd/system/have-you-eaten.service`：

```ini
[Unit]
Description=have-you-eaten
After=network.target

[Service]
User=你的用户名
WorkingDirectory=/home/你的用户名/have-you-eaten
Environment=TZ=Asia/Shanghai
ExecStart=/usr/bin/python3 remote.py --public-url https://food.example.com
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now have-you-eaten
cat ~/.have-you-eaten/remote-token     # 忘了暗号就看这里
```

---

## 三、在 claude.ai 里加连接器

| 一步 | 怎么做 |
|---|---|
| 1 | 电脑上打开 claude.ai → **Settings（设置）→ Connectors（连接器）** |
| 2 | 点 **Add custom connector（添加自定义连接器）** |
| 3 | 名字随便起，比如「吃了吗」；网址贴 `https://food.example.com/mcp/<暗号>`。高级设置里的 OAuth 那几栏空着 |
| 4 | 点 Add。连上以后能看到 `food_note`、`food_taste`、`food_book`、`food_dice` 四只手 |
| 5 | 聊天的时候，在输入框旁边的工具菜单（Search and tools）里把它打开 |

加一次就行：手机上的 Claude App、Claude 桌面 App 登同一个账号，连接器自己就在。
哪些套餐能加自定义连接器、能加几个，以 claude.ai 当时的说明为准；团队版、企业版可能要管理员先在组织设置里加。

**还要告诉 Ta 有这本本子。** 把 [README](../README.md) 里「关键的一步」那段话放进 Claude 的个人偏好或者项目说明里，
Ta 才知道什么时候该记、该翻。

**原来装过一键安装包的：** 电脑上那个记在电脑上那本，服务器这个记在服务器那本，两本不会自己合到一起。
搬过来以后（见第六节），把桌面 App 里的那个扩展关掉，只留连接器，就只有一本了。

---

## 四、网址要保密

网址最后那一截就是钥匙：谁拿到这个网址，谁就能看、能记、能导出你整本本子。
（暗号放在网址里，是因为 claude.ai 的自定义连接器不能自己加请求头。）

| | |
|---|---|
| 别往外发 | 别截进图里，别贴进群聊、issue、论坛 |
| 日志 | `remote.py` 自己的日志里，暗号都打成 `***`。Caddy 默认不记访问日志；你要是开了，或者用的是 nginx（默认会记），日志里会有带暗号的网址 |
| 暗号不对 | 网址里的暗号不对一律 404，请求头里的不对是 401，都不多说一个字 |
| 能加请求头的客户端 | 也可以用 `https://food.example.com/mcp`，暗号放在 `Authorization: Bearer <暗号>` 里 |
| 泄露了 / 想换 | 删掉数据目录里的 `remote-token`，重启，会生成一个新的；再去 claude.ai 把旧连接器删掉、用新网址重加 |

---

## 五、网页（可选）

起的时候加 `--web`，那一页「吃过的」也在服务器上：

```
https://food.example.com/u/<暗号>/
```

手机浏览器打开以后可以「添加到主屏幕」，跟 App 一样点开就是。

进门那一下，浏览器会记一块小饼干（cookie），页面后面的请求都认这块饼干。换了暗号，饼干跟着作废，用新网址再进一次就好。
别的网站想借你的浏览器往本子里写，会被挡掉。

---

## 六、搬家：导出 / 导入

整本可以导出成一个 JSON 文件，再导进另一处。从电脑上的版本搬到服务器、换服务器、留一份备份，都用它。

| 想干什么 | 怎么做 |
|---|---|
| 导出 | `python3 porter.py export 吃了吗.json` |
| 从服务器上直接下载一份 | `curl -o 吃了吗.json https://food.example.com/mcp/<暗号>/export` |
| 导入 | `python3 porter.py import 吃了吗.json`（只往空本子里导） |
| 本子里已经有东西，要整本换掉 | `python3 porter.py import 吃了吗.json --force`：原来那本先备份成 `food.db.bak-before-import-<时间>`，再换 |

**从电脑搬到服务器：**

1. 在电脑上（源码文件夹里）：`python3 porter.py export 吃了吗.json`
2. 拷过去：`scp 吃了吗.json 你@服务器:~/`
3. 在服务器上：`python3 porter.py import ~/吃了吗.json`
4. 照片不在 JSON 里：把电脑上 `~/.have-you-eaten/uploads/` 整个拷到服务器数据目录下的 `uploads/`

导入是一整笔：有一行对不上，整笔退回，本子不动。导出的文件格式是固定的，各个版本之间通用。

---

## 七、数据在哪

| | |
|---|---|
| 存在哪 | 你的服务器上：跑 `remote.py` 的那个用户的 `~/.have-you-eaten/`。`food.db` 是本子，`uploads/` 是照片，`remote-token` 是暗号 |
| 换地方 | 设 `HAVE_YOU_EATEN_DATA` 指到别的文件夹 |
| 备份 | 拷走那个文件夹，或者定时 `porter.py export` |
| 谁看得见 | 拿到网址的人。Claude 用这几只手的时候，读到的、记进去的那几行字会出现在你们的聊天里，跟你们聊的别的话一样 |
| 清空 | 停掉服务，删掉那个文件夹 |
