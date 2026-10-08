// 吃了吗 · have-you-eaten —— Cloudflare Worker 入口。路由和全部的事在 app.ts。
import { handle, type Env } from "./app";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Env>;
