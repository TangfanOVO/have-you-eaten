import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// 测试跑在本机的 Workers 运行时里（Miniflare），D1 是本机的一个 SQLite 文件：不连 Cloudflare、不要账号。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: { bindings: { HYE_SECRET: "test-secret-0123456789abcdef", HYE_TZ: "Australia/Sydney" } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
