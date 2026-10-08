// 几点了、今天是哪天。
// Python 那份按「电脑在哪」算；Worker 没有「本机时区」，所以用 HYE_TZ（wrangler.toml 里设，默认上海）。
// 时钟可以换（测试里钉死一个时刻），跟 Python 那边钉死的同一刻对得上。

export interface Clock {
  /** 现在这一刻（UTC 时刻） */
  now(): Date;
  /** IANA 时区名，比如 Asia/Shanghai、Australia/Sydney */
  tz: string;
}

export const DEFAULT_TZ = "Asia/Shanghai";
export const DAY_STARTS = 5; // 一天从凌晨 5 点算起：熬到两三点补记的那顿还算昨天（跟 core.py 一样）

export function validTz(tz: string | undefined): string {
  const t = (tz || "").trim();
  if (!t) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t });
    return t;
  } catch {
    console.warn(`HYE_TZ=${t} 不认得，按 UTC 算`);
    return "UTC";
  }
}

export function systemClock(tz?: string): Clock {
  const z = validTz(tz);
  return { now: () => new Date(), tz: z };
}

export function fixedClock(isoUtc: string, tz: string): Clock {
  const t = new Date(isoUtc);
  return { now: () => new Date(t.getTime()), tz };
}

export interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const FMT = new Map<string, Intl.DateTimeFormat>();

/** 这一刻在那个时区的墙上时间（不带时区的「本地时间」，像 Python 的 datetime.now()） */
export function wall(c: Clock): Wall {
  let f = FMT.get(c.tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: c.tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FMT.set(c.tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(c.now())) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second };
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function isoOf(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** core.today()：本地时间往回拨 5 个钟头那天（墙上时间直接减，跟 Python 的 naive datetime 一样） */
export function today(c: Clock): string {
  const w = wall(c);
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - DAY_STARTS * 3600e3);
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function localHour(c: Clock): number {
  return wall(c).h;
}

/** date.fromisoformat（Python 3.9：只认 YYYY-MM-DD） */
export function parseIsoDate(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(2000, mo, 0)).getUTCDate(); // 2000 是闰年，二月先给 29
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (d > (mo === 2 ? (leap ? 29 : 28) : dim)) return null;
  return s;
}

/** 周几：Python 的 weekday() 周一＝0 */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  return (t.getUTCDay() + 6) % 7;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  t.setUTCDate(t.getUTCDate() + n);
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** datetime.fromisoformat（Python 3.9 认的那几种），当成 UTC 的毫秒数。带时区的返回 null（Python 那边相减会报错，那一行就不出）。 */
export function parseNaiveUtc(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[\s\S](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{3}|\d{6}))?)?)?)?$/.exec(s);
  if (!m || !parseIsoDate(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  const h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0;
  const se = m[6] ? +m[6] : 0;
  if (h > 23 || mi > 59 || se > 59) return null;
  const ms = m[7] ? Math.floor(Number("0." + m[7]) * 1000) : 0;
  const t = new Date(Date.UTC(2000, +m[2] - 1, +m[3], h, mi, se, ms));
  t.setUTCFullYear(+m[1]);
  return t.getTime();
}
