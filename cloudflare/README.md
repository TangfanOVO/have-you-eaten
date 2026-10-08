# 吃了吗 · Cloudflare 版

不想一直开着电脑？把「吃了吗」放到你自己的 Cloudflare 免费账号上：
claude.ai 网页版、手机上的 Claude App 都能用那几只手，本子那一页用手机浏览器就能打开。

规矩跟电脑版一模一样：同一份菜单、同样的剔法（不能吃 / 不爱吃 / 备注不要香菜）、同样的回话。
每一条都拿电脑版的 Python 对着跑过（见文末「怎么知道跟电脑版一样」）。

| 有 | 说明 |
|---|---|
| claude.ai 连接器 | `food_note` `food_taste` `food_book` `food_dice` `food_rate` `food_page` 六只手，网页版和手机 App 都能用。`food_rate`：吃完才说好不好吃，改到那一顿上；`food_page`：把本子那一页的地址给你 |
| 本子那一页 | 跟电脑版同一页，手机浏览器打开，可以加到主屏幕 |
| 搬家 | 整本导出成一个文件 / 导回来，跟电脑版的 `porter.py` 互通 |
| 传照片 | **还不行**（免费的 Cloudflare 上没有地方放图）。点了会说一声，字照样能记 |

数据在你自己账号的 D1 数据库里，别人看不到。

---

## 一、一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/have-you-eaten/tree/main/cloudflare)

1. 点上面的按钮，登录（或注册）你自己的 Cloudflare 账号。
2. 它会问两样：
   - **HYE_SECRET**：你的密钥。至少 16 位，只用字母、数字、`-` 和 `_`，越乱越好。生成一串：
     ```
     node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
     ```
     没装 Node 的话，用 Mac 的「终端」跑：`openssl rand -base64 24 | tr '+/' '-_' | tr -d '='`
   - **HYE_TZ**：你在哪个时区。国内填 `Asia/Shanghai`，悉尼填 `Australia/Sydney`。「今天」按它算，凌晨 5 点前还算前一天。
3. 点部署，等一两分钟。完了会给你一个地址，长这样：`https://have-you-eaten.<你的名字>.workers.dev`

数据库它会自己建，表 Worker 第一次被打开时自己建，不用管。

## 二、自己部署（命令行）

要 Node.js 22 以上。

```
cd cloudflare
npm i
npx wrangler login                         # 登录你的 Cloudflare 账号
npx wrangler d1 create have-you-eaten      # 建数据库，把它打印的 database_id 抄进 wrangler.toml
npx wrangler secret put HYE_SECRET         # 粘贴你生成的密钥（生成方法见上面）
npx wrangler deploy
```

- 时区：改 `wrangler.toml` 里的 `HYE_TZ`，再 `npx wrangler deploy` 一次。
- 表：不用手动建。想先建好也行：`npx wrangler d1 execute have-you-eaten --remote --file=schema.sql`
- 换密钥：再跑一次 `npx wrangler secret put HYE_SECRET`。旧地址马上失效，连接器要用新地址重加一次。

## 三、连到 claude.ai

1. 打开 claude.ai → **设置（Settings）→ 连接器（Connectors）→ 添加自定义连接器（Add custom connector）**。
2. 名字写「吃了吗」，地址填：
   ```
   https://have-you-eaten.<你的名字>.workers.dev/mcp/<你的密钥>
   ```
   别的都不用填，点添加。
3. 聊天的时候，在输入框的工具菜单里把「吃了吗」打开。

网页上加好以后，手机上的 Claude App 用同一个账号登录就能用。

连接器会自己告诉 Claude 什么时候用哪只手。想更稳一点，把电脑版 README 里「告诉 Ta 有这本本子」那段放进项目说明。

> 密钥就在地址里（claude.ai 的连接器加不了别的验证方式）。地址等于钥匙：别发给别人、别截图发出去。
> 密钥不对的地址一律当作不存在（404）。

## 四、本子那一页

```
https://have-you-eaten.<你的名字>.workers.dev/u/<你的密钥>/
```

手机 Safari 打开 → 分享 → **添加到主屏幕**，就像一个小 App。

## 五、搬家（导出 / 导入）

最方便的是这一页：

```
https://have-you-eaten.<你的名字>.workers.dev/u/<你的密钥>/move
```

| 想做什么 | 怎么做 |
|---|---|
| 存一份 | 点「存一份到这台设备」，下载一个 `.json` |
| 倒回来 | 选文件，点「导入」。**只往空本子里倒** |
| 整本换掉 | 勾上「整本换掉」再导入：本子里现在的东西全删掉，换成文件里的（先存一份再换） |
| 从电脑版搬过来 | 电脑上 `python3 porter.py export 吃了吗.json`，再在这一页导入 |
| 搬回电脑版 | 这里存一份，电脑上 `python3 porter.py import 吃了吗.json` |

