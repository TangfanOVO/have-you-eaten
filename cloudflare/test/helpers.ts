import type { Clock } from "../src/clock";
import { ensureSchema } from "../src/core";

export const SECRET = "test-secret-0123456789abcdef";

/** 一串固定的随机数，吐完从头再来（跟 scripts/conformance.py 的 Scripted 一样） */
export function seqRng(seq: number[] | undefined | null): () => number {
  const s = seq && seq.length ? seq : [0.5];
  let i = 0;
  return () => s[i++ % s.length];
}

/** 可以拨的钟 */
export function movableClock(nowUtc: string, tz: string): Clock & { set(nowUtc: string, tz: string): void } {
  let t = new Date(nowUtc).getTime();
  let z = tz;
  return {
    now: () => new Date(t),
    get tz() {
      return z;
    },
    set(n: string, zz: string) {
      t = new Date(n).getTime();
      z = zz;
    },
  };
}

export async function wipe(db: D1Database): Promise<void> {
  await ensureSchema(db);
  await db.batch(
    ["DELETE FROM dish_log", "DELETE FROM meal", "DELETE FROM dish", "DELETE FROM branch", "DELETE FROM shop", "DELETE FROM taste", "DELETE FROM setting"].map(
      (s) => db.prepare(s),
    ),
  );
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Python 的 fmt_w：整数写成整数，别的照最短的写法 */
export function fmtW(w: number): string {
  return Number.isInteger(w) ? String(w) : String(w);
}
