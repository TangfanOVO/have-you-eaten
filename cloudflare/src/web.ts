// 网页：上一层 web/ 原样抄来的那一页，发出去之前把从根开始的地址换成相对的，让它挂在 /u/<密钥>/ 底下也能用。
//   ① index.html 里 href="/…"、src="/…"、s.src = '/app.js' → 相对路径（跟着这一页走）
//   ② manifest.webmanifest 里图标的 "/icon-192.png" → 相对路径（相对 manifest 自己）
//   ③ 塞一小段：app.js 里 fetch('/api/…') 这种从根开始的地址，改成相对这一页的（/u/<密钥>/api/…）
// 上一层要是把这些地址本来就写成相对的，这几处就都不用换了（见 README「给上一层的一个小建议」）。
import { WEB } from "./generated/assets";

const SHIM =
  '<meta name="referrer" content="no-referrer">\n' +
  "<script>/* 吃了吗 · Cloudflare 版：这一页在 /u/密钥/ 底下，从根开始的地址改成相对这一页的 */\n" +
  "(function(){var f=window.fetch;window.fetch=function(u,o){if(typeof u==='string'&&u.charAt(0)==='/'&&u.charAt(1)!=='/')u=u.slice(1);return f.call(this,u,o);};})();</script>\n";

export const INDEX_HTML = WEB["index.html"].body;

/** href="/x"、src="/x"、src = '/x'：从根开始（不是 //别的网站）的，去掉开头那一杠 */
export function patchIndex(html: string): string {
  if (!html.includes("</head>")) throw new Error("index.html 里找不到 </head>，src/web.ts 要跟着改");
  const out = html.replace(/(\b(?:href|src)\s*=\s*["'])\/(?!\/)/g, "$1").replace("</head>", SHIM + "</head>");
  if (/\b(?:href|src)\s*=\s*["']\/(?!\/)/.test(out)) throw new Error("index.html 里还有从根开始的地址");
  return out;
}

/** manifest 里的 src / start_url / scope 从根开始的，换成相对的（相对 manifest 自己那个地址） */
export function patchManifest(text: string): string {
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          k,
          (k === "src" || k === "start_url" || k === "scope") && typeof x === "string" && /^\/(?!\/)/.test(x) ? x.slice(1) || "./" : fix(x),
        ]),
      );
    }
    return v;
  };
  return JSON.stringify(fix(JSON.parse(text)), null, 2);
}

export interface Asset {
  type: string;
  body: () => string | Uint8Array;
}

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function once<T>(f: () => T): () => T {
  let v: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      v = f();
      done = true;
    }
    return v as T;
  };
}

export const STATIC: Record<string, Asset> = {};
for (const [name, f] of Object.entries(WEB)) {
  let body: () => string | Uint8Array;
  if (name === "index.html") body = once(() => patchIndex(f.body));
  else if (name.endsWith(".webmanifest")) body = once(() => patchManifest(f.body));
  else if (f.base64) body = once(() => b64(f.body));
  else body = () => f.body;
  STATIC[name] = { type: f.type, body };
}
STATIC[""] = STATIC["index.html"];

// 搬家那一页：导出一份 / 把导出的那份倒回来。颜色跟本子那一页同一套。
export const MOVE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>吃了吗 · 搬家</title>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<style>
:root{--bg:#f4f1ec;--card:#fffdfa;--ink:#2b2724;--sub:#6e665f;--line:#e4ded6;--maple:#a84b33;--on-maple:#fff;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#1a1714;--card:#24201c;--ink:#f1ebe3;--sub:#b8ab9c;--line:rgba(255,240,225,.10);--maple:#e0a373;--on-maple:#2b2724;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
main{max-width:520px;margin:0 auto;padding:28px 16px 40px}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--sub);font-size:14px;margin:0 0 22px}
section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px}
h2{font-size:16px;margin:0 0 6px}
p{margin:0 0 12px;color:var(--sub);font-size:14px}
a.btn,button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:12px;border:0;
  background:var(--maple);color:var(--on-maple);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
input[type=file]{display:block;width:100%;margin:0 0 12px;font:inherit;color:var(--ink)}
label{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--sub);margin:0 0 14px}
#out{white-space:pre-wrap;font-size:14px;margin-top:12px}
.back{color:var(--maple);font-size:14px}
</style>
</head>
<body>
<main>
<h1>搬家</h1>
<p class="sub">把整本本子存成一个文件，或者把存好的文件倒回来。电脑上那份「吃了吗」导出的也认。</p>
<section>
<h2>导出</h2>
<p>店、分店、每一顿、每道菜、口味单、你在哪座城，全在一个 .json 文件里。时不时存一份，心里踏实。</p>
<a class="btn" id="exp" href="#">存一份到这台设备</a>
</section>
<section>
<h2>导入</h2>
<p>只往空本子里倒。本子里已经有东西了，要整本换掉，勾上下面那一格（换之前先导出一份留着）。</p>
<input type="file" id="file" accept="application/json,.json">
<label><input type="checkbox" id="force"> 整本换掉：本子里现在的东西全部删掉，换成这份</label>
<button id="go" disabled>导入</button>
<div id="out" role="status" aria-live="polite"></div>
</section>
<a class="back" href="./">← 回本子</a>
</main>
<script>
(function(){
  var base = location.pathname.replace(/\\/[^\\/]*$/, '');            // /u/<密钥>
  document.getElementById('exp').href = base.replace(/^\\/u\\//, '/mcp/') + '/export';
  var file = document.getElementById('file'), go = document.getElementById('go'), out = document.getElementById('out');
  file.addEventListener('change', function(){ go.disabled = !file.files.length; out.textContent = ''; });
  go.addEventListener('click', function(){
    var f = file.files[0]; if (!f) return;
    go.disabled = true; out.textContent = '倒进去…';
    f.text().then(function(t){
      return fetch('api/import' + (document.getElementById('force').checked ? '?force=1' : ''),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: t });
    }).then(function(r){ return r.json(); }).then(function(j){
      if (!j.ok) throw new Error(j.err || '没导进去');
      var c = j.counts || {};
      out.textContent = (j.replaced ? '换好了。' : '倒好了。') + '店 ' + (c.shops||0) + ' 家、分店 ' + (c.branches||0) + ' 家、' +
        (c.meals||0) + ' 顿、菜 ' + (c.dishes||0) + ' 道、吃过的记录 ' + (c.logs||0) + ' 条、口味单 ' + (c.taste||0) + ' 条。';
    }).catch(function(e){ out.textContent = e.message; }).then(function(){ go.disabled = !file.files.length; });
  });
})();
</script>
</body>
</html>
`;

STATIC["move"] = { type: "text/html; charset=utf-8", body: () => MOVE_HTML };
