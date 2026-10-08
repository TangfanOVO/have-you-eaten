// 给你的 AI 的几只手（mcp_server.py 的 call() 照着搬过来）。回的都是给 AI 看的一段纯文字。
//   food_note   Ta 说吃了什么 → 当场记一笔（可以不打分）
//   food_taste  不记日期的口味单：爱吃 / 不爱吃 / 不能吃
//   food_book   推荐吃的之前先翻：今天吃了没、上一顿多久以前、口味单、常吃、踩过的雷
//   food_dice   这顿吃什么：照口味单丢一次骰子（不能吃的、不爱吃的先剔掉）
//   food_rate   改评价：记好的一顿，吃完才说好不好吃
//   food_page   本子那一页的地址（这里＝这个 Worker 的 /u/<密钥>/，跟 remote.py 回的同一句）
import { Book, TK, TKIN, V, VIN, tname } from "./core";
import * as dice from "./dice";
import { Bad, asList, asObj, lookup, pyStr, pyStrip, pyTruthy } from "./py";

export { TOOLS } from "./tools-def";

/** 只读的两只手标出来（MCP 2025-06-18 的 annotations），claude.ai 那边看得懂哪只手会写东西 */
export const ANNOTATIONS: Record<string, Record<string, unknown>> = {
  food_note: { title: "记一顿", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  food_taste: { title: "口味单", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  food_book: { title: "翻本子", readOnlyHint: true, openWorldHint: false },
  food_dice: { title: "这顿吃什么", readOnlyHint: true, openWorldHint: false },
  food_rate: { title: "改评价", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  food_page: { title: "本子在哪", readOnlyHint: true, openWorldHint: false },
};

/** remote.py 的 food_page：本子在这台服务器上（Worker 一直开着那一页，用不上「没开本子页」那一句） */
export function pageText(page: string): string {
  return `本子在 ${page} （手机、电脑的浏览器都能开；能记、改、删。地址里带着暗号，只给 Ta 本人）。`;
}

const get = (a: Record<string, any>, k: string): any => (Object.prototype.hasOwnProperty.call(a, k) ? a[k] : null);
const or = (v: any, d: any) => (pyTruthy(v) ? v : d);

/** 六只手。rng 换成固定的一串，food_dice 就丢得出同一个结果（测试用）；page＝本子那一页的地址（food_page 回它）。 */
export async function call(book: Book, name: string, a0: unknown, rng: () => number = Math.random, page = "/u/<密钥>/"): Promise<string> {
  if (name === "food_page") return pageText(page); // 跟 remote.py 一样：在包错之前，这一只不会出错
  const a = asObj(a0);
  if (name === "food_note") {
    const dishes = asList(get(a, "dishes"))
      .filter((d) => d && typeof d === "object" && !Array.isArray(d) && pyStrip(pyStr(or(get(d, "name"), ""))))
      .map((d) => ({
        name: pyStrip(pyStr(get(d, "name"))),
        verdict: lookup(VIN, or(get(d, "verdict"), "")) ?? null,
        price: get(d, "price"),
        note: get(d, "note"),
      }));
    const shopRaw = or(get(a, "shop"), "");
    if (typeof shopRaw !== "string") throw new Error("'" + typeof shopRaw + "' object has no attribute 'strip'");
    const shop = pyStrip(shopRaw);
    const body: Record<string, any> = {
      meal: {
        eaten_on: get(a, "date"),
        slot: or(get(a, "slot"), "auto"),
        src: "chat",
        how: shop ? get(a, "how") : null,
        place: shop ? null : get(a, "place"),
        city: get(a, "city"),
        total: get(a, "total"),
        currency: get(a, "currency"),
        verdict: shop ? get(a, "verdict") : null,
        note: get(a, "note"),
      },
      dishes,
    };
    if (shop) {
      body.shop = { name: shop, cuisine: get(a, "cuisine") };
      body.branch = { city: or(get(a, "city"), null) ?? (await book.setting("city")), area: or(get(a, "area"), ""), platform: get(a, "platform") };
    }
    await book.log(body);
    const what = dishes.map((d) => d.name + (d.verdict ? `（${V[d.verdict]}）` : "")).join("、") || or(get(a, "note"), "");
    return `记下了：${shop || or(get(a, "place"), null) || "没写在哪"} · ${what}。Ta 在「吃了吗」页面上看得到。`;
  }
  if (name === "food_taste") {
    const items = asList(get(a, "items"))
      .map((x) => pyStrip(pyStr(x)))
      .filter((x) => x);
    if (pyStrip(pyStr(or(get(a, "item"), "")))) items.unshift(pyStrip(pyStr(get(a, "item"))));
    if (!items.length) return "（没写是哪一样）";
    const scope = pyStrip(pyStr(or(get(a, "scope"), "")));
    const kindArg = get(a, "kind");
    if (kindArg === "拿掉" || kindArg === "删" || kindArg === "delete") {
      const have = (await book.all()).taste;
      const said: string[] = [];
      for (const item of items) {
        const hit = have.filter(
          (t) => pyStrip(t.item).toLowerCase() === item.toLowerCase() && pyStrip(t.scope || "").toLowerCase() === scope.toLowerCase(),
        );
        if (hit.length) await book.delete("taste", hit[0].id);
        said.push(hit.length ? `拿掉了「${tname(hit[0])}」` : `单子上本来就没有「${item}」`);
      }
      return said.join("；") + "。";
    }
    const said: string[] = [];
    for (const item of items) {
      const r = await book.taste(item, kindArg, get(a, "note"), "chat", scope, get(a, "away"));
      const kind = lookup(TKIN, kindArg)!;
      const nm = tname({ item, scope, kind });
      said.push(r.moved ? `「${nm}」挪到${TK[kind]}` : `${TK[kind]} · ${nm}` + (pyTruthy(get(a, "away")) ? "（现在吃不到）" : ""));
    }
    return "记上了：" + said.join("；") + "。";
  }
  if (name === "food_dice") {
    return dice.text(dice.roll(await book.all(), or(get(a, "mode"), "dish"), or(get(a, "kind"), ""), or(get(a, "want"), ""), rng));
  }
  if (name === "food_rate") {
    const r = await book.rate(or(get(a, "dish"), ""), get(a, "verdict"), get(a, "note"), or(get(a, "shop"), ""), or(get(a, "date"), ""));
    const m = r.meal;
    const vk = lookup(VIN, or(get(a, "verdict"), "")); // 原样查（不去空白），跟 mcp_server.py 一样
    const said = (vk && V[vk]) || "那一句记上了";
    return (
      `改好了：${m.eaten_on.slice(5)} ${m.slot || ""} ${r.name || "这一顿整体"} → ${said}。` +
      (r.wave ? ` 这道${r.wave}，以后推荐它先提醒 Ta。` : "")
    );
  }
  if (name === "food_book") {
    return book.bookText(or(get(a, "view"), ""), or(get(a, "city"), ""), or(get(a, "q"), ""), or(get(a, "days"), 7));
  }
  return "（没有这只手）";
}

/** MCP 的 tools/call 那一层：出错也回一段话，别让一只手卡死整个连接 */
export async function callText(book: Book, name: string, a: unknown, rng?: () => number, page?: string): Promise<string> {
  try {
    return await call(book, name, a, rng, page);
  } catch (e) {
    if (e instanceof Bad) return "（没记上：" + e.message + "）";
    return "（本子没翻开：" + String(e instanceof Error ? e.message : e).slice(0, 200) + "）";
  }
}
