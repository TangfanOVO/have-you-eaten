// MCP（Streamable HTTP，2025-06-18）：claude.ai 的「自定义连接器」连的就是这儿。
// 只做最小的那一份：POST 一条 JSON-RPC，回一条 JSON。不开会话、不推消息（GET 回 405）。
import type { Book } from "./core";
import { ANNOTATIONS, TOOLS, callText } from "./tools";

export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "have-you-eaten", title: "吃了吗", version: "0.2.1" }; // 跟上一层 manifest.json 的 version 一样（npm run conformance 会对）

// claude.ai 会把这段交给模型：不用自己去写项目说明也知道什么时候用哪只手（跟 README「告诉 Ta 有这本本子」那段一个意思）
export const INSTRUCTIONS =
  "这是「吃了吗」：Ta（跟你说话的那个人）的吃饭本子。Ta 跟你说吃了什么，用 food_note 记下来（Ta 没说好不好吃就别替 Ta 打分）；" +
  "Ta 说爱吃 / 不吃 / 过敏什么，用 food_taste。推荐吃的、帮 Ta 挑外卖之前，先用 food_book 翻一下，别凭印象说店名。" +
  "Ta 纠结吃什么、让你帮着挑的时候，用 food_dice 丢一个。先记了、吃完才说好不好吃，用 food_rate 改到那一顿上，别再记一顿。" +
  "Ta 想看本子、要链接，用 food_page。";

type Json = Record<string, any>;

function tools(): Json[] {
  return TOOLS.map((t) => ({ ...t, annotations: ANNOTATIONS[t.name] }));
}

/** 处理一条消息。通知（没有 id）返回 null。 */
export async function handleRpc(book: Book, msg: unknown, rng?: () => number, page?: string): Promise<Json | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || (msg as Json).jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const m = msg as Json;
  const id = m.id;
  const method = m.method;
  if (id === undefined || id === null) return null; // 通知（notifications/initialized 之类）：收下就行
  if (method === undefined && ("result" in m || "error" in m)) return null; // 对面回的结果：收下就行
  if (typeof method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
  const p: Json = m.params && typeof m.params === "object" ? m.params : {};
  const ok = (result: Json) => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize": {
      const want = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: tools() });
    case "tools/call": {
      const text = await callText(book, String(p.name ?? ""), p.arguments ?? {}, rng, page);
      return ok({ content: [{ type: "text", text }] });
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } };
  }
}

const JSONH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export async function handleMcp(req: Request, book: Book, rng?: () => number, page?: string): Promise<Response> {
  if (req.method === "GET" || req.method === "DELETE") {
    // 不推消息、不开会话（规范允许：GET 回 405）
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const pv = req.headers.get("MCP-Protocol-Version");
  if (pv && !PROTOCOLS.includes(pv)) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unsupported MCP-Protocol-Version: " + pv } }), {
      status: 400,
      headers: JSONH,
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), {
      status: 400,
      headers: JSONH,
    });
  }
  // 老一点的客户端（2025-03-26）可能一次发一串
  if (Array.isArray(body)) {
    const out: Json[] = [];
    for (const x of body) {
      const r = await handleRpc(book, x, rng, page); // 一条一条来：同一本本子，别让两笔写撞在一起
      if (r !== null) out.push(r);
    }
    return out.length ? new Response(JSON.stringify(out), { headers: JSONH }) : new Response(null, { status: 202 });
  }
  const r = await handleRpc(book, body, rng, page);
  if (r === null) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(r), { headers: JSONH });
}