不用这一页也行：

```
GET  /mcp/<密钥>/export                     整本导出
POST /u/<密钥>/api/import                   导入（Content-Type: application/json，本子得是空的）
POST /u/<密钥>/api/import?force=1           整本换掉
```

文件格式跟电脑版约好的一样：

```
{"format":"have-you-eaten","version":1,"exported_at":"…","settings":{…},
 "shops":[…],"branches":[…],"meals":[…],"dishes":[…],"logs":[…],"taste":[…]}
```

每一行的栏目跟 `core.py` 里那几张表一模一样。照片不在文件里。

不小心整本换错了：D1 自带「时间旅行」，免费账号能把整个库退回到 7 天内的任意时刻：
`npx wrangler d1 time-travel restore have-you-eaten --timestamp=<那一刻>`

## 六、免费额度够不够

一个人用，够用很久。按一年记 1000 顿、本子里大约 4000 行估：

| 免费给的 | 吃了吗用多少 |
|---|---|
| Workers：每天 10 万次请求 | 打开一次页面五六次，Claude 用一只手一两次 |
| Workers：每次请求 10 毫秒 CPU | 实测（一年的本子）：翻本子约 1 毫秒，丢骰子约 2.5 毫秒 |
| D1：每天读 500 万行 | 打开页面、翻本子、丢骰子，每次读一遍整本 ≈ 4000 行 → 一天能翻一千多次 |
| D1：每天写 10 万行 | 记一顿写十几行 → 一天能记几千顿 |
| D1：一个库 500 MB | 一顿不到 1 KB |
| Worker 大小：3 MB | 这个约 100 KB |

额度每天 0 点（UTC）重置。用超了只是那天暂时用不了，第二天就好；免费账号不会因此扣钱。

---

## 本机试跑

```
cp .dev.vars.example .dev.vars        # 等号后面填一个密钥
npm run dev                           # 开在 http://localhost:8787/u/<密钥>/
npm test                              # 本机跑全部测试，不连 Cloudflare、不要账号
```

本机的数据库在 `.wrangler/` 里，删掉就是一本空本子。

## 怎么知道跟电脑版一样

`test/fixtures/scenario.json` 是一张单子：一百多步记一顿、改、删、口味单、吃完再改评价（时好时坏）、每只手的回话，再加二十多种口味单下丢骰子。

- `npm run conformance`：让上一层的 Python 那份（`core.py` `dice.py` `mcp_server.py`）照单子走一遍，结果写进 `test/fixtures/expected.json`。时间钉在同一刻，骰子塞同一串随机数。
- `npm test`：这份照同一张单子在本机的 D1 上走一遍，每一步都要跟 Python 的一模一样。对的有：每一步的返回和报错的那句话、表里每一行、`food_book` 每一种看法的整段字、骰子剔完剩下的每一道（分量和「备注不要 X」）、丢到哪一道、整家拉黑、导出格式。Python 导出的文件倒进来再翻本子，也要一字不差。

## 跟电脑版不一样的地方

| | 电脑版 | 这里 |
|---|---|---|
| 「今天」按哪儿算 | 电脑的时区 | `HYE_TZ` |
| 传照片 | 可以 | 还不行 |
| 谁能打开 | 只有本机 | 知道地址（带密钥）的人 |
| 整本换掉之前 | 自动备份一份 | 自己先存一份；万一忘了，用时间旅行退回去 |

## 维护

| 上一层改了 | 这里要做 |
|---|---|
| `web/` 或 `dishes.txt` | `npm run sync`（原样抄进 `src/generated/`，`npm test` 会先查抄的是不是最新的） |
| `core.py` 的表 | 照抄进 `schema.sql`，`npm run sync`，`npm run conformance` |
| `core.py` `dice.py` `mcp_server.py` 的规矩、回话 | 照着改 `src/` 里对应的那份，`npm run conformance && npm test` |

| 文件 | 是什么 |
|---|---|
| `src/app.ts` | 路由：密钥、`/mcp`、`/u`、导出导入 |
| `src/core.ts` | `core.py` 搬过来的：存、读、翻本子 |
| `src/dice.ts` | `dice.py` 搬过来的：这顿吃什么 |
| `src/tools.ts` `src/tools-def.ts` | `mcp_server.py` 搬过来的：六只手（`food_page` 照 `remote.py` 的回法） |
| `src/mcp.ts` | MCP（Streamable HTTP，2025-06-18） |
| `src/exchange.ts` | 导出 / 导入 |
| `src/web.ts` | 那一页挂在 `/u/<密钥>/` 底下要换的路径，和搬家那一页 |
| `src/generated/` | 从上一层抄来的，别手改 |
| `schema.sql` | D1 的表，跟 `core.py` 一字不差 |
| `scripts/conformance.py` | 跑 Python 那份，写 `expected.json` |
