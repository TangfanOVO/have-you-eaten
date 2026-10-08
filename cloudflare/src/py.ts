// 吃了吗 · Cloudflare 版 —— 让 TypeScript 跟 Python 那份说同一种话的小工具。
// core.py / dice.py 里用到的 Python 习惯（strip 认哪些空白、bool() 怎么算真、round 怎么进位、
// 切片按字算），在这儿一样一样照着做，免得两边记出来的东西差一个字。

/** 给人看的一句话（core.Bad）。网页回 400，MCP 回「（没记上：…）」。 */
export class Bad extends Error {}

/** Python 那边会抛 TypeError / ValueError 的地方（网页回 500）。 */
export class PyError extends Error {}

// Python str.isspace() 认的空白（strip() 去的就是这些）
const PY_WS = new Set(
  "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000",
);

export function pyStrip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && PY_WS.has(s[a])) a++;
  while (b > a && PY_WS.has(s[b - 1])) b--;
  return s.slice(a, b);
}

/** str(v)：None → "None"，True → "True"，数字照常 */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "nan";
    if (v === Infinity) return "inf";
    if (v === -Infinity) return "-inf";
    return String(v);
  }
  return JSON.stringify(v);
}

/** bool(v)：空串、0、空列表、空对象、None 都算假 */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** 按「字」数（码位），跟 Python 的 len() 一样 */
export function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** s[:n]，按码位切 */
export function cpSlice(s: string, n: number): string {
  if (s.length <= n) return s;
  let out = "";
  let i = 0;
  for (const ch of s) {
    if (i++ >= n) break;
    out += ch;
  }
  return out;
}

/** core._s：去两头空白、截到 n 个字；空的 → null */
export function _s(v: unknown, n = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = pyStrip(pyStr(v));
  return s ? cpSlice(s, n) : null;
}

/** int(v)：认整数、整数字符串（两头可以有空白、可以带 _），小数截掉；别的照 Python 报错 */
export function pyInt(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new PyError("cannot convert float to integer");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const t = pyStrip(v);
    if (/^[+-]?\d+(_\d+)*$/.test(t)) return parseInt(t.replace(/_/g, ""), 10);
    throw new PyError(`invalid literal for int() with base 10: '${v}'`);
  }
  throw new PyError("int() argument must be a string, a bytes-like object or a number");
}

/** float(str)：Python 认的写法（1_000、1e3、inf、nan…） */
export function pyFloat(s: string): number {
  const t = pyStrip(s);
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
  if (special) {
    if (special[2].toLowerCase() === "nan") return NaN;
    return special[1] === "-" ? -Infinity : Infinity;
  }
  const D = "\\d(?:_?\\d)*";
  const re = new RegExp(`^[+-]?(?:${D}(?:\\.(?:${D})?)?|\\.${D})(?:[eE][+-]?${D})?$`);
  if (!re.test(t)) throw new PyError(`could not convert string to float: '${s}'`);
  return Number(t.replace(/_/g, ""));
}

function incDecimal(digits: string): string {
  // 十进制数字串 +1（只有数字）
  const a = digits.split("");
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === "9") {
      a[i] = "0";
      i--;
    } else {
      a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1);
      return a.join("");
    }
  }
  return "1" + a.join("");
}

/** f"{x:.{nd}f}"：按二进制里的精确值、逢五取偶（Python 的 round / format 都是这样） */
export function pyFixed(x: number, nd: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const exact = Math.abs(x).toFixed(100); // 双精度数在这个量级上，100 位小数就是它的精确值
  const [ip, fp] = exact.split(".");
  let digits = ip + fp.slice(0, nd);
  const rest = fp.slice(nd);
  const first = rest[0];
  let up = false;
  if (first > "5") up = true;
  else if (first === "5") up = /[1-9]/.test(rest.slice(1)) || Number(digits[digits.length - 1]) % 2 === 1;
  if (up) digits = incDecimal(digits);
  const whole = nd ? digits.slice(0, digits.length - nd) || "0" : digits;
  const frac = nd ? digits.slice(digits.length - nd) : "";
  return (neg ? "-" : "") + whole + (nd ? "." + frac : "");
}

/** round(x, nd) */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x)) return x;
  return Number(pyFixed(x, nd));
}

/** Python 的 random.choices(population, weights)[0]：累加权重、random()*总数、bisect_right。
 *  rng 传进来同一串数，两边丢出来的就是同一个。 */
export function choice<T>(pop: T[], weights: number[], rng: () => number): T {
  const cum: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    cum.push(acc);
  }
  const total = cum[cum.length - 1] + 0.0;
  if (!(total > 0)) throw new PyError("Total of weights must be greater than zero");
  const x = rng() * total;
  let lo = 0;
  let hi = pop.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return pop[lo];
}

/** SQLite 的 lower(trim(x))：trim 只去半角空格，lower 只管 ASCII */
export function sqlKey(s: string): string {
  return s.replace(/^ +| +$/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** 比两个元组（Python 的 tuple 比较） */
export function cmpTuple(a: (string | number)[], b: (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/** dict.get(k) 的安全版：用户写的 key 不会撞到 Object 原型上的东西 */
export function lookup<V>(m: Map<string, V>, k: unknown): V | undefined {
  return typeof k === "string" ? m.get(k) : undefined;
}

/** b.get("shop") or {}：空的给 {}；是对象就用；别的照 Python 报错 */
export function asObj(v: unknown): Record<string, any> {
  if (!pyTruthy(v)) return {};
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  throw new PyError("'" + typeof v + "' object has no attribute 'get'");
}

export function asList(v: unknown): any[] {
  if (!pyTruthy(v)) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  throw new PyError("object is not iterable");
}
