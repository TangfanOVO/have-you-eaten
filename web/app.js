/* 吃了吗 / 吃过的 —— 一份代码两处用。
     开源那份（have-you-eaten/web/app.js）：index.html 先设 window.FOOD_STANDALONE = true，一进来就是这一页。
     家里那份（web/food/mount.js）：连环首页请进来，挂成一张二级页 #foodpage，抽屉和「记事」那格推开它。
   页：#foodpage 首页（今天 · 店 · 口味）
       #foodhist 更早的每一天 · #foodshop 一家店 · #foodmeal 一顿 · #foodnew 记一笔（从底下升上来） · #foodcities 看哪座城
   规矩：看和改分开 —— 看的时候什么都点不坏；改要先点「编辑」，改了就存，点「完成」出来。
        首页只答最常问的三件事：今天吃了没、这座城别点什么、我的口味。记一笔和搜索在拇指够得着的底下。
        不算热量。颜色只走 --bg --card --card2 --ink --sub --line --maple --maple-soft --on-maple 这几个变量。 */
(function () {
  'use strict';
  if (window.__foodUI) return;
  window.__foodUI = 1;

  var SOLO = !!window.FOOD_STANDALONE;
  var TITLE = SOLO ? '吃了吗' : '吃过的';
  var V = { good: '好吃', meh: '一般', bad: '踩雷' };
  var SLOTS = ['早饭', '午饭', '加餐', '晚饭', '夜宵', '纯记录'];   // 排序用；加餐页面上不给了，认旧的
  var PICK = ['早饭', '午饭', '晚饭', '夜宵', '纯记录'];            // 给人点的；纯记录不算哪一顿
  var TK = { never: '不能吃', hate: '不爱吃', love: '爱吃' };
  var TORDER = ['never', 'hate', 'love'];                            // 不能吃最要紧，排最前
  var AU = /悉尼|墨尔本|阿德莱德|布里斯班|珀斯|堪培拉|霍巴特|达尔文|黄金海岸|凯恩斯|sydney|melbourne|adelaide|brisbane|perth|canberra|hobart|darwin/i;
  var PLATS = ['美团', '饿了么', 'Uber Eats', 'DoorDash', 'Menulog', 'HungryPanda'];
  var CUR = { CNY: '¥', AUD: 'A$', USD: '$', GBP: '£', EUR: '€', JPY: 'JP¥' }, CURS = Object.keys(CUR);
  var IC = {
    back: '<path d="M5 12l14 0"/><path d="M5 12l6 6"/><path d="M5 12l6 -6"/>',
    close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
    chev: '<path d="M9 6l6 6l-6 6"/>',
    down: '<path d="M6 9l6 6l6 -6"/>',
    search: '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
    good: '<path d="M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3"/>',
    bad: '<path d="M7 13v-8a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v7a1 1 0 0 0 1 1h3a4 4 0 0 1 4 4v1a2 2 0 0 0 4 0v-5h3a2 2 0 0 0 2 -2l-1 -5a2 3 0 0 0 -2 -2h-7a3 3 0 0 0 -3 3"/>',
    meh: '<path d="M6 12l12 0"/>',
    check: '<path d="M5 12l5 5l10 -10"/>',
    dice: '<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M8.5 8.5l.01 0"/><path d="M15.5 15.5l.01 0"/><path d="M12 12l.01 0"/><path d="M15.5 8.5l.01 0"/><path d="M8.5 15.5l.01 0"/>',
    cam: '<path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"/><path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>'
  };

  function fl(label, input) { return '<label class="fd-fl" style="--fl:' + (label.length * 13 + 26) + 'px"><span>' + label + '</span>' + input + '</label>'; }
  function svg(k, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" aria-hidden="true">' + IC[k] + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function low(s) { return String(s || '').trim().toLowerCase(); }
  function say(m) { try { if (typeof window.toast === 'function') window.toast(m); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function money(v, cur) {
    if (v == null || v === '') return '';
    return (CUR[cur] || '¥') + (Math.round(Number(v) * 100) / 100).toFixed(2).replace(/\.00$/, '');
  }
  function curFor(city) { return city && AU.test(city) ? 'AUD' : 'CNY'; }
  function dayName(iso, today) {
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var s = (+p[1]) + '月' + (+p[2]) + '日 · 周' + '日一二三四五六'[d.getDay()];
    if (today) {
      var t = today.split('-'), diff = Math.round((new Date(+t[0], +t[1] - 1, +t[2]) - d) / 864e5);
      if (diff === 0) return '今天 · ' + s;
      if (diff === 1) return '昨天 · ' + s;
      if (diff === -1) return '明天 · ' + s;
    }
    return s;
  }
  function howName(h) { return h === '堂食' || h === '自取' ? '店里吃' : (h || ''); }   // 库里认旧词，页面上一种说法（第六轮）
  function short(iso) { var p = (iso || '').split('-'); return p.length === 3 ? (+p[1]) + '月' + (+p[2]) + '日' : ''; }
  function slotNow(back) {   // 多半是吃完才记：按一个钟头以前猜；从骰子来的是挑下一顿，按现在（第六轮）
    var h = (new Date().getHours() + 24 - (back == null ? 1 : back)) % 24;
    return h >= 5 && h < 10 ? '早饭' : h >= 10 && h < 16 ? '午饭' : h >= 16 && h < 22 ? '晚饭' : '夜宵';
  }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
      .catch(function () { throw new Error('连不上，等一下再试'); })   // 断网：不把 Failed to fetch 原样漏出来
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.err || ('出错了 ' + r.status)); return j; }); });
  }

  /* ───────── 样子 ───────── */
  var css = document.createElement('style');
  css.id = 'food-ui-css';
  css.textContent = [
    '.fdp [hidden]{display:none!important}',
    '.fdp ::selection{background:var(--maple-soft)}',
    '.fdp ::placeholder{color:var(--sub);opacity:1}',
    '.fdp:not(.on){pointer-events:none}',
    '.fdp input,.fdp textarea{caret-color:var(--maple)}',
    '.fdp button:focus-visible,.fdp input:focus-visible,.fdp textarea:focus-visible{outline:2px solid color-mix(in srgb,var(--maple) 55%,transparent);outline-offset:2px}',
    '.fdp svg.i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.fdp .subwrap{padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))}',
    '.fd-topbtn{width:auto!important;min-width:52px;padding:0 12px;font-family:inherit;font-size:14px}',
    /* 顶上三档：不跟着滚，一直在 */
    '.fd-segbar{flex:none;padding:0 16px 10px}',
    '.fd-seg{display:flex;gap:3px;padding:3px;background:var(--card2);border:1px solid var(--line);border-radius:14px}',
    '.fd-seg button{flex:1;min-height:44px;border:0;border-radius:11px;background:transparent;color:var(--sub);font-family:inherit;font-size:15px;cursor:pointer;transition:background .2s var(--e-out),color .2s var(--e-out)}',
    '.fd-seg button.on{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.10),0 0 0 1px var(--line)}',   /* 深色下也看得出选中的是哪档 */
    /* 一节：标题压得住，节和节之间留得开 */
    '.fd-sec{margin:4px 0 28px}',
    '.fd-sh{display:flex;align-items:center;gap:10px;min-height:44px;margin:0 2px 6px}',
    '.fd-sh h2{margin:0;font-size:20px;font-weight:650;color:var(--ink);letter-spacing:.01em}',
    '.fd-sh .meta{font-size:13.5px;color:var(--sub)}',
    '.fd-right{margin-left:auto}',
    '.fd-link{border:0;background:none;color:var(--maple);font-family:inherit;font-size:14.5px;min-height:44px;min-width:44px;padding:0 4px;cursor:pointer;white-space:nowrap}',
    '.fd-city{display:inline-flex;align-items:center;gap:2px;min-height:34px;padding:0 8px 0 12px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--ink);font-family:inherit;font-size:14px;cursor:pointer}',
    '.fd-city svg.i{width:15px;height:15px}',
    '.fd-city{position:relative}.fd-city::after{content:"";position:absolute;inset:-5px 0}',
    '.fd-empty{margin:0 2px;padding:4px 0;font-size:14.5px;line-height:1.7;color:var(--sub)}',
    /* 列表：一节一张，行和行之间细线 */
    '.fd-list{background:var(--card);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden}',
    '.fd-row{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:11px 14px;border:0;background:none;color:var(--ink);font-family:inherit;text-align:left;cursor:pointer}',
    '.fd-row + .fd-row,.fd-row + .fd-te,.fd-te + .fd-row,.fd-baddr + .fd-row{border-top:1px solid var(--line)}',
    'button.fd-row:active{background:color-mix(in srgb,var(--ink) 5%,transparent)}',
    'div.fd-row{cursor:default}',
    '.fd-slot{flex:none;width:3.2em;font-size:13.5px;color:var(--sub)}',
    '.fd-main{flex:1;min-width:0}',
    '.fd-main .t{display:block;font-size:15.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fd-main .s{display:block;margin-top:2px;font-size:13.5px;line-height:1.5;color:var(--sub)}',
    '.fd-amt{flex:none;font-size:14px;color:var(--sub);font-variant-numeric:tabular-nums}',
    '.fd-chev{flex:none;width:16px;height:16px;fill:none;stroke:var(--sub);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.fd-tag{flex:none;font-size:13px;color:var(--sub);border:1px solid var(--line);border-radius:999px;padding:3px 9px;white-space:nowrap}',
    /* 踩雷一眼找得到：墨底反白；好吃墨字；一般灰字（枫红只给强调，不拿来标雷，DESIGN §1） */
    '.fd-tag.bad{background:transparent;border:1.5px solid var(--ink);color:var(--ink);font-weight:700}',   /* 描粗边：一眼找得到，深色里也不刺眼（复查：墨底在深色里是全屏最亮的一块） */
    '.fd-vw{font-weight:500;color:var(--ink)}',
    '.fd-vw.meh{font-weight:400;color:inherit}',
    '.fd-vw.bad{font-weight:700;color:var(--ink)}',
    '.fd-gh{margin:18px 2px 8px;font-size:14px;font-weight:600;color:var(--sub)}',
    '.fd-gh:first-child{margin-top:4px}',
    '.fd-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 14px}',
    '.fdp .chips .chip,.fd-filter .chip{min-height:44px;padding:0 15px;font-size:14px}',
    /* 口味：只读的时候是一样一样摆开 */
    '.fd-tg{margin:0 0 20px}',
    '.fd-tg h3{margin:0 2px 10px;font-size:13.5px;font-weight:600;color:var(--sub);letter-spacing:.06em}',   /* 小分组：小一号、灰一点，跟 20px 的节标题、15.5px 的条目拉开（1008 复查：层级太平） */
    '.fd-cloud{display:flex;flex-wrap:wrap;gap:8px}',
    /* 只读的小块：平的、不带阴影，别像能点的按钮。不能吃、不爱吃、爱吃都是口味，一个样子（1008 她：不能吃不用描边） */
    '.fd-chip{display:inline-flex;align-items:baseline;gap:6px;padding:8px 12px;border-radius:12px;background:var(--card2);border:1px solid var(--line);font-size:15px;line-height:1.3;color:var(--ink)}',
    '.fd-chip small{font-size:12.5px;color:var(--sub)}',
    /* 1008 她：「删」要像个按钮，不然整页太平。圆角小块，点第一下变枫红底 */
    '.fd-del{position:relative;flex:none;width:60px;min-height:36px;padding:0;border:1px solid var(--line);border-radius:999px;background:var(--card2);color:var(--ink);font-family:inherit;font-size:14px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}',
    '.fd-del::after{content:"";position:absolute;inset:-4px -2px}',
    '.fd-del:active{transform:scale(.96)}',
    '.fd-del.armed{background-color:var(--maple);border-color:var(--maple);color:var(--on-maple);background-image:linear-gradient(var(--on-maple),var(--on-maple));background-repeat:no-repeat;background-position:50% calc(100% - 5px);background-size:60% 2px;animation:fdcount 3s linear forwards}',
    '@keyframes fdcount{to{background-size:0 2px}}',
    '.fd-te{padding:4px 14px 14px;background:var(--card2)}',
    '.fd-trow{cursor:pointer!important}',
    '.fd-tbtn:active{background:color-mix(in srgb,var(--ink) 5%,transparent)}',
    '.fd-te .chips{margin:0 0 8px;padding:0;margin-left:0;margin-right:0}',
    /* 底下：拇指够得着 */
    '.fd-dock{flex:none;display:flex;align-items:center;gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}',
    '.fd-dock.col{flex-direction:column;align-items:stretch;gap:8px}',
    '.fd-search{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:48px;padding:0 6px 0 14px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--sub)}',
    '.fd-search input{flex:1;min-width:0;border:0;background:transparent;outline:none;color:var(--ink);font-family:inherit;font-size:16px}',
    '.fd-search input:focus-visible{outline:none}',
    '.fd-search input::-webkit-search-cancel-button{-webkit-appearance:none;display:none}',
    '.fd-search button{flex:none;width:44px;height:44px;border:0;background:none;color:var(--sub);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.fd-primary{flex:none;min-height:48px;padding:0 22px;border:0;border-radius:14px;background:var(--maple);color:var(--on-maple,#fff);font-family:inherit;font-size:16px;font-weight:600;cursor:pointer}',
    '.fd-primary:active{transform:scale(.97)}',
    '.fd-primary[disabled]{background:var(--card2);color:var(--sub);box-shadow:inset 0 0 0 1px var(--line);cursor:default}',   /* 「先选一档」是那一栏唯一的提示，得读得清（复查：透明度压到 2.4:1） */
    '.fd-wide{width:100%}',
    '.fd-btn{min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-family:inherit;font-size:14.5px;cursor:pointer}',
    '.fd-btn:active{transform:scale(.97)}',
    '.fd-acts{display:flex;flex-wrap:wrap;gap:8px}',
    '.fd-banner{margin:0 0 22px;padding:14px 14px 12px;border-radius:var(--r);background:var(--maple-soft)}',
    '.fd-banner p{margin:0 0 10px;font-size:15.5px;line-height:1.6;color:var(--ink)}',
    /* 一页的头：店名、一顿 */
    '.fd-head{margin:2px 2px 18px}',
    '.fd-head h2{margin:0 0 4px;font-size:21px;font-weight:650;color:var(--ink);line-height:1.3}',
    '.fd-head p{margin:0;font-size:14px;line-height:1.6;color:var(--sub)}',
    '.fd-note{margin:12px 2px 0;font-size:15px;line-height:1.7;color:var(--ink);white-space:pre-wrap;word-break:break-word}',
    '.fd-ph{display:block;width:100%;max-height:320px;object-fit:cover;border-radius:var(--r);margin:14px 0 0;background:var(--card2)}',
    '.fd-in{width:100%;box-sizing:border-box;min-height:44px;margin:0 0 8px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-family:inherit;font-size:16px;outline:none;-webkit-appearance:none;appearance:none}',
    '.fd-in:focus{border-color:color-mix(in srgb,var(--maple) 45%,var(--line))}',
    'textarea.fd-in{resize:vertical;line-height:1.55}',
    'input[type=date].fd-in{min-height:46px}',
    '.fd-pair{display:flex;gap:8px}',
    '.fd-baddr{padding:0 14px 6px}',
    '.fd-baddr .fd-in{margin:0 0 6px}',
    '.fd-pair > *{flex:1;min-width:0}',
    '.fd-err{margin:-2px 2px 10px;font-size:13.5px;color:var(--maple)}',
    /* 记一笔 */
    '#foodnew{transform:translateY(100%)}',
    '#foodnew.on{transform:none}',
    '.fd-fh{margin:20px 2px 10px;font-size:16px;font-weight:600;color:var(--ink)}',
    '.fd-fh:first-child{margin-top:6px}',
    '.fd-fs{margin:14px 2px 8px;font-size:14px;font-weight:600;color:var(--sub)}',
    '.fd-dish{position:relative;margin:0 0 10px;padding:12px;border-radius:var(--r);background:var(--card);box-shadow:var(--shadow)}',
    '.fd-dish .fd-in{background:var(--card2)}',
    '.fd-dish .fd-in.fdn{padding-right:44px}',
    '.fd-dish .fd-x{position:absolute;top:12px;right:12px;width:44px;height:44px;border:0;background:none;color:var(--sub);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.fd-vbig{display:flex;gap:8px;margin:0 0 8px}',
    '.fd-vbig button{flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--ink);font-family:inherit;font-size:15px;cursor:pointer}',
    '.fd-vbig button svg.i{width:17px;height:17px}',
    '.fd-vbig button.on{border-color:transparent;background:var(--maple-soft);color:var(--maple);font-weight:600}',
    '.fd-sum{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:52px;margin:16px 0 8px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:transparent;color:var(--ink);font-family:inherit;font-size:15px;text-align:left;cursor:pointer}',
    '.fd-sum .r{flex:none;display:flex;align-items:center;gap:4px;color:var(--sub);font-size:14px}',
    '.fd-sum .r svg.i{width:16px;height:16px;transition:transform .2s var(--e-out)}',
    '.fd-sum.open .r svg.i{transform:rotate(180deg)}',
    '.fd-cur{flex:none!important;width:64px;margin:0 0 8px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--ink);font-family:inherit;font-size:15px;cursor:pointer}',
    '.fd-photo{display:flex;align-items:center;gap:10px;margin:6px 0 4px}',
    '.fd-photo img{width:64px;height:64px;object-fit:cover;border-radius:10px}',
    '.fd-photo .fd-btn{display:inline-flex;align-items:center;gap:6px}',
    '.fd-photo svg.i{width:17px;height:17px}',
    /* 这顿吃什么：一张卡，丢出来的菜名最大 */
    '.fd-seg.sm{padding:2px;border-radius:12px}',
    '.fd-seg.sm button{position:relative;flex:none;min-height:36px;padding:0 12px;font-size:13.5px;border-radius:10px}',
    '.fd-seg.sm button::after{content:"";position:absolute;inset:-5px -2px}',   /* 看着 36，按得到 46 */
    /* 1008 她：卡片要固定大小，换档、丢出来、没丢都一样高，底下「别点」不许跟着跳。按最满的样子量的：菜名＋一行菜系＋两条提醒＋底栏 */
    '.fd-dice{display:flex;flex-direction:column;box-sizing:border-box;height:272px;overflow:hidden;padding:16px;border-radius:var(--r);background:var(--card);box-shadow:var(--shadow)}',
    '.fd-dice .fd-dfoot{margin-top:auto;padding-top:14px}',
    '.fd-dice-hint{margin:0 0 12px;font-size:14.5px;line-height:1.6;color:var(--sub)}',
    '.fd-dpick{display:block;width:100%;min-height:44px;margin:0;padding:0;border:0;background:none;color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
    'button.fd-dpick:active{opacity:.6}', 'div.fd-dpick{cursor:default}',   /* 菜名只是字，按钮在下面那排（第六轮：两颗按钮做同一件事） */
    '.fd-fl{position:relative;display:block;margin:0 0 8px}',   /* 格子里的小标签：填了字也看得出这一格是什么（第六轮） */
    '.fd-fl>span{position:absolute;left:13px;top:0;height:44px;display:flex;align-items:center;font-size:13px;color:var(--sub);pointer-events:none;z-index:1}',
    '.fd-fl>.fd-in{margin:0;padding-left:var(--fl,56px)}',
    '.fd-tch{width:15px;height:15px;margin-left:5px;vertical-align:-2px;color:var(--sub);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--e-out,ease-out)}',   /* 第七轮：原来是一坨黑三角，深色看不见 */
    '@media (max-width:359px){.fd-pair.fd-cs{flex-direction:column;gap:0}}',   /* 320 宽：城市、区各占一行，值不被挤掉 */
    '.fd-ferr{margin:-4px 2px 8px;font-size:13px;line-height:1.45;color:var(--maple)}', '.fd-nw{white-space:nowrap}', '.fd-tbtn[aria-expanded=true] .fd-tch{transform:rotate(180deg)}',
    '.fd-lrow{display:flex;gap:8px;align-items:flex-start}', '.fd-lrow>.fd-in{flex:1;min-width:0}', '.fd-lrow>.fd-del{margin-top:4px}', '.fd-lrow>.fd-btn{flex:none;min-height:44px}',
    '.fd-in[aria-invalid=true]{border-color:var(--maple)}',
    '#fdshopname{transition:opacity .18s var(--e-out,ease-out)}',
    '.fd-dname{display:flex;align-items:center;gap:6px;font-size:24px;font-weight:650;line-height:1.3;color:var(--ink);white-space:nowrap;overflow:hidden}',
    '.fd-dname b{font-weight:inherit;overflow:hidden;text-overflow:ellipsis}',
    '.fd-dname .fd-chev{width:20px;height:20px}',
    '.fd-dpick .fd-dmeta{display:block}',
    '.fd-dice.way .fd-dpick .fd-dmeta{white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;line-height:1.6}',   /* 一个方向没有提醒，例子多给两行 */
    '.fd-dice .fd-wait{height:31px;width:46%;border-radius:8px;background:var(--card2)}',
    '.fd-dmeta{margin-top:4px;font-size:14px;line-height:1.5;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fd-dnotes{margin:10px 0 0;font-size:14.5px;line-height:1.55;color:var(--ink);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',   /* 备注能换行：这句是要贴进外卖备注的，不能被省略号吃掉 */
    '.fd-dnotes span{display:block}',
    '.fd-dacts{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:10px}',   /* 菜名在上、按钮在下，空白留在中间 */
    '.fd-dacts + .fd-dfoot{margin-top:0;padding-top:10px}',
    '.fd-dacts .fd-btn{min-height:40px;font-size:14px;position:relative}',
    '.fd-dacts .fd-btn::after{content:"";position:absolute;inset:-2px 0}',
    '.fd-dfoot .fd-link{min-height:44px;font-size:13px;padding:0 2px}',
    '.fd-dfoot{display:flex;align-items:center;gap:10px}',
    '.fd-dfoot .meta{flex:1;min-width:0;font-size:13px;line-height:1.5;color:var(--sub)}',
    '.fd-dicebtn{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:7.6em;margin-left:auto;white-space:nowrap}',
    '.fd-dicebtn[aria-disabled=true]{opacity:.6}',
    '.fd-dicebtn svg.i{width:18px;height:18px}',
    '@keyframes fdroll{0%{transform:none}30%{transform:rotate(-1.5deg) scale(.985)}65%{transform:rotate(1deg)}100%{transform:none}}',
    '.fd-dice.roll{animation:fdroll .36s var(--e-out)}',
    '@media (prefers-reduced-motion:reduce){.fd-dice.roll{animation:none}}',
    /* 1008 交互专查：按下去要有反应，统一轻轻一按；焦点框别被列表裁掉；冒出来、收起来都有过渡 */
    '#fdmain{display:flow-root}',
    '.fdp :is(.chip,.fd-seg button,.fd-vbig button,.fd-sum,.fd-x,.fd-city,.fd-cur,.fd-search button,.fd-primary,.fd-btn,.fd-del,.fd-topbtn){transition-property:background-color,color,border-color,box-shadow,transform,opacity;transition-duration:.15s,.15s,.15s,.15s,.1s,.15s;transition-timing-function:var(--e-out,ease-out)}',
    '.fdp :is(.chip,.fd-seg button,.fd-vbig button,.fd-sum,.fd-x,.fd-city,.fd-cur,.fd-search button,.fd-primary,.fd-btn,.fd-del,.fd-topbtn):active{transform:scale(.96)}',
    '.fd-link{transition:opacity .1s}', '.fd-link:active{opacity:.55}',
    '.fd-list .fd-row:focus-visible,.fd-list button:focus-visible{outline-offset:-3px}',
    '.fd-trow{padding:0 14px 0 0}',
    '.fd-tbtn{flex:1;min-width:0;align-self:stretch;display:flex;flex-direction:column;justify-content:center;min-height:56px;padding:11px 0 11px 14px;border:0;background:none;color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
    '.fd-tbtn .t{display:block;font-size:15.5px;line-height:1.35}', '.fd-tbtn .s{display:block;margin-top:2px;font-size:13.5px;line-height:1.5;color:var(--sub)}',
    '@keyframes fdte{from{opacity:0;transform:translateY(-6px)}}',
    '.fd-te{animation:fdte .2s var(--e-out,ease-out)}',
    '#fdadd:not([hidden]),#fddock:not([hidden]){animation:fdte .2s var(--e-out,ease-out)}',
    '.fd-in:disabled{opacity:.6}',
    '#fnRecent:not([hidden]){min-height:56px}',
    '#fnMoreBox{display:flow-root}',   /* 外边距不跟上面折叠：展开收起最后一下不再顿 8px（1008 复查） */
    '#fnRecent .chip.hide{display:none}',
    '.fd-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '#foodcities{transform:translateY(100%)}', '#foodcities.on{transform:none}',
    '@media (prefers-reduced-motion:reduce){.fd-te{animation:none!important}}',
    '@keyframes fdfade{from{opacity:0}}',
    '.fd-fade{animation:fdfade .18s var(--e-out,ease-out) backwards;animation-delay:var(--m6d,0ms)}',   /* 换档只淡，不再每次横滑 14px */
    '@media (prefers-reduced-motion:reduce){.fd-fade{animation:none}}',
    '#fdqx:not([hidden]){animation:fdfade .15s var(--e-out,ease-out)}',
    '@media (prefers-reduced-motion:reduce){#fdqx{animation:none!important}}',
    '.fd-room{pointer-events:none}',
    '.fd-undo{position:fixed;left:16px;right:16px;margin:0 auto;width:fit-content;bottom:calc(150px + env(safe-area-inset-bottom,0px));z-index:9000;display:flex;align-items:center;gap:6px;max-width:calc(100vw - 32px);padding:6px 6px 6px 16px;border-radius:14px;background:var(--ink);color:var(--bg);box-shadow:0 8px 24px rgba(0,0,0,.2);font-size:14px;line-height:1.3;font-family:inherit;animation:fdte .2s var(--e-out,ease-out)}',
    '.fd-undo span{flex:1;min-width:0;white-space:normal;line-height:1.4}',
    '.fd-undo button{flex:none;min-height:44px;padding:0 14px;border:0;border-radius:10px;background:transparent;color:var(--bg);font-size:14px;font-weight:600;font-family:inherit;text-decoration:underline;cursor:pointer}',
    '.fd-te-k{display:flex;align-items:center;gap:8px;margin:0 0 8px}', '.fd-te-k > span{flex:none;font-size:13px;color:var(--sub)}',
    'select.fd-cur{appearance:none;-webkit-appearance:none;min-height:44px;text-align:center;text-align-last:center;padding:0 20px 0 6px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23998f86%27 stroke-width=%272.4%27 stroke-linecap=%27round%27%3E%3Cpath d=%27M6 9l6 6l6 -6%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 7px center}',   /* 带个小箭头，看得出能选 */
    '.fd-check{flex:none;width:18px;height:18px;fill:none;stroke:var(--maple);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}'
  ].join('\n');
  document.head.appendChild(css);

  /* ───────── 页 ───────── */
  var app, page, hist, shopP, mealP, form, citiesP;
  function top(id, title, opts) {
    opts = opts || {};
    var left = opts.noBack ? (opts.spacer ? '<span style="flex:none;width:52px" aria-hidden="true"></span>' : '') :   /* 右边有按钮时左边垫一样宽，标题一直在正中 */ '<button class="iconbtn" data-close="' + id + '" aria-label="' + (opts.closeX ? '关上' : '返回') + '">' + svg(opts.closeX ? 'close' : 'back') + '</button>';
    return '<div class="top">' + left + '<div class="stamp" role="heading" aria-level="1">' + title + '</div>' + (opts.right || '') + '</div>';
  }
  function sub(id) { var el = document.createElement('div'); el.className = 'sub fdp'; el.id = id; return el; }
  function build() {
    app = document.getElementById('app');
    if (!app || $('foodpage')) return false;
    page = sub('foodpage');
    page.innerHTML = top('foodpage', TITLE, { noBack: SOLO, spacer: SOLO, right: '<button class="iconbtn fd-topbtn" id="fdtopdone" data-tedit style="visibility:hidden" tabindex="-1" aria-hidden="true">完成</button>' }) +   /* 改口味的「完成」也放在顶上，滚到底也找得到 */
      '<div class="fd-segbar"><div class="fd-seg">' +
      '<button data-v="today">今天</button><button data-v="shops">店</button><button data-v="taste">口味</button></div></div>' +
      '<div class="subwrap"><div id="fdmain"><p class="fd-empty">翻一下…</p></div><div class="fd-live" id="fdlive" aria-live="polite"></div></div>' +
      '<div class="fd-dock" id="fddock"><label class="fd-search">' + svg('search') +
      '<input id="fdq" type="search" placeholder="找店、找菜" autocomplete="off" enterkeyhint="search">' +
      '<button id="fdqx" aria-label="清掉" hidden>' + svg('close') + '</button></label>' +
      '<button class="fd-primary" id="foodadd">记一笔</button></div>' +
      '<div class="fd-dock col" id="fdadd" hidden><div class="fd-pair"><input class="fd-in" id="fdaddin" placeholder="写一样" autocomplete="off" style="margin:0;flex:3">' +
      '<input class="fd-in" id="fdaddnote" placeholder="备注" autocomplete="off" style="margin:0;flex:2"></div>' +
      '<div class="fd-pair" style="align-items:center"><div class="fd-seg" id="fdaddk">' +
      TORDER.map(function (k) { return '<button data-addk="' + k + '">' + TK[k] + '</button>'; }).join('') +
      '</div><button class="fd-primary" id="fdaddgo" style="flex:none">加</button></div></div>';
    hist = sub('foodhist');
    hist.innerHTML = top('foodhist', '更早', { right: '<span style="flex:none;width:44px" aria-hidden="true"></span>' }) + '<div class="subwrap"><div id="fdhistbody"></div></div>';
    shopP = sub('foodshop');
    shopP.innerHTML = top('foodshop', '<span id="fdshopname">店</span>', { right: '<button class="iconbtn fd-topbtn" id="fdshopedit">编辑</button>' }) +
      '<div class="subwrap"><div id="fdshopbody"></div></div>' +
      '<div class="fd-dock" id="fdshopdock"><button class="fd-primary fd-wide" id="fdagain">在这家再记一顿</button></div>';
    mealP = sub('foodmeal');
    mealP.innerHTML = top('foodmeal', '<span id="fdmealname">一顿</span>', { right: '<button class="iconbtn fd-topbtn" id="fdmealedit">编辑</button>' }) +
      '<div class="subwrap"><div id="fdmealbody"></div></div>';
    citiesP = sub('foodcities');
    citiesP.innerHTML = top('foodcities', '看哪座城', { closeX: true, right: '<span style="flex:none;width:44px" aria-hidden="true"></span>' }) + '<div class="subwrap"><div id="fdcitybody"></div></div>';
    form = sub('foodnew');
    form.innerHTML = buildForm();
    var ours = [page, hist, shopP, mealP, citiesP, form];
    function syncInert() {   // 关着的、被我们自己另一张盖住的：inert。只改 inert，不碰 class，不会自己叫醒自己
      var kids = [].slice.call(app.children);
      ours.forEach(function (p) {
        var on = p.classList.contains('on');
        p.inert = !on || ours.some(function (o) { return o !== p && o.classList.contains('on') && kids.indexOf(o) > kids.indexOf(p); });
      });
    }
    ours.forEach(function (p) {
      app.appendChild(p);
      new MutationObserver(syncInert).observe(p, { attributes: true, attributeFilter: ['class'] });
    });
    syncInert();
    wire();
    return true;
  }

  /* 叠页：推开的那张挪到最后（谁在最上面按 DOM 先后认，左滑返回、原生顶栏都看这个） */
  function openSub(el) {
    el.__from = document.activeElement;   // 关上的时候焦点还回去
    app.appendChild(el);
    void el.offsetWidth;
    el.classList.add('on');
    setTimeout(function () { var bk = el.querySelector('.top [data-close]'); if (bk && bk.offsetParent) try { bk.focus({ preventScroll: true }); } catch (e) {} }, 320);   // 焦点进到新页（读屏、键盘）
  }
  function closeSub(el) {
    if (!el.classList.contains('on')) return;
    el.classList.remove('on');
    if (el === form) formUndoOff();
    if (window.navBack) window.navBack();
    var f = el.__from;
    if (f && f.isConnected) Promise.resolve().then(function () { if (!f.closest('.sub:not(.on)') && !f.closest('[inert]')) try { f.focus({ preventScroll: true }); } catch (e) {} });   // 第六轮：同步 focus 时底下那页还 inert，焦点掉到 body
  }
  function isOn(el) { return el && el.classList.contains('on'); }

  /* ───────── 数据 ───────── */
  var D = null, X = null;
  var view = 'today', scope = null, shopFilter = 'all', q = '', tasteEdit = false, tasteOpen = {}, openedNow = 0, tasteMore = {}, addKind = '';   // 加口味不预选：忘了切就进错档（1008 检查）
  var diceMode = 'dish', diceBy = { dish: null, way: null }, rolling = false, autoRolled = false, shownDice = '', onlyCuisine = '';   // onlyCuisine：从「一个方向」点进来，只在这一路里丢   // 这顿吃什么：一道菜 / 一个方向；丢出来的那次
  var banner = null, histLimit = 30, shopId = 0, shopEdit = false, mealId = 0, mealEdit = false;

  function index(d) {
    var x = { shop: {}, branch: {}, meal: {}, dish: {}, byMeal: {}, byDish: {}, byBranch: {}, branchesOf: {}, dishesOf: {} };
    d.shops.forEach(function (s) { x.shop[s.id] = s; x.branchesOf[s.id] = []; x.dishesOf[s.id] = []; });
    d.branches.forEach(function (b) { x.branch[b.id] = b; (x.branchesOf[b.shop_id] = x.branchesOf[b.shop_id] || []).push(b); x.byBranch[b.id] = []; });
    d.meals.forEach(function (m) { x.meal[m.id] = m; x.byMeal[m.id] = []; if (m.branch_id && x.byBranch[m.branch_id]) x.byBranch[m.branch_id].push(m); });
    d.dishes.forEach(function (ds) { x.dish[ds.id] = ds; x.byDish[ds.id] = []; (x.dishesOf[ds.shop_id] = x.dishesOf[ds.shop_id] || []).push(ds); });
    d.logs.forEach(function (l) { (x.byMeal[l.meal_id] = x.byMeal[l.meal_id] || []).push(l); if (l.dish_id) (x.byDish[l.dish_id] = x.byDish[l.dish_id] || []).push(l); });
    Object.keys(x.dishesOf).forEach(function (k) { x.dishesOf[k] = x.dishesOf[k].filter(function (ds) { return x.byDish[ds.id].length; }); });   // 一顿删了菜还挂着：没吃过的不列（第六轮）
    return x;
  }
  function here() { return (D && D.here) || { city: '', today: new Date().toISOString().slice(0, 10) }; }
  function curCity() { return scope === null ? (here().city || '') : scope; }   // '' ＝ 哪座城都算
  function shopOfMeal(m) { var b = m.branch_id && X.branch[m.branch_id]; return b ? X.shop[b.shop_id] : null; }
  function mealKey(m) { return m.eaten_on + '|' + (SLOTS.indexOf(m.slot) < 0 ? 9 : SLOTS.indexOf(m.slot)) + '|' + ('00000000' + m.id).slice(-8); }
  function dishName(l) { return l.dish_id ? (X.dish[l.dish_id] || {}).name : l.name; }
  function whereOf(m) {
    var s = shopOfMeal(m), b = m.branch_id && X.branch[m.branch_id];
    return s ? s.name + (b && b.area ? ' · ' + b.area : '') : (m.place || '自己做的');
  }
  /* 一串记录（同一道菜的）按吃的先后排，最后一次表过态的算它现在的样子 */
  function stat(logs) {
    var r = { n: 0, good: 0, meh: 0, bad: 0, last: null, note: '', price: null, date: '', cities: {} };
    logs.slice().sort(function (a, b) { return (mealKey(X.meal[a.meal_id]) + a.id) < (mealKey(X.meal[b.meal_id]) + b.id) ? -1 : 1; })
      .forEach(function (l) {
        var m = X.meal[l.meal_id];
        r.n++;
        if (l.verdict) { r[l.verdict]++; r.last = l.verdict; }
        if (l.note) r.note = l.note;
        if (l.price != null) r.price = l.price;
        if (m) { r.date = m.eaten_on; if (m.city) r.cities[m.city] = 1; }
      });
    return r;
  }
  function cities() {
    var cs = {};
    D.meals.forEach(function (m) { if (m.city) cs[m.city] = (cs[m.city] || 0) + 1; });
    D.branches.forEach(function (b) { if (b.city && !cs[b.city]) cs[b.city] = 0; });
    var hc = here().city;
    return Object.keys(cs).sort(function (a, b) { return (b === hc) - (a === hc) || cs[b] - cs[a]; }).map(function (c) { return { city: c, n: cs[c] }; });
  }
  function shopInCity(s, c) { return !c || (X.branchesOf[s.id] || []).some(function (b) { return b.city === c; }); }
  function mealsOfShop(s) {
    var ms = [];
    (X.branchesOf[s.id] || []).forEach(function (b) { ms = ms.concat(X.byBranch[b.id] || []); });
    return ms.sort(function (a, b) { return mealKey(a) < mealKey(b) ? 1 : -1; });
  }
  function shopInfo(s, c) {
    var ms = mealsOfShop(s).filter(function (m) { return !c || m.city === c; });
    var ds = (X.dishesOf[s.id] || []).map(function (d) { return { d: d, st: stat(X.byDish[d.id] || []) }; });
    return { ms: ms, ds: ds, bad: ds.filter(function (x) { return x.st.last === 'bad'; }), good: ds.filter(function (x) { return x.st.last === 'good'; }) };
  }
  /* 别点：整家拉黑的店 ＋ 现在算雷的菜（整家拉黑的店里的菜不重复列），新的在前 */
  function badList(c) {
    var out = [];
    D.shops.forEach(function (s) {
      if (s.verdict === 'bad' && shopInCity(s, c)) out.push({ shop: s, name: s.name, why: s.note || '整家拉黑', tag: '拉黑', date: (mealsOfShop(s)[0] || {}).eaten_on || '' });
    });
    D.dishes.forEach(function (d) {
      var s = X.shop[d.shop_id], st = stat(X.byDish[d.id] || []);
      if (st.last === 'bad' && !(s && s.verdict === 'bad') && (!c || st.cities[c])) out.push({ shop: s, name: d.name + (s ? ' · ' + s.name : ''), why: st.note, tag: '踩雷', date: st.date });
    });
    var seen = {};   // 这顿整体记成踩雷、又没有哪道菜标踩雷：一家只列最近那顿（1008 检查：以前这一格不算数）
    D.meals.slice().sort(function (a, b) { return mealKey(a) < mealKey(b) ? 1 : -1; }).forEach(function (m) {
      var s = shopOfMeal(m);
      if (m.verdict !== 'bad' || !s || s.verdict === 'bad' || seen[s.id] || (c && m.city !== c)) return;
      if ((X.byMeal[m.id] || []).some(function (l) { return l.verdict === 'bad'; })) return;
      seen[s.id] = 1;
      out.push({ shop: s, name: s.name + ' · 这顿整体', why: m.note || short(m.eaten_on) + ' 那顿', tag: '踩雷', date: m.eaten_on });
    });
    return out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function vw(v) { return v ? ' <b class="fd-vw ' + v + '">' + V[v] + '</b>' : ''; }
  function tname(t) {   // 聊天里记的、配了哪类菜的，说成「炒菜里不要姜葱蒜」「面加麻油」
    var sc = (t.scope || '').trim();
    if (!sc) return t.item;
    return sc + ({ love: '加', hate: '里不要', never: '里不能有' }[t.kind] || ' · ') + t.item;
  }
  function tasteOf(k) { return (D.taste || []).filter(function (t) { return t.kind === k; }).sort(function (a, b) { return b.id - a.id; }); }

  /* 删东西：先在页面上拿掉，5 秒内能撤销，过了才真删（复查：删分店、删店会连吃过的几顿一起删，删了回不来） */
  var pend = null;
  function cascade(d, kind, id) {
    var drop = { shop: {}, branch: {}, meal: {}, dish: {} };
    if (kind === 'shop') { drop.shop[id] = 1; d.branches.forEach(function (b) { if (b.shop_id === id) drop.branch[b.id] = 1; }); d.dishes.forEach(function (x) { if (x.shop_id === id) drop.dish[x.id] = 1; }); }
    if (kind === 'branch') drop.branch[id] = 1;
    d.meals.forEach(function (m) { if ((kind === 'meal' && m.id === id) || drop.branch[m.branch_id]) drop.meal[m.id] = 1; });
    return Object.assign({}, d, {
      shops: d.shops.filter(function (x) { return !drop.shop[x.id]; }), branches: d.branches.filter(function (x) { return !drop.branch[x.id]; }),
      meals: d.meals.filter(function (x) { return !drop.meal[x.id]; }), dishes: d.dishes.filter(function (x) { return !drop.dish[x.id]; }),
      logs: d.logs.filter(function (l) { return !drop.meal[l.meal_id] && !(l.dish_id && drop.dish[l.dish_id]) && !(kind === 'log' && l.id === id); }),
      taste: kind === 'taste' ? (d.taste || []).filter(function (t) { return t.id !== id; }) : d.taste
    });
  }
  function undoBar(text, onUndo) {
    var old = document.getElementById('fdundo'); if (old) old.remove();
    var ts = document.getElementById('toast'); if (text && ts) ts.classList.remove('on');   // 跟提示条同一个位置，不叠
    if (!text) return;
    var el = document.createElement('div'); el.id = 'fdundo'; el.className = 'fd-undo'; el.setAttribute('role', 'status');
    el.style.bottom = 'calc(' + ($('fdadd') && !$('fdadd').hidden && isOn(page) && !isOn(form) ? 140 : 82) + 'px + env(safe-area-inset-bottom,0px))';
    el.innerHTML = '<span>' + esc(text) + '</span><button type="button">撤销</button>';
    el.querySelector('button').addEventListener('click', onUndo);
    var hold = function () { if (pend) clearTimeout(pend.timer); }, go = function () { if (pend) { clearTimeout(pend.timer); pend.timer = setTimeout(function () { flushDel(); }, 5000); } };
    el.addEventListener('pointerenter', hold); el.addEventListener('focusin', hold); el.addEventListener('pointerleave', go); el.addEventListener('focusout', go);
    document.body.appendChild(el);
    return el;
  }
  function formUndoOff() { var u = document.getElementById('fdundo'); if (u && u.dataset.form) u.remove(); }   // 「清空」「先收起来了」的撤销只管这一张单子
  function flushDel(keep) {   /* 真删；keep＝页面要关了，用 keepalive 发出去 */
    if (!pend) return Promise.resolve();
    var p0 = pend; pend = null; clearTimeout(p0.timer); undoBar(null);
    return fetch('/api/food/del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: p0.kind, id: p0.id }), keepalive: !!keep })
      .then(function (r) { if (!r.ok) throw new Error('没删成 ' + r.status); }).catch(function (e) { say(e.message); }).then(function () { if (!keep) return load(true); });
  }
  function softDel(kind, id, label) {
    flushDel();
    pend = { kind: kind, id: id };
    D = cascade(D, kind, id); X = index(D);
    if (kind === 'shop') closeSub(shopP);
    if (kind === 'meal') closeSub(mealP);
    if (kind === 'taste') delete tasteOpen[id];
    render(false);
    pend.timer = setTimeout(function () { flushDel(); }, 5000);
    undoBar('删掉了' + label, function () { var p0 = pend; if (!p0) return; clearTimeout(p0.timer); pend = null; undoBar(null); say('回来了'); load(true); });
  }
  window.addEventListener('pagehide', function () { flushDel(true); });

  function load(quiet) {
    return api('/api/food').then(function (d) { D = pend ? cascade(d, pend.kind, pend.id) : d; X = index(D); render(quiet !== true); })
      .catch(function (e) { if (!D) $('fdmain').innerHTML = '<p class="fd-empty">没翻开：' + esc(e.message) + '</p><div class="fd-acts" style="justify-content:center"><button class="fd-btn" data-retry>再试一次</button></div>'; else say(e.message); });
  }

  /* 她点的那一行，重画前后钉在原地（1008 交互专查：改口味点第二行，手指下那行跳了 175px） */
  var anchorKey = null, scrollOf = {}, searchFrom = null, fromBadall = false;
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var KEYS = ['data-topen', 'data-tedit', 'data-shop', 'data-meal', 'data-sf', 'data-tmore', 'data-dm', 'data-roll', 'data-tek', 'data-sv',
    'data-ms', 'data-mh', 'data-mv', 'data-lv', 'data-addk', 'data-bnok', 'data-bnblack', 'data-fgo', 'data-del', 'data-city', 'data-dpick', 'data-donly'];
  function keyOf(el) {
    for (var n = el; n && n.getAttribute; n = n.parentElement) {
      for (var i = 0; i < KEYS.length; i++) if (n.hasAttribute(KEYS[i])) { var v = n.getAttribute(KEYS[i]); return '[' + KEYS[i] + (v ? '="' + v.replace(/"/g, '\\"') + '"' : '') + ']'; }
      if (n.classList.contains('subwrap')) break;
    }
    return null;
  }
  function typingIn(box) { var a = document.activeElement; return !!(a && box.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  function rebuild(box, html, redo) {   /* 换掉一块内容：她正在那儿打字就先不换（存了不重画，等她离开输入框再补画）；锚住她点的那一行；焦点还回原处 */
    if (typingIn(box)) { box.__redo = redo || null; return false; }
    box.__redo = null;
    var sw = box.closest('.subwrap'), a = anchorKey && sw ? sw.querySelector(anchorKey) : null, before = a ? a.getBoundingClientRect().top : 0;
    var f = document.activeElement, fk = f && box.contains(f) ? keyOf(f) : null;
    box.innerHTML = html;
    nameInputs(box); syncPressed(box);
    if (a) { var n = sw.querySelector(anchorKey); if (n) { var d = n.getBoundingClientRect().top - before; if (Math.abs(d) > 0.5) sw.scrollTop += d; } }
    if (fk) { var g = box.querySelector(fk); if (!g && /data-(dpick|donly)/.test(fk)) g = box.querySelector('[data-roll]'); if (!g && /data-del="log:/.test(fk)) g = box.querySelector('[data-newlog]'); if (g) try { g.focus({ preventScroll: true }); } catch (e) {} }   // 骰子换了样子：焦点落到「再丢一次」
    return true;
  }
  function swOf(el) { return el.querySelector('.subwrap'); }
  function syncPressed(root) { [].forEach.call(root.querySelectorAll('[data-sf], [data-addk], [data-sv], [data-ms], [data-mh], [data-mv], [data-lv], [data-tek], [data-dm]'), function (b) { b.setAttribute('aria-pressed', b.classList.contains('on')); }); }
  function nameInputs(root) { [].forEach.call(root.querySelectorAll('input.fd-in, textarea.fd-in, select.fd-cur, #fdq, #fdaddin, #fdaddnote'), function (i) { if (!i.getAttribute('aria-label') && i.placeholder) i.setAttribute('aria-label', i.placeholder); }); }
  /* 冒出来、收起来：按它真实的高度过渡，下面的跟着慢慢走，不一下子跳（1008 交互专查：再加一道 +182px、横幅 −140px 都是一下子） */
  var EO = 'cubic-bezier(.22,.61,.36,1)', EI = 'cubic-bezier(.4,0,1,1)';
  function grow(el, ms) {
    if (RM || !el || !el.animate) return;
    var h = el.offsetHeight, cs = getComputedStyle(el);
    el.style.overflow = 'hidden';
    var an = el.animate([{ height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px' },
      { height: h + 'px', opacity: 1, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom }], { duration: ms || 240, easing: EO });
    an.onfinish = an.oncancel = function () { el.style.overflow = ''; };
  }
  function fold(el, done, ms) {   // 别叫 shrink：下面压照片的那个就叫 shrink
    if (RM || !el || !el.animate) { done(); return; }
    el.style.overflow = 'hidden';
    var an = el.animate([{ height: el.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px', marginTop: '0px' }],
      { duration: ms || 200, easing: EI, fill: 'forwards' });
    an.onfinish = function () { done(); };
  }
  /* 收起、变短、底栏收走的时候，在页尾垫一段空白：滚到底了页面也不往回弹，手指底下那行不跑
     （第五轮逐帧量：收「更多」按钮跑 441px、改口味最后一行一帧跳 108px）。往上滚的时候，这段空白自己一点点收掉 */
  function addRoom(sw, need) {
    if (!sw || !(need > 0.5)) return;
    var sp = sw.querySelector(':scope > .fd-room');
    if (!sp) { sp = document.createElement('div'); sp.className = 'fd-room'; sp.setAttribute('aria-hidden', 'true'); sw.appendChild(sp); }
    sp.style.height = (sp.offsetHeight + need) + 'px';
    if (sw.__room) return;
    sw.__room = function () {   // 一滚就收到刚好撑住眼前这一屏；内容长回来了就整段撤掉
      var h = sp.offsetHeight, left = Math.max(0, Math.min(h, sw.scrollTop + sw.clientHeight - (sw.scrollHeight - h)));
      if (left < h) sp.style.height = left + 'px';
      if (left <= 0) dropRoom(sw);
    };
    sw.addEventListener('scroll', sw.__room, { passive: true });
  }
  function dropRoom(sw) {
    var sp = sw && sw.querySelector(':scope > .fd-room'); if (sp) sp.remove();
    if (sw && sw.__room) { sw.removeEventListener('scroll', sw.__room); sw.__room = null; }
  }
  function keepRoom(sw, lost) { if (sw) addRoom(sw, lost - (sw.scrollHeight - sw.scrollTop - sw.clientHeight)); }   // 马上要少掉 lost 那么高
  function holdAt(sw, st) { if (!sw) return; addRoom(sw, st + sw.clientHeight - sw.scrollHeight); if (Math.abs(sw.scrollTop - st) > 0.5) sw.scrollTop = st; }   // 已经变了：撑回 st
  function goView(v, top) {   /* 换档：记住这一档滚到哪，回来还在那儿 */
    var sw = swOf(page);
    if (!q) scrollOf[view] = sw.scrollTop;
    dropRoom(sw);
    if (v !== 'shops' && fromBadall) { shopFilter = 'all'; fromBadall = false; }
    view = v; q = ''; searchFrom = null; $('fdq').value = ''; $('fdqx').hidden = true; tasteEdit = false; tasteOpen = {}; anchorKey = null;
    render(true);
    sw.scrollTop = top ? 0 : (scrollOf[v] || 0);
  }

  /* ───────── 首页 ───────── */
  function render(anim) {
    if (!D) return;
    [].forEach.call(page.querySelectorAll('.fd-seg [data-v]'), function (b) { var on = !q && b.dataset.v === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });   // 搜着的时候哪一档都不亮
    var box = $('fdmain');
    var did = rebuild(box, q ? drawSearch() : view === 'today' ? drawToday() : view === 'shops' ? drawShops() : drawTaste(), function () { render(false); });
    var editing = view === 'taste' && tasteEdit && !q;
    $('fddock').hidden = editing;
    var anyOpen = Object.keys(tasteOpen).some(function (k) { return tasteOpen[k]; });
    var swp = swOf(page), st0 = swp.scrollTop;   // 加口味那条一收，页面变高；滚到底的时候会被往回压（第五轮：最后一行一帧跳 108px）
    $('fdadd').hidden = !editing || anyOpen;
    var td = $('fdtopdone'); td.style.visibility = editing ? 'visible' : 'hidden'; td.tabIndex = editing ? 0 : -1; td.setAttribute('aria-hidden', !editing);   // 占着位置：进出编辑标题不横挪（第五轮）
    [].forEach.call($('fdaddk').children, function (b) { b.classList.toggle('on', b.dataset.addk === addKind); b.setAttribute('aria-pressed', b.dataset.addk === addKind); });
    $('fdaddgo').textContent = addKind ? '加到' + TK[addKind] : '先选一档';
    $('fdaddgo').disabled = !addKind;
    if (anim && did) stamp(box);
    if (did && view === 'today' && !q && !autoRolled && !diceBy.dish) { autoRolled = true; rollDice(true); }   // 这顿吃什么一直有答案（复查：没丢的时候是一张大空卡）
    if (did && openedNow) {   // 刚点开的那一格，露出来；在屏幕外就往上推一点
      var ob = box.querySelector('[data-topen="' + openedNow + '"]'), te = ob && ob.closest('.fd-trow').nextElementSibling, sw = swOf(page);
      openedNow = 0;
      if (te && !te.classList.contains('fd-te')) te = null;
      if (te) {
        var over = te.getBoundingClientRect().bottom - sw.getBoundingClientRect().bottom + 12;
        grow(te, 220);
        holdAt(sw, st0);   // 编辑框从 0 长、底栏刚收：先撑回原位再往上推，不先掉下去再滑回来
        if (over > 0) { box.style.paddingBottom = over + 'px'; sw.scrollBy({ top: over, behavior: RM ? 'auto' : 'smooth' }); setTimeout(function () { box.style.paddingBottom = ''; }, 360); }   // 最底下那两行：编辑框从 0 长，滚动会被卡住；先垫一段空，长完再撤（复查第四轮）
      }   // 先按长好的高度量，再让它长（1008 复查：长到一半量，编辑框被底栏挡住一截）
    }
    if (isOn(hist)) renderHist();
    if (isOn(shopP)) renderShop();
    if (isOn(mealP)) renderMeal();
    if (isOn(citiesP)) renderCities();
  }
  function stamp(box) {   /* 一节一节淡进来（样子是全站那套 .m6in），只在换档、刷新时播 */
    [].forEach.call(box.children, function (el, i) { el.style.setProperty('--m6d', Math.min(i, 3) * 30 + 'ms'); el.classList.add('fd-fade'); });   // 换档要快、只淡：最晚一节 90ms 起步
  }
  function cityBtn() {
    var cs = cities(), c = curCity();
    if (cs.length < 2) return c ? '<span class="meta">' + esc(c) + '</span>' : '';
    return '<button class="fd-city" data-fgo="cities">' + esc(c || '哪座城都算') + svg('down') + '</button>';
  }
  function mealRow(m) {
    var logs = X.byMeal[m.id] || [];
    var ds = logs.map(function (l) { return esc(dishName(l)) + vw(l.verdict); }).join(' · ') || esc(m.note || '');
    if (m.verdict) ds += (ds ? ' · ' : '') + '整体' + vw(m.verdict);
    return '<button class="fd-row" data-meal="' + m.id + '"><span class="fd-slot">' + esc(m.slot || '一顿') + '</span>' +
      '<span class="fd-main"><span class="t">' + esc(whereOf(m)) + '</span>' + (ds ? '<span class="s">' + ds + '</span>' : '') + '</span>' +
      (m.total != null ? '<span class="fd-amt">' + money(m.total, m.currency) + '</span>' : '') +
      '<svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg></button>';
  }
  function badRow(b) {
    return '<button class="fd-row" data-shop="' + (b.shop ? b.shop.id : '') + '"><span class="fd-main"><span class="t">' + esc(b.name) + '</span>' +
      (b.why ? '<span class="s">' + esc(b.why) + '</span>' : '') + '</span><span class="fd-tag bad">' + b.tag + '</span><svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg></button>';
  }
  function drawToday() {
    var t = here().today, h = '';
    if (banner && banner.shopId && !X.shop[banner.shopId]) banner = null;   // 那家店已经删了
    if (banner) {
      h += '<div class="fd-banner"><p>记下了。<b>' + esc(banner.names.join('、')) + '</b> 放进别点了，下回替你挡。</p><div class="fd-acts">' +
        (banner.shopId && X.shop[banner.shopId] && X.shop[banner.shopId].verdict !== 'bad' ? '<button class="fd-btn" data-bnblack="' + banner.shopId + '">这家整家拉黑</button>' : '') +
        '<button class="fd-btn" data-bnok>好</button></div></div>';
    }
    var todays = D.meals.filter(function (m) { return m.eaten_on >= t; }).sort(function (a, b) { return mealKey(a) < mealKey(b) ? -1 : 1; });
    var wk = D.meals.filter(function (m) { var dd = (new Date(t) - new Date(m.eaten_on)) / 864e5; return dd < 7 && m.slot !== '纯记录'; }).length;
    h += '<section class="fd-sec"><div class="fd-sh"><h2>' + dayName(t) + '</h2>' +
      (wk ? '<span class="meta fd-right">近 7 天 ' + wk + ' 顿</span>' : '') + '</div>' +
      (todays.length ? '<div class="fd-list">' + todays.map(mealRow).join('') + '</div>' : '<p class="fd-empty">今天还没记。</p>') +
      (D.meals.some(function (m) { return m.eaten_on !== t; }) ? '<button class="fd-link" data-fgo="hist">更早 ›</button>' : '') + '</section>';
    var c = curCity(), bl = badList(c);   /* 今天 → 别点 → 这顿吃什么 → 忌口：点外卖前最要紧的先看见 */
    h += '<section class="fd-sec" data-sec="bie"><div class="fd-sh"><h2>别点</h2>' + cityBtn() + (bl.length ? '<button class="fd-link fd-right" data-fgo="badall">全部 ›</button>' : '') + '</div>' +
      (bl.length ? '<div class="fd-list">' + bl.slice(0, 3).map(badRow).join('') + '</div>' : '<p class="fd-empty">' + (c ? esc(c) : '') + '还没踩过雷。吃到难吃的记一笔，下回替你挡。</p>') + '</section>';
    h += '<section class="fd-sec"><div class="fd-sh"><h2>这顿吃什么</h2><div class="fd-seg sm fd-right">' +
      [['dish', '一道菜'], ['way', '一个方向']].map(function (p) { return '<button class="' + (diceMode === p[0] ? 'on' : '') + '" data-dm="' + p[0] + '" aria-pressed="' + (diceMode === p[0]) + '">' + p[1] + '</button>'; }).join('') +
      '</div></div>' + diceCard() + '</section>';
    h += '<section class="fd-sec"><div class="fd-sh"><h2>我的忌口</h2><button class="fd-link fd-right" data-fgo="taste">全部口味 ›</button></div>' + tasteCloud(6, ['never', 'hate']) + '</section>';
    return h;
  }
  function diceCard() {
    var dice = diceBy[diceMode];
    var btn = '<button class="fd-btn fd-dicebtn" data-roll aria-disabled="' + rolling + '">' + svg('dice') + (dice ? '再丢一次' : '丢一下') + '</button>';
    if (!dice && (rolling || (diceMode === 'dish' && !autoRolled))) return '<div class="fd-dice"><div class="fd-wait"></div><div class="fd-dfoot">' + btn + '</div></div>';   // 先替她丢着：占位，不先闪一句提示再换
    if (!dice) return '<div class="fd-dice"><p class="fd-dice-hint">' + (diceMode === 'way' ? '不知道吃哪一路，丢一个方向：川菜、日料、韩餐…' : '照你的口味丢一道，不能吃的、不爱吃的先剔掉。') + '</p><div class="fd-dfoot">' + btn + '</div></div>';
    if (dice.empty) return '<div class="fd-dice"><p class="fd-dice-hint">照你的口味剔完，一道都不剩了。去口味里看看是不是剔多了。</p><div class="fd-dfoot">' + btn + '</div></div>';
    var main = dice.mode === 'way' ? dice.cuisine : dice.name;
    var KL = { 饭: '饭', 面粉: '面 · 粉', 菜: '', 汤粥: '汤 · 粥', 小吃: '小吃', 锅: '锅' };
    var pre = dice.mode === 'way' ? dice.cuisine.replace(/(菜|餐|料理)$/, '') : '';   // 「印度扁豆咖喱、印度椰奶咖喱虾」：例子里不再念一遍菜系
    var meta = dice.mode === 'way' ? '比如 ' + dice.examples.map(function (x) { return pre.length >= 2 && x.indexOf(pre) === 0 && x.length > pre.length + 1 ? x.slice(pre.length) : x; }).join('、') : dice.cuisine + (KL[dice.dish_kind] ? ' · ' + KL[dice.dish_kind] : '');
    var dk = dice.mode + ':' + (dice.name || dice.cuisine), fresh = dk !== shownDice; shownDice = dk;   // 只有丢出新的一道才淡入，别的重画不闪
    return '<div class="fd-dice' + (dice.mode === 'way' ? ' way' : '') + (fresh ? ' fd-fade' : '') + '" aria-live="polite"><div class="fd-dpick"><span class="fd-dname"><b>' + esc(main) + '</b></span><span class="fd-dmeta">' + esc(meta) + '</span></div>' +
      ((dice.notes || []).length ? '<p class="fd-dnotes">' + dice.notes.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') + '</p>' : '') +
      '<div class="fd-dacts">' + (dice.mode === 'way' ? '<button class="fd-btn" data-dpick>只在' + esc(dice.cuisine) + '里丢一道 ›</button>'
        : (garnish(dice) ? '<button class="fd-btn" data-dcopy>复制备注</button>' : '') + '<button class="fd-btn" data-dpick>就吃这个，记一笔 ›</button>') + '</div>' +
      '<div class="fd-dfoot"><span class="meta">' + (dice.mode === 'way' ? '<span class="fd-nw">' + dice.cuisines + ' 个菜系里丢的</span> · <span class="fd-nw">按口味剔掉 ' + dice.removed + ' 道菜</span>'
        : dice.only ? '只在' + esc(dice.only) + '里 · ' + dice.count + ' 道 <button class="fd-link" data-donly>不限 ›</button>'
        : '<span class="fd-nw">' + dice.count + ' 道里丢的</span>' + (dice.removed ? ' · <span class="fd-nw">按口味剔掉 ' + dice.removed + ' 道</span>' : '')) + '</span>' + btn + '</div></div>';
  }
  function garnish(dice) {   /* 要贴进外卖备注的那一句：只要「不要姜、葱」那一段 */
    var n = (dice.notes || []).filter(function (x) { return x.indexOf('备注') >= 0; })[0];
    return n ? n.replace(/^.*?备注[：:]\s*/, '') : '';
  }
  function rollDice(quiet, want, tries) {
    if (rolling) return;
    rolling = true;
    var mode = diceMode, prev = diceBy[mode];
    api('/api/food/dice', { mode: mode, want: want || '', only: mode === 'dish' ? onlyCuisine : '' }).then(function (r) {
      if (!quiet && !want && prev && !r.empty && (tries || 0) < 3 && (mode === 'way' ? r.cuisine === prev.cuisine : r.name === prev.name)) { rolling = false; rollDice(quiet, want, (tries || 0) + 1); return; }   // 跟刚才一样：悄悄再丢，最多三回（就剩一道的时候还是它）
      diceBy[mode] = r; rolling = false; render(false);
      if (quiet) return;   // 一打开先替她丢好的那一道：不晃、不震、不念
      $('fdlive').textContent = r.empty ? '一道都不剩了' : r.mode === 'way' ? '丢到' + r.cuisine : '丢到' + r.name;
      var card = page.querySelector('.fd-dice');
      if (card) { card.classList.remove('roll'); void card.offsetWidth; card.classList.add('roll'); }
      try { if (typeof window.haptic === 'function') window.haptic(); else if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}   // 家里的壳给了 haptic 就用它（iPhone 网页里 vibrate 是空的）
    }).catch(function (er) { rolling = false; say(er.message); render(false); });
  }
  function tasteCloud(limit, kinds) {
    var h = '', any = false;
    (kinds || TORDER).forEach(function (k) {
      var rows = tasteOf(k);
      if (!rows.length) return;
      any = true;
      var lim = k === 'never' || tasteMore[k] || rows.length <= limit + 2 ? rows.length : limit, shown = rows.slice(0, lim);
      h += '<div class="fd-tg fd-tg-' + k + '"><h3>' + TK[k] + '</h3><div class="fd-cloud">' + shown.map(function (t) {
        return '<span class="fd-chip">' + esc(tname(t)) + (t.note ? '<small>' + esc(t.note) + '</small>' : '') + '</span>';
      }).join('') + '</div>' + (rows.length > lim ? '<button class="fd-link" data-tmore="' + k + '">还有 ' + (rows.length - lim) + ' 样 ›</button>'
        : tasteMore[k] && k !== 'never' && rows.length > limit + 2 ? '<button class="fd-link" data-tmore="' + k + '">收起</button>' : '') + '</div>';
    });
    return any ? h : '<p class="fd-empty">还没写。点「编辑」写几样，或者在聊天里说一句「我不吃香菜」。</p>';
  }

  // 店
  function drawShops() {
    var c = curCity();
    var h = '<div class="fd-filter"><div class="chips chips2" style="margin:0;padding:0;overflow:visible">' +
      [['all', '全部'], ['good', '认准'], ['bad', '别点']].map(function (p) { return '<button class="chip' + (shopFilter === p[0] ? ' on' : '') + '" data-sf="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
      '</div>' + '<span class="fd-right">' + cityBtn() + '</span></div>';
    var list = D.shops.filter(function (s) { return shopInCity(s, c); }).map(function (s) { var i = shopInfo(s, c); i.s = s; return i; }).filter(function (i) {
      return shopFilter === 'all' || (shopFilter === 'good' ? i.s.verdict === 'good' : (i.s.verdict === 'bad' || i.bad.length || i.ms.some(function (m) { return m.verdict === 'bad'; })));
    }).sort(function (a, b) { return (shopFilter === 'all' ? (a.s.verdict === 'bad') - (b.s.verdict === 'bad') : 0) || b.ms.length - a.ms.length || ((b.ms[0] || {}).eaten_on > (a.ms[0] || {}).eaten_on ? 1 : -1); });
    if (!list.length) {
      return h + '<p class="fd-empty">' + (shopFilter === 'bad' ? '这里还没有拉黑的店、踩过的雷。' : shopFilter === 'good' ? '还没认准哪家。去一家店的页面，点「编辑」就能认准它。' : '还没记过店。点「记一笔」，吃过的店就会出现在这儿。') + '</p>';
    }
    var groups = {}, order = [];
    list.forEach(function (i) {
      var keys = c ? [c] : (X.branchesOf[i.s.id] || []).map(function (b) { return b.city; }).filter(function (v, k, a) { return a.indexOf(v) === k; });
      if (!keys.length) keys = ['没写在哪'];
      keys.forEach(function (k) { if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(i); });
    });
    order.forEach(function (g) {
      if (!c) h += '<div class="fd-gh">' + esc(g) + '</div>';
      h += '<div class="fd-list">' + groups[g].map(shopRow).join('') + '</div>';
    });
    return h;
  }
  function shopRow(i) {
    var s = i.s, areas = (X.branchesOf[s.id] || []).map(function (b) { return b.area; }).filter(Boolean).filter(function (v, k, a) { return a.indexOf(v) === k; });
    var meta = [s.cuisine, areas.join('、'), i.ms.length ? '来过 ' + i.ms.length + ' 次' : ''].filter(Boolean).map(esc).join(' · ');
    var badline = i.bad.length ? '<span class="s"><b class="fd-vw bad">踩雷</b> ' + i.bad.map(function (x) { return esc(x.d.name); }).join('、') + '</span>' : '';
    return '<button class="fd-row" data-shop="' + s.id + '"><span class="fd-main"><span class="t">' + esc(s.name) + '</span>' +
      (meta ? '<span class="s">' + meta + '</span>' : '') + badline + '</span>' +
      (s.verdict === 'bad' ? '<span class="fd-tag bad">拉黑</span>' : s.verdict === 'good' ? '<span class="fd-tag">认准</span>' : '') +
      '<svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg></button>';
  }

  // 口味
  function drawTaste() {
    if (!tasteEdit) {
      var h = '<section class="fd-sec"><div class="fd-sh"><h2>我的口味</h2><button class="iconbtn fd-topbtn fd-right" data-tedit>编辑</button></div>' + tasteCloud(12) + '</section>';
      var often = oftenItems();
      if (often.length) {
        h += '<section class="fd-sec"><div class="fd-sh"><h2>常点的</h2><span class="meta">点过两次以上</span></div><div class="fd-list">' + often.map(function (x) {
          var tag = x.shop ? 'button' : 'div';
          return '<' + tag + ' class="fd-row"' + (x.shop ? ' data-shop="' + x.shop.id + '"' : '') + '><span class="fd-main"><span class="t">' + esc(x.name) + '</span>' +
            '<span class="s">' + esc((x.shop ? x.shop.name : x.where) + ' · ' + x.st.n + ' 次' + (x.st.date ? ' · 最近 ' + short(x.st.date) : '')) + '</span></span>' +
            (x.shop ? '<svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg>' : '') + '</' + tag + '>';
        }).join('') + '</div></section>';
      }
      return h;
    }
    var e = '<section class="fd-sec"><div class="fd-sh"><h2>改口味</h2></div>';   // 「完成」只留顶栏那一个
    TORDER.forEach(function (k) {
      var rows = tasteOf(k);
      e += '<div class="fd-tg"><h3>' + TK[k] + '</h3>' + (rows.length ? '<div class="fd-list">' + rows.map(function (t) {
        var open = !!tasteOpen[t.id];
        return '<div class="fd-row fd-trow"><button class="fd-tbtn" data-topen="' + t.id + '" aria-expanded="' + open + '">' +
          '<span class="t">' + esc(tname(t)) + svg('down', 'fd-tch') + '</span>' + (t.note ? '<span class="s">' + esc(t.note) + '</span>' : '') + '</button>' +
          '<button class="fd-del" data-del="taste:' + t.id + '" aria-label="删掉 ' + esc(tname(t)) + '">删</button></div>' +
          (open ? '<div class="fd-te">' + fl('名字', '<input class="fd-in" data-tei="item" data-id="' + t.id + '" value="' + esc(tname(t)) + '">') +
            '<div class="fd-te-k"><span>放在</span><div class="fd-seg sm">' + TORDER.map(function (kk) { return '<button class="' + (t.kind === kk ? 'on' : '') + '" aria-pressed="' + (t.kind === kk) + '" data-tek="' + t.id + ':' + kk + '">' + TK[kk] + '</button>'; }).join('') + '</div></div>' +
            '<div style="margin-bottom:-8px">' + fl('备注', '<input class="fd-in" data-tei="note" data-id="' + t.id + '" value="' + esc(t.note || '') + '">') + '</div></div>' : '');
      }).join('') + '</div>' : '<p class="fd-empty">还没写。</p>') + '</div>';
    });
    return e + '</section>';
  }
  function items() {
    var out = [];
    D.dishes.forEach(function (d) { var s = X.shop[d.shop_id]; out.push({ name: d.name, shop: s, where: s ? s.name : '', st: stat(X.byDish[d.id] || []) }); });
    var by = {};
    D.logs.forEach(function (l) { if (!l.dish_id && l.name) (by[low(l.name)] = by[low(l.name)] || []).push(l); });
    Object.keys(by).forEach(function (k) { var ls = by[k], m = X.meal[ls[ls.length - 1].meal_id]; out.push({ name: ls[ls.length - 1].name, shop: null, where: (m && m.place) || '自己做的', st: stat(ls) }); });
    return out;
  }
  function oftenItems() {
    return items().filter(function (x) { return x.st.n >= 2 && x.st.last !== 'bad' && !(x.shop && x.shop.verdict === 'bad'); })
      .sort(function (a, b) { return b.st.n - a.st.n || (a.st.date < b.st.date ? 1 : -1); }).slice(0, 5);
  }

  // 搜
  function drawSearch() {
    var k = low(q), h = '';
    var shops = D.shops.filter(function (s) { return low(s.name).indexOf(k) >= 0 || low(s.cuisine).indexOf(k) >= 0; });
    var dishes = D.dishes.filter(function (d) { return low(d.name).indexOf(k) >= 0 && (X.byDish[d.id] || []).length; });
    var tastes = (D.taste || []).filter(function (t) { return low(tname(t)).indexOf(k) >= 0; });
    if (!shops.length && !dishes.length && !tastes.length) return '<p class="fd-empty">没找到「' + esc(q) + '」。没记过，或者叫法不一样。</p><div class="fd-acts"><button class="fd-btn" data-newshop="' + esc(q) + '">记成一家店</button><button class="fd-btn" data-newdish="' + esc(q) + '">记成一道菜</button></div>';
    if (shops.length) h += '<section class="fd-sec"><div class="fd-sh"><h2>店</h2></div><div class="fd-list">' + shops.map(function (s) { var i = shopInfo(s, ''); i.s = s; return shopRow(i); }).join('') + '</div></section>';
    if (dishes.length) {
      h += '<section class="fd-sec"><div class="fd-sh"><h2>菜</h2></div><div class="fd-list">' + dishes.map(function (d) {
        var s = X.shop[d.shop_id], st = stat(X.byDish[d.id] || []);
        return '<button class="fd-row" data-shop="' + (s ? s.id : '') + '"><span class="fd-main"><span class="t">' + esc(d.name) + '</span>' +
          '<span class="s">' + esc((s ? s.name : '') + ' · 吃过 ' + st.n + ' 次' + (st.note ? ' · ' + st.note : '')) + '</span></span>' +
          (st.last ? '<span class="fd-tag' + (st.last === 'bad' ? ' bad' : '') + '">' + V[st.last] + '</span>' : '') + '<svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg></button>';
      }).join('') + '</div></section>';
    }
    if (tastes.length) {
      h += '<section class="fd-sec"><div class="fd-sh"><h2>口味</h2></div><div class="fd-list">' + tastes.map(function (t) {
        return '<button class="fd-row" data-fgo="taste"><span class="fd-main"><span class="t">' + esc(tname(t)) + '</span>' + (t.note ? '<span class="s">' + esc(t.note) + '</span>' : '') +
          '</span><span class="fd-tag' + (t.kind === 'never' ? ' bad' : '') + '">' + TK[t.kind] + '</span><svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg></button>';
      }).join('') + '</div></section>';
    }
    return h;
  }

  /* ───────── 二级页 ───────── */
  function openHist() { renderHist(); hist.querySelector('.subwrap').scrollTop = 0; openSub(hist); }
  function renderHist() {
    var ms = D.meals.filter(function (m) { return m.eaten_on < here().today; }).sort(function (a, b) { return mealKey(a) < mealKey(b) ? 1 : -1; });
    var days = [], by = {};
    ms.forEach(function (m) { if (!by[m.eaten_on]) { by[m.eaten_on] = []; days.push(m.eaten_on); } by[m.eaten_on].push(m); });
    var h = '';
    days.slice(0, histLimit).forEach(function (d) {
      h += '<section class="fd-sec"><div class="fd-sh"><h2 style="font-size:16px">' + dayName(d, here().today) + '</h2></div><div class="fd-list">' +
        by[d].slice().reverse().map(mealRow).join('') + '</div></section>';
    });
    if (days.length > histLimit) h += '<button class="fd-link" data-histmore>还有 ' + (days.length - histLimit) + ' 天 ›</button>';
    rebuild($('fdhistbody'), h || '<p class="fd-empty">还一顿都没记。</p>');
  }

  function shopTitle() {   /* 大标题还在眼前时顶栏不重复店名；滚走了再淡出来 */
    var n = $('fdshopname'), b = $('fdshopbody'), h2 = b && b.querySelector('.fd-head h2'), tb = shopP.querySelector('.top');
    if (!n) return;
    n.style.opacity = shopEdit || !h2 || h2.getBoundingClientRect().bottom <= tb.getBoundingClientRect().bottom + 2 ? '1' : '0';
    var sw = shopP.querySelector('.subwrap'); if (sw && !sw.__tt) { sw.__tt = 1; sw.addEventListener('scroll', shopTitle, { passive: true }); }
  }
  function openShop(id) { if (!id) return; shopId = +id; shopEdit = false; if (!renderShop()) return; shopP.querySelector('.subwrap').scrollTop = 0; openSub(shopP); }
  function renderShop() {
    var s = X && X.shop[shopId];
    if (!s) { closeSub(shopP); return false; }
    $('fdshopname').textContent = shopEdit ? '改这家店' : s.name;   // 滚下去也知道是哪家
    setTimeout(shopTitle, 0);
    $('fdagain').className = (s.verdict === 'bad' ? 'fd-btn' : 'fd-primary') + ' fd-wide';
    $('fdagain').textContent = s.verdict === 'bad' ? '又吃了一次，记一笔' : '在这家再记一顿';
    $('fdshopedit').textContent = shopEdit ? '完成' : '编辑';
    $('fdshopdock').hidden = shopEdit;
    var i = shopInfo(s, ''), brs = X.branchesOf[s.id] || [], h;
    if (!shopEdit) {
      var where = brs.map(function (b) { return [b.city, b.area].filter(Boolean).join(' '); }).filter(function (v, k, a) { return v && a.indexOf(v) === k; }).join('、');
      h = (s.verdict === 'bad' ? '<div class="fd-banner"><p><b>整家拉黑了。</b>下回别点它，我也会替你挡着。</p></div>' : '') +
        '<div class="fd-head"><h2>' + esc(s.name) + '</h2><p>' + [s.cuisine, where, i.ms.length ? '来过 ' + i.ms.length + ' 次' : '', s.verdict === 'good' ? '认准这家' : ''].filter(Boolean).map(esc).join(' · ') + '</p>' +
        (s.note ? '<p class="fd-note">' + esc(s.note) + '</p>' : '') + '</div>';
      if (i.ds.length) {
        h += '<section class="fd-sec"><div class="fd-sh"><h2>点过的菜</h2></div><div class="fd-list">' + i.ds.sort(function (a, b) { return b.st.n - a.st.n; }).map(function (x) {
          var bits = ['吃过 ' + x.st.n + ' 次'].concat(['good', 'meh', 'bad'].filter(function (v) { return x.st[v]; }).map(function (v) { return V[v] + ' ' + x.st[v] + ' 次'; }));
          if (x.st.price != null) bits.push(money(x.st.price, curFor(Object.keys(x.st.cities)[0])));
          return '<div class="fd-row"><span class="fd-main"><span class="t">' + esc(x.d.name) + '</span><span class="s">' + esc(bits.join(' · ')) + (x.st.note ? '<br>' + esc(x.st.note) : '') + '</span></span>' +
            (x.st.last ? '<span class="fd-tag' + (x.st.last === 'bad' ? ' bad' : '') + '">' + V[x.st.last] + '</span>' : '') + '</div>';
        }).join('') + '</div></section>';
      }
      if (i.ms.length) h += '<section class="fd-sec"><div class="fd-sh"><h2>来过</h2></div><div class="fd-list">' + i.ms.slice(0, 20).map(function (m) {
        var logs = X.byMeal[m.id] || [];
        return '<button class="fd-row" data-meal="' + m.id + '"><span class="fd-main"><span class="t">' + esc(short(m.eaten_on) + ' ' + (m.slot || '') + (m.how ? ' · ' + howName(m.how) : '')) + '</span>' +
          '<span class="s">' + logs.map(function (l) { return esc(dishName(l)) + vw(l.verdict); }).join(' · ') + (m.verdict ? (logs.length ? ' · ' : '') + '整体' + vw(m.verdict) : '') + '</span></span>' +
          (m.total != null ? '<span class="fd-amt">' + money(m.total, m.currency) + '</span>' : '') + '<svg class="fd-chev" viewBox="0 0 24 24" aria-hidden="true">' + IC.chev + '</svg></button>';
      }).join('') + '</div></section>';
      if (brs.length) h += '<section class="fd-sec"><div class="fd-sh"><h2>分店</h2></div><div class="fd-list">' + brs.map(function (b) {
        return '<div class="fd-row"><span class="fd-main"><span class="t">' + esc([b.city, b.area, b.label].filter(Boolean).join(' · ')) + '</span>' +
          ([b.address, b.platform].filter(Boolean).length ? '<span class="s">' + esc([b.address, b.platform].filter(Boolean).join(' · ')) + '</span>' : '') + '</span></div>';
      }).join('') + '</div></section>';
    } else {
      h = '<h3 class="fd-fs" style="margin-top:4px">这一家</h3><div class="chips chips2" style="margin:0 0 6px;padding:0;overflow:visible">' +
        [['good', '认准'], ['', '普通'], ['bad', '拉黑']].map(function (p) { return '<button class="chip' + ((s.verdict || '') === p[0] ? ' on' : '') + '" data-sv="' + s.id + ':' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
        '<h3 class="fd-fs">店名、菜系、想说的</h3>' +
        fl('店名', '<input class="fd-in" data-se="name" value="' + esc(s.name) + '">') +
        fl('菜系', '<input class="fd-in" data-se="cuisine" value="' + esc(s.cuisine || '') + '" list="fdlCuis">') +
        '<textarea class="fd-in" data-se="note" rows="2" placeholder="想说的">' + esc(s.note || '') + '</textarea>';
      if (brs.length) h += '<h3 class="fd-fs">分店</h3><div class="fd-list">' + brs.map(function (b) {
        return '<div class="fd-row"><span class="fd-main"><span class="t">' + esc([b.city, b.area, b.label].filter(Boolean).join(' · ')) + '</span>' +
          '<span class="s">' + esc(((X.byBranch[b.id] || []).length) + ' 顿') + '</span></span><button class="fd-del" data-del="branch:' + b.id + '" aria-label="删掉分店 ' + esc([b.city, b.area, b.label].filter(Boolean).join(' · ')) + '">删</button></div>' +
          '<div class="fd-baddr">' + fl('地址', '<input class="fd-in" data-be="address" data-id="' + b.id + '" value="' + esc(b.address || '') + '" autocomplete="off">') + '</div>';
      }).join('') + '</div>';
      h += '<div style="margin-top:28px"><button class="fd-btn" data-del="shop:' + s.id + '" style="color:var(--sub)">删掉这家店</button></div>';
    }
    rebuild($('fdshopbody'), h, renderShop);
    return true;
  }

  function openMeal(id) { mealId = +id; mealEdit = false; if (!renderMeal()) return; mealP.querySelector('.subwrap').scrollTop = 0; openSub(mealP); }
  function renderMeal() {
    var m = X && X.meal[mealId];
    if (!m) { closeSub(mealP); return false; }
    var s = shopOfMeal(m), logs = X.byMeal[m.id] || [];
    $('fdmealname').textContent = short(m.eaten_on) + ' ' + (m.slot || '');
    $('fdmealedit').textContent = mealEdit ? '完成' : '编辑';
    var h = '<div class="fd-head"><h2>' + esc(whereOf(m)) + '</h2><p>' + [howName(m.how), m.city, m.total != null ? money(m.total, m.currency) : '', m.verdict ? '整体' + V[m.verdict] : ''].filter(Boolean).map(esc).join(' · ') + '</p></div>';
    if (!mealEdit) {
      if (logs.length) h += '<div class="fd-list">' + logs.map(function (l) {
        return '<div class="fd-row"><span class="fd-main"><span class="t">' + esc(dishName(l)) + '</span>' + (l.note || l.price != null ? '<span class="s">' + esc([l.price != null ? money(l.price, m.currency) : '', l.note].filter(Boolean).join(' · ')) + '</span>' : '') + '</span>' +
          (l.verdict ? '<span class="fd-tag' + (l.verdict === 'bad' ? ' bad' : '') + '">' + V[l.verdict] + '</span>' : '') + '</div>';
      }).join('') + '</div>';
      if (m.note) h += '<p class="fd-note">' + esc(m.note) + '</p>';
      if (m.photo) h += '<img class="fd-ph" src="' + esc(m.photo) + '" alt="这一顿的照片" loading="lazy">';
      if (s) h += '<div style="margin-top:10px"><button class="fd-link" data-shop="' + s.id + '">去这家店 ›</button></div>';
    } else {
      h += '<h3 class="fd-fs" style="margin-top:0">哪天、哪一顿</h3><input class="fd-in" type="date" data-md aria-label="哪天" max="' + esc(here().today) + '" value="' + esc(m.eaten_on) + '">' +
        '<div class="chips chips2" style="margin:0;padding:0;overflow:visible;flex-wrap:wrap">' +
        PICK.concat(m.slot && PICK.indexOf(m.slot) < 0 ? [m.slot] : []).map(function (sl) { return '<button class="chip' + (m.slot === sl ? ' on' : '') + '" data-ms="' + sl + '">' + sl + '</button>'; }).join('') + '</div>';
      if (s) h += '<h3 class="fd-fs">店里吃还是外卖</h3><div class="chips chips2" style="margin:0;padding:0;overflow:visible">' +
        [['堂食', '店里吃'], ['外卖', '外卖']].map(function (p) { return '<button class="chip' + ((m.how || '外卖') === p[0] || (p[0] === '堂食' && m.how === '自取') ? ' on' : '') + '" data-mh="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>';
      h += '<h3 class="fd-fs">花了多少</h3><div class="fd-pair"><input class="fd-in" data-mf="total" inputmode="decimal" value="' + (m.total != null ? esc(m.total) : '') + '" placeholder="这顿一共多少钱" autocomplete="off">' +
        '<select class="fd-cur" data-mf="currency" aria-label="币种">' + CURS.map(function (k) { return '<option value="' + k + '"' + (m.currency === k ? ' selected' : '') + '>' + CUR[k] + '</option>'; }).join('') + '</select></div>';
      h += '<h3 class="fd-fs">每道菜</h3>' + logs.map(function (l) {
        return '<div class="fd-dish" style="padding-bottom:4px"><div class="fd-lrow"><input class="fd-in" data-ln="' + l.id + '" value="' + esc(dishName(l)) + '" placeholder="菜名" autocomplete="off">' +
          '<button class="fd-del" data-del="log:' + l.id + '" aria-label="删掉 ' + esc(dishName(l)) + '">删</button></div><div class="fd-vbig">' +
          ['good', 'meh', 'bad'].map(function (v) { return '<button class="' + (l.verdict === v ? 'on' : '') + '" data-lv="' + l.id + ':' + v + '">' + svg(v) + V[v] + '</button>'; }).join('') + '</div>' +
          '<input class="fd-in" data-lnote="' + l.id + '" value="' + esc(l.note || '') + '" placeholder="一句话" autocomplete="off"></div>';
      }).join('') +
        '<div class="fd-lrow"><input class="fd-in" data-newlog placeholder="再加一道" autocomplete="off"><button class="fd-btn" data-addlog>加上</button></div>';   // 存了以后也能加菜（第六轮）
      if (s) h += '<h3 class="fd-fs">这顿整体</h3><div class="fd-vbig">' + ['good', 'meh', 'bad'].map(function (v) { return '<button class="' + (m.verdict === v ? 'on' : '') + '" data-mv="' + v + '">' + svg(v) + V[v] + '</button>'; }).join('') + '</div>';
      h += '<h3 class="fd-fs">想说的</h3><textarea class="fd-in" data-mf="note" rows="2" aria-label="想说的">' + esc(m.note || '') + '</textarea>';
      h += '<div style="margin-top:24px"><button class="fd-btn" data-del="meal:' + m.id + '" style="color:var(--sub)">删掉这一顿</button></div>';
    }
    rebuild($('fdmealbody'), h, renderMeal);
    return true;
  }

  function openCities() { renderCities(); openSub(citiesP); }
  function renderCities() {
    var cs = cities(), c = curCity();
    var h = '<div class="fd-list"><button class="fd-row" data-city=""><span class="fd-main"><span class="t">哪座城都算</span></span>' + (c === '' ? svg('check', 'fd-check') : '') + '</button>' +
      cs.map(function (x) {
        return '<button class="fd-row" data-city="' + esc(x.city) + '"><span class="fd-main"><span class="t">' + esc(x.city) + '</span><span class="s">' + (x.city === here().city ? '我现在在这儿' + (here().spot ? ' · ' + esc(here().spot) : '') + ' · ' : '') + x.n + ' 顿</span></span>' +
          (c === x.city ? svg('check', 'fd-check') : '') + '</button>';
      }).join('') + '</div>';
    if (SOLO) {
      h += '<h3 class="fd-fs" style="margin-top:32px;padding-top:18px;border-top:1px solid var(--line)">我现在在哪</h3>' +
        fl('城市', '<input class="fd-in" id="fdmovein" autocomplete="off" value="' + esc(here().city || '') + '">') +
        '<div class="fd-pair">' + fl('附近', '<input class="fd-in" id="fdmovespot" autocomplete="off" value="' + esc(here().spot || '') + '">') +
        '<button class="fd-primary" id="fdmovego" style="flex:none;min-height:46px;margin-bottom:8px">记住</button></div>';
    }
    rebuild($('fdcitybody'), h);
  }

  /* ───────── 点 ───────── */
  function arm(b, go) {   /* 删东西两下才算：点一下变「再点一下删」，三秒内再点才真删 */
    if (b.dataset.armed && Date.now() - +b.dataset.armed < 3000) { go(); return; }
    b.dataset.armed = Date.now();
    b.dataset.txt = b.dataset.txt || b.textContent;
    b.dataset.al = b.dataset.al || b.getAttribute('aria-label') || '';
    if (b.dataset.al) b.setAttribute('aria-label', '再点一下就' + b.dataset.al);
    b.textContent = b.classList.contains('fd-del') ? '确定' : '再点一下，删掉';   // 小删键宽度不变（1008：变「再点一下删」会往左长 44px）
    b.classList.add('armed');
    setTimeout(function () { if (b.isConnected) { b.textContent = b.dataset.txt; b.classList.remove('armed'); delete b.dataset.armed; if (b.dataset.al) b.setAttribute('aria-label', b.dataset.al); } }, 3000);
  }
  var editEl = null;
  function edit(kind, id, fields, ok) {
    var el = editEl; editEl = null;
    return api('/api/food/edit', { kind: kind, id: id, fields: fields }).then(function () { if (el) el.removeAttribute('aria-invalid'); if (ok) say(ok); return load(true); })
      .catch(function (er) { say(er.message); if (el && el.isConnected) { el.setAttribute('aria-invalid', 'true'); var pe = el.parentNode.querySelector('.fd-ferr[data-for]'); if (!pe) { pe = document.createElement('p'); pe.className = 'fd-ferr'; pe.setAttribute('data-for', ''); pe.id = 'fdferr' + Date.now(); (el.closest('.fd-fl') || el).insertAdjacentElement('afterend', pe); } pe.textContent = '没存上：' + er.message + (/同名/.test(er.message) ? '。换个名字，或者回去改原来那条' : '。改一下再离开这一格'); el.setAttribute('aria-describedby', pe.id); } });   // 存不上：这一格标出来，别让她以为存了（第六轮）
  }
  function onTap(e) {
    var b;
    anchorKey = e.target.closest && e.target.closest('.subwrap') ? keyOf(e.target) : null;
    if ((b = e.target.closest('[data-close]'))) {
      var p = $(b.dataset.close);
      if (p === page) { page.classList.remove('on'); if (window.navBack) window.navBack(); } else closeSub(p);
      return;
    }
    if ((b = e.target.closest('[data-v]'))) {
      if (b.dataset.v === view && !q) { swOf(page).scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); return; }   // 再点一下这一档＝回到顶，不重画
      goView(b.dataset.v); return;
    }
    if ((b = e.target.closest('[data-fgo]'))) {   // 1008：别叫 data-go —— 家里的底栏 tab 认 data-go，一点就把所有二级页全掀掉
      var g = b.dataset.fgo;
      if (g === 'hist') openHist();
      else if (g === 'cities') openCities();
      else { if (g === 'badall') { shopFilter = 'bad'; fromBadall = true; } goView(g === 'badall' ? 'shops' : g, true); if (g === 'badall') fromBadall = true; }
      return;
    }
    if ((b = e.target.closest('[data-meal]'))) { openMeal(b.dataset.meal); return; }
    if ((b = e.target.closest('[data-shop]'))) {
      if (b.closest('#foodmeal') && isOn(shopP)) {   // 店 → 一顿 → 去这家店：底下就是店页，回到它（别再盖一张、别断返回）
        if (+b.dataset.shop !== shopId) { shopId = +b.dataset.shop; shopEdit = false; renderShop(); }
        closeSub(mealP); return;
      }
      openShop(b.dataset.shop); return;
    }
    if ((b = e.target.closest('[data-sf]'))) { shopFilter = b.dataset.sf; fromBadall = false; render(false); [].forEach.call($('fdmain').querySelectorAll('.fd-list, .fd-gh, .fd-empty'), function (el) { el.style.setProperty('--m6d', '0ms'); el.classList.add('fd-fade'); }); return; }
    if ((b = e.target.closest('[data-tmore]'))) { tasteMore[b.dataset.tmore] = !tasteMore[b.dataset.tmore]; render(false); return; }
    if ((b = e.target.closest('[data-tedit]'))) { var hadF = b.contains(document.activeElement); tasteEdit = !tasteEdit; tasteOpen = {}; addKind = ''; render(true); if (hadF) { var tf = tasteEdit ? $('fdtopdone') : $('fdmain').querySelector('[data-tedit]'); if (tf) try { tf.focus({ preventScroll: true }); } catch (er) {} } return; }   /* 换成另一种样子：整块淡进来，读作「换了模式」不读作跳 */   // 不自动弹键盘：点编辑多半是想删一样、改一样
    if ((b = e.target.closest('[data-topen]')) && !e.target.closest('[data-del]')) { var oid = +b.dataset.topen; if (tasteOpen[oid]) { var ot = b.closest('.fd-trow').nextElementSibling; tasteOpen[oid] = false; if (ot && ot.classList.contains('fd-te')) { keepRoom(swOf(page), ot.offsetHeight); fold(ot, function () { render(false); }); return; } } else { tasteOpen[oid] = true; openedNow = oid; } render(false);   /* 各开各的：点开这一行不去收别的，点哪行哪行都不动（1008：收上面那行会把这行顶走 220px） */ return; }
    if ((b = e.target.closest('[data-tek]'))) { var tk = b.dataset.tek.split(':'); edit('taste', +tk[0], { kind: tk[1] }, '挪到「' + TK[tk[1]] + '」了'); return; }
    if ((b = e.target.closest('[data-addk]'))) { addKind = b.dataset.addk; render(false); return; }
    if (e.target.closest('#fdaddgo')) { addTaste(); return; }
    if ((b = e.target.closest('[data-bnblack]'))) { var bs = +b.dataset.bnblack; dropBanner(function () { edit('shop', bs, { verdict: 'bad' }, '整家拉黑了，下回替你挡'); }); return; }
    if (e.target.closest('[data-bnok]')) { dropBanner(function () { render(false); }); return; }
    if ((b = e.target.closest('[data-dm]'))) { if (diceMode !== b.dataset.dm) { diceMode = b.dataset.dm; if (onlyCuisine) { onlyCuisine = ''; diceBy.dish = null; } if (!diceBy[diceMode]) rollDice(true); render(false); } return; }   // 第一次切过去也先丢好，不留一张空卡
    if (e.target.closest('[data-dpick]')) {   // 丢出来以后有下一步：一个方向 → 在这一路里丢一道；一道菜 → 就吃它，记一笔
      var dk = diceBy[diceMode]; if (!dk) return;
      if (dk.mode === 'way') { diceMode = 'dish'; onlyCuisine = dk.cuisine; render(false); rollDice(false); }   // 只在这一路里丢（第五轮：原来只是往那边偏，小菜系四十次中八次）
      else { openForm(null, '', dk.name); pick('fnSlot', slotNow(0)); if (dateAuto) $('fnDate').value = autoDay(slotNow(0)); summary(); }
      return;
    }   // 两种丢法各留各的结果
    if (e.target.closest('[data-retry]')) { $('fdmain').innerHTML = '<p class="fd-empty">翻一下…</p>'; load(); return; }
    if (e.target.closest('[data-addlog]')) { addLog(true); return; }   // 记好的一顿再加一道
    if (e.target.closest('[data-donly]')) { onlyCuisine = ''; rollDice(false); return; }
    if (e.target.closest('[data-dcopy]')) {
      var gt = garnish(diceBy.dish || {});
      if (gt && navigator.clipboard) navigator.clipboard.writeText(gt).then(function () { say('复制了：' + gt + '，点外卖时贴进备注'); }, function () { say('复制不了，记着：' + gt); });
      else if (gt) say('记着：' + gt);
      return;
    }
    if ((b = e.target.closest('[data-roll]'))) { if (rolling) return; b.setAttribute('aria-disabled', 'true'); rollDice(); return; }   // 不用 disabled：焦点留在按钮上（复查：丢完焦点掉回 body）
    if ((b = e.target.closest('[data-newshop]'))) { openForm(null, b.dataset.newshop); return; }
    if ((b = e.target.closest('[data-newdish]'))) { openForm(null, '', b.dataset.newdish); return; }
    if ((b = e.target.closest('[data-histmore]'))) { histLimit += 30; renderHist(); return; }
    if (e.target.closest('#fdshopedit')) { shopEdit = !shopEdit; renderShop(); return; }
    if ((b = e.target.closest('[data-sv]'))) { var sv = b.dataset.sv.split(':'); edit('shop', +sv[0], { verdict: sv[1] || null }, sv[1] === 'bad' ? '拉黑了，下回替你挡' : sv[1] === 'good' ? '记住了，认准这家' : '好'); return; }
    if (e.target.closest('#fdagain')) { openForm(X.shop[shopId]); return; }
    if (e.target.closest('#fdmealedit')) { mealEdit = !mealEdit; renderMeal(); return; }
    if ((b = e.target.closest('[data-ms]'))) { edit('meal', mealId, { slot: b.dataset.ms }); return; }
    if ((b = e.target.closest('[data-mh]'))) { edit('meal', mealId, { how: b.dataset.mh }); return; }
    if ((b = e.target.closest('[data-mv]'))) { var mm = X.meal[mealId]; edit('meal', mealId, { verdict: mm && mm.verdict === b.dataset.mv ? null : b.dataset.mv }); return; }
    if ((b = e.target.closest('[data-lv]'))) {
      var lv = b.dataset.lv.split(':'), lg = D.logs.filter(function (l) { return l.id === +lv[0]; })[0];
      edit('log', +lv[0], { verdict: lg && lg.verdict === lv[1] ? null : lv[1] });   // 再点一下同一个＝不打分
      return;
    }
    if ((b = e.target.closest('[data-city]'))) {
      scope = b.dataset.city === here().city ? null : b.dataset.city; closeSub(citiesP); render(false);
      [].forEach.call($('fdmain').querySelectorAll(view === 'today' ? '[data-sec="bie"]' : '.fd-list, .fd-gh, .fd-empty'), function (el) { el.style.setProperty('--m6d', '0ms'); el.classList.add('fd-fade'); });   // 换城市：只让变了的那块动
      return;
    }
    if (e.target.closest('#fdmovego')) { moveCity(); return; }
    if ((b = e.target.closest('[data-del]'))) {
      var r = b.dataset.del.split(':'), rid = +r[1];
      var n0 = r[0] === 'branch' ? (X.byBranch[rid] || []).length : r[0] === 'shop' ? mealsOfShop(X.shop[rid] || {}).length : 0;
      if (!b.dataset.armed && n0) say('再点一下，连吃过的 ' + n0 + ' 顿一起删');   // 第一下就说清后果
      arm(b, function () {
        var tt = r[0] === 'taste' ? (D.taste || []).filter(function (x) { return x.id === rid; })[0] : null, bb = r[0] === 'branch' ? X.branch[rid] : null, ss = r[0] === 'shop' ? X.shop[rid] : null, mm = r[0] === 'meal' ? X.meal[rid] : null;
        var label = tt ? '「' + tname(tt) + '」' : bb ? '分店 ' + [bb.city, bb.area, bb.label].filter(Boolean).join(' · ') + (n0 ? '，连 ' + n0 + ' 顿' : '') : ss ? '「' + ss.name + '」' + (n0 ? '，连 ' + n0 + ' 顿' : '') : mm ? short(mm.eaten_on) + ' ' + (mm.slot || '') + ' 那一顿' : '';
        var lg0 = r[0] === 'log' ? D.logs.filter(function (x) { return x.id === rid; })[0] : null;
        softDel(r[0], rid, lg0 ? '「' + dishName(lg0) + '」' : label);
      });
    }
  }
  function dropBanner(then) {   /* 横幅慢慢收起，下面的跟着慢慢上来，不一下子缩 140px */
    var el = $('fdmain').querySelector('.fd-banner');
    banner = null;
    if (!el) { then(); return; }
    fold(el, then, 220);
  }
  function addTaste() {
    var inp = $('fdaddin'), item = inp.value.trim(), note = $('fdaddnote').value.trim();
    if (!item) { inp.focus(); return; }
    if (!addKind) { say('选一下放进哪一档'); return; }
    api('/api/food/taste', { item: item, kind: addKind, note: note }).then(function (r) {
      inp.value = ''; $('fdaddnote').value = '';
      say(r.moved ? '「' + item + '」挪到「' + TK[addKind] + '」了' : '记上了：' + TK[addKind] + ' · ' + item);
      return load(true);
    }).then(function () { inp.focus(); }).catch(function (er) { say(er.message); });
  }
  function moveCity() {
    var v = ($('fdmovein').value || '').trim(), sp = ($('fdmovespot').value || '').trim();
    if (!v) { $('fdmovein').focus(); return; }
    api('/api/settings', { city: v, spot: sp }).then(function () { scope = null; closeSub(citiesP); say('记住了，你在' + v + (sp ? ' ' + sp : '')); return load(true); }).catch(function (er) { say(er.message); });
  }
  var addingLog = false;
  function addLog(fromBtn) {   /* 第七轮：回车加的时候焦点还在格子里，重画被推迟，看起来没加上；写了没点「加上」就走，也替她加 */
    var ni = $('fdmealbody').querySelector('[data-newlog]'), b = $('fdmealbody').querySelector('[data-addlog]'), nn = ni && ni.value.trim();
    if (!nn) { if (fromBtn && ni) ni.focus(); return; }
    if (addingLog) return;
    addingLog = true; if (b) b.disabled = true;
    var back = isOn(mealP) && mealEdit && (document.activeElement === ni || document.activeElement === b);
    ni.value = ''; ni.blur();
    api('/api/food/addlog', { meal_id: mealId, dish: { name: nn } }).then(function () { say('加上了'); return load(true); })
      .catch(function (er) { say(er.message); var n2 = $('fdmealbody').querySelector('[data-newlog]'); if (n2 && !n2.value) n2.value = nn; })
      .then(function () { addingLog = false; var b2 = $('fdmealbody').querySelector('[data-addlog]'); if (b2) b2.disabled = false;
        if (back) { var n3 = $('fdmealbody').querySelector('[data-newlog]'); if (n3) try { n3.focus({ preventScroll: true }); } catch (er) {} } });
  }
  function onChange(e) {   /* 编辑里的字：离开输入框就存 */
    var t = e.target;
    editEl = t;
    if (t.matches('[data-tei]')) {
      var f = {}; f[t.dataset.tei] = t.value;
      if (t.dataset.tei === 'item' && !t.value.trim()) { render(false); return; }
      var tt = (D.taste || []).filter(function (x) { return x.id === +t.dataset.id; })[0];
      if (t.dataset.tei === 'item' && tt && tt.scope) {   // 搭配那种显示的是整句：没改就不动，改了就存成一句话
        if (t.value.trim() === tname(tt)) { render(false); return; }
        f.scope = '';
      }
      edit('taste', +t.dataset.id, f, '存了');
    } else if (t.matches('[data-se]')) {
      var g = {}; g[t.dataset.se] = t.value;
      if (t.dataset.se === 'name' && !t.value.trim()) { renderShop(); return; }
      edit('shop', shopId, g, '存了');
    } else if (t.matches('[data-be]')) {
      var bf = {}; bf[t.dataset.be] = t.value.trim() || null;
      edit('branch', +t.dataset.id, bf, '存了');
    } else if (t.matches('[data-mf]')) {
      var mf = {}; mf[t.dataset.mf] = t.value.trim() || null;
      edit('meal', mealId, mf, '存了');
    } else if (t.matches('[data-ln]')) {
      var lg = D.logs.filter(function (x) { return x.id === +t.dataset.ln; })[0], nv = t.value.trim();
      if (!lg || !nv || nv === dishName(lg)) { renderMeal(); return; }
      var shopD = lg.dish_id && X.dish[lg.dish_id] ? X.dish[lg.dish_id].shop_id : null;
      var taken = shopD != null && D.dishes.some(function (x) { return x.shop_id === shopD && x.id !== lg.dish_id && low(x.name) === low(nv); });   // 这家已经有叫这个名字的（含删掉留下的）
      if (lg.dish_id && ((X.byDish[lg.dish_id] || []).length > 1 || taken)) {   // 第七轮：改一顿里的菜名，别的几顿跟着改了名；改成已有的那道就换过去
        api('/api/food/addlog', { meal_id: lg.meal_id, dish: { name: nv, verdict: lg.verdict, note: lg.note, price: lg.price } })
          .then(function () { return api('/api/food/del', { kind: 'log', id: lg.id }); }).then(function () { say('这一顿改好了，别的几顿没动'); return load(true); })
          .catch(function (er) { say(er.message); });
      } else if (lg.dish_id) edit('dish', lg.dish_id, { name: nv }, '改好了'); else edit('log', lg.id, { name: nv }, '改好了');
    } else if (t.matches('[data-newlog]')) {
      addLog(false);
    } else if (t.matches('[data-lnote]')) {
      edit('log', +t.dataset.lnote, { note: t.value.trim() || null }, '存了');
    } else if (t.matches('[data-md]') && t.value) {
      edit('meal', mealId, { eaten_on: t.value }, '改好了');
    }
  }
  function onEsc(e) {   /* Esc 在整页上听：关最上面那张 / 收起编辑框 / 退出编辑（复查：只在各页里听，焦点不在页里按了没反应） */
    if (e.key !== 'Escape' || !isOn(page)) return;
    var tops = [form, citiesP, mealP, shopP, hist].filter(isOn).sort(function (a, b) { return [].indexOf.call(app.children, b) - [].indexOf.call(app.children, a); });
    if (tops.length) {   // 第七轮：在编辑里按 Esc 先退出编辑
      if (tops[0] === mealP && mealEdit) { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); mealEdit = false; renderMeal(); try { $('fdmealedit').focus({ preventScroll: true }); } catch (er) {} return; }
      if (tops[0] === shopP && shopEdit) { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); shopEdit = false; renderShop(); try { $('fdshopedit').focus({ preventScroll: true }); } catch (er) {} return; }
      closeSub(tops[0]); return;
    }
    if (Object.keys(tasteOpen).some(function (k) { return tasteOpen[k]; })) { var lost = 0; [].forEach.call($('fdmain').querySelectorAll('.fd-te'), function (t) { lost += t.offsetHeight; }); keepRoom(swOf(page), lost); tasteOpen = {}; render(false); return; }   // 第六轮：Esc 收最后一行跳 33.5px
    if (tasteEdit) { tasteEdit = false; render(true); }
  }
  function onKey(e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.id === 'fdaddin' || t.id === 'fdaddnote') { e.preventDefault(); addTaste(); }
    else if (t.id === 'fdmovein' || t.id === 'fdmovespot') { e.preventDefault(); moveCity(); }
    else if (t.matches('[data-newlog]')) { e.preventDefault(); var ab = t.parentNode.querySelector('[data-addlog]'); if (ab) ab.click(); }
    else if (t.matches('[data-tei], input[data-se], [data-be], input[data-mf], [data-ln], [data-lnote]')) { e.preventDefault(); t.blur(); }
    else if (t.id === 'fdq') { e.preventDefault(); t.blur(); }
    else if (t.matches('[data-topen]')) { e.preventDefault(); t.click(); }
  }
  function wire() {
    [page, hist, shopP, mealP, citiesP].forEach(function (p) {
      p.addEventListener('click', onTap);
      p.addEventListener('change', onChange);
      p.addEventListener('keydown', onKey);
    });
    document.addEventListener('keydown', onEsc);
    $('foodadd').addEventListener('click', function () { openForm(); });
    function setQ(v) {
      var sw = swOf(page), was = q;
      if (!was && v) searchFrom = sw.scrollTop;
      q = v; $('fdqx').hidden = !q; anchorKey = null; render(false);
      if (was && !q && searchFrom != null) { sw.scrollTop = searchFrom; searchFrom = null; }
      else if (q) sw.scrollTop = 0;
    }
    $('fdq').addEventListener('input', function () { setQ(this.value.trim()); });
    $('fdqx').addEventListener('click', function (e) { e.preventDefault(); $('fdq').value = ''; setQ(''); $('fdq').focus({ preventScroll: true }); });
    document.addEventListener('touchstart', function () {}, { passive: true });   // iOS 上没有这一行 :active 不亮
    document.addEventListener('focusout', function () {   // 打字时没重画的那块：离开输入框补画一次
      setTimeout(function () { ['fdmain', 'fdshopbody', 'fdmealbody'].forEach(function (id) { var bx = $(id); if (bx && bx.__redo && !typingIn(bx)) { var f = bx.__redo; bx.__redo = null; f(); } }); }, 0);
    }, true);
    wireForm();
    nameInputs(page); nameInputs(form);
    if (!SOLO) {   /* 家里：推开就去取一次 */
      new MutationObserver(function () { if (page.classList.contains('on') && !page.__was) load(); page.__was = page.classList.contains('on'); })
        .observe(page, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ───────── 记一笔（从底下升上来） ───────── */
  function buildForm() {
    return top('foodnew', '记一笔', { closeX: true, right: '<button class="iconbtn fd-topbtn" id="fnClear">清空</button>' }) +
      '<div class="subwrap">' +
      '<h2 class="fd-fh">在哪家</h2>' +
      '<input class="fd-in" id="fnShop" list="fdlShops" placeholder="店名" autocomplete="off">' +
      '<p class="fd-err" id="fnShopErr" hidden></p>' +
      '<div class="chips chips2" id="fnRecent" style="margin-top:-2px" hidden></div>' +
      '<h2 class="fd-fh">吃了什么</h2>' +
      '<div id="fnDishes"></div>' +
      '<button class="fd-link" id="fnMore">再加一道 ›</button>' +
      '<h3 class="fd-fs">这顿整体</h3>' +
      '<div class="fd-vbig" id="fnVerdict">' + ['good', 'meh', 'bad'].map(function (v) { return '<button data-v="' + v + '">' + svg(v) + V[v] + '</button>'; }).join('') + '</div>' +
      '<button class="fd-sum" id="fnSumBtn" aria-expanded="false"><span id="fnSum"></span><span class="r"><span id="fnSumT">更多</span>' + svg('down') + '</span></button>' +
      '<div id="fnMoreBox" hidden>' +
      '<h3 class="fd-fs">哪天、哪一顿</h3>' +
      '<input class="fd-in" type="date" id="fnDate" aria-label="哪天">' +
      '<div class="chips chips2" id="fnSlot" style="flex-wrap:wrap;margin:0 0 8px;padding:0">' + PICK.map(function (s) { return '<button class="chip" data-v="' + s + '">' + s + '</button>'; }).join('') + '</div>' +
      '<h3 class="fd-fs">店里吃还是外卖</h3>' +
      '<div class="chips chips2" id="fnFrom" style="margin:0 0 8px;padding:0"><button class="chip" data-v="dine">店里吃</button><button class="chip on" data-v="deliver">外卖</button></div>' +
      fl('平台', '<input class="fd-in" id="fnPlat" list="fdlPlats" autocomplete="off">') +
      '<h3 class="fd-fs">在哪</h3>' +
      '<div class="fd-pair fd-cs">' + fl('城市', '<input class="fd-in" id="fnCity" list="fdlCities" autocomplete="off">') +
      fl('区', '<input class="fd-in" id="fnArea" list="fdlAreas" autocomplete="off">') + '</div>' +
      '<p class="fd-err" id="fnCityErr" hidden></p>' +
      '<div class="chips chips2" id="fnBranches" style="flex-wrap:wrap;margin:0 0 8px;padding:0" hidden></div>' +
      fl('分店', '<input class="fd-in" id="fnLabel" autocomplete="off">') +
      fl('地址', '<input class="fd-in" id="fnAddr" autocomplete="off">') +
      '<h3 class="fd-fs">这家店</h3>' +
      '<input class="fd-in" id="fnCui" list="fdlCuis" placeholder="菜系" autocomplete="off">' +
      '<h3 class="fd-fs">花了多少</h3>' +
      '<div class="fd-pair"><input class="fd-in" id="fnTotal" inputmode="decimal" placeholder="这顿一共多少钱" autocomplete="off">' +
      '<select class="fd-cur" id="fnCur" aria-label="币种">' + CURS.map(function (k) { return '<option value="' + k + '">' + CUR[k] + '</option>'; }).join('') + '</select></div>' +
      '<h3 class="fd-fs">想说的</h3>' +
      '<textarea class="fd-in" id="fnNote" rows="2" placeholder="随便写两句"></textarea>' +
      '<div class="fd-photo"><button class="fd-btn" id="fnPhotoBtn">' + svg('cam') + '<span>加张照片</span></button>' +
      '<input type="file" accept="image/*" id="fnPhoto" hidden><img id="fnPhotoImg" alt="这一顿的照片" hidden></div>' +
      '</div></div>' +
      '<div class="fd-dock"><button class="fd-primary fd-wide" id="fnSave">记下来</button></div>' +
      ['Shops', 'Cities', 'Areas', 'Cuis', 'Plats', 'Dishes'].map(function (n) { return '<datalist id="fdl' + n + '"></datalist>'; }).join('');
  }
  var photo = '', dirty = false, dateAuto = true;
  function autoDay(slot) {   /* 五点到六点：一天刚开始，这时候记的除了早饭都是昨天那一天的（第七轮 P3-5） */
    var t = here().today;
    if (new Date().getHours() !== 5 || slot === '早饭') return t;
    var yd = new Date(t + 'T12:00:00'); yd.setDate(yd.getDate() - 1);
    return yd.getFullYear() + '-' + ('0' + (yd.getMonth() + 1)).slice(-2) + '-' + ('0' + yd.getDate()).slice(-2);
  }
  function pick(box, v) { [].forEach.call($(box).querySelectorAll('[data-v]'), function (c) { c.classList.toggle('on', c.dataset.v === v); c.setAttribute('aria-pressed', c.dataset.v === v); }); }
  function picked(box) { var c = $(box).querySelector('[data-v].on'); return c ? c.dataset.v : ''; }
  function fill(id, arr) { $(id).innerHTML = arr.filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return '<option value="' + esc(v) + '">'; }).join(''); }
  function shopByName(n) { if (!D || !n) return null; n = low(n); return D.shops.filter(function (s) { return low(s.name) === n; })[0] || null; }
  function setCur(cur) { $('fnCur').value = CUR[cur] ? cur : 'CNY'; }
  function dishRow() {
    var d = document.createElement('div');
    d.className = 'fd-dish';
    d.innerHTML = '<input class="fd-in fdn" list="fdlDishes" placeholder="菜名" autocomplete="off">' +
      '<button class="fd-x" aria-label="不要这一道">' + svg('close') + '</button>' +
      '<div class="fd-vbig">' + ['good', 'meh', 'bad'].map(function (v) { return '<button data-dv="' + v + '">' + svg(v) + V[v] + '</button>'; }).join('') + '</div>' +
      '<input class="fd-in fdc" placeholder="一句话" autocomplete="off" style="margin:0">';
    $('fnDishes').appendChild(d);
    return d;
  }
  function recentShops() {
    var c = $('fnCity').value.trim() || here().city, seen = {}, out = [];
    D.meals.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).forEach(function (m) {
      var s = shopOfMeal(m);
      if (s && !seen[s.id] && s.verdict !== 'bad' && (!c || m.city === c)) { seen[s.id] = 1; out.push(s); }
    });
    return out.slice(0, 6);
  }
  function refreshLists() {
    if (!D) return;
    var s = shopByName($('fnShop').value), c = $('fnCity').value.trim();
    fill('fdlShops', D.shops.map(function (x) { return x.name; }));
    fill('fdlCities', [here().city].concat(D.branches.map(function (b) { return b.city; }), D.meals.map(function (m) { return m.city; })));
    fill('fdlAreas', D.branches.filter(function (b) { return !c || low(b.city) === low(c); }).map(function (b) { return b.area; }));
    fill('fdlCuis', ['川菜', '粤菜', '湘菜', '火锅', '日料', '韩餐', '东南亚', '西餐', '快餐', '奶茶甜品'].concat(D.shops.map(function (x) { return x.cuisine; })));
    fill('fdlPlats', PLATS.concat(D.branches.map(function (b) { return b.platform; })));
    fill('fdlDishes', s ? (X.dishesOf[s.id] || []).map(function (d) { return d.name; }) : []);
    var rs = recentShops(), rb = $('fnRecent'), typed = low($('fnShop').value);
    rb.hidden = !rs.length;   // 1008：一打字就藏，下面整块往上窜 52px；现在跟着打的字筛，对不上的先收起来，那一排的位置一直留着
    rb.innerHTML = rs.map(function (x) { var n = low(x.name), hit = !typed || n.indexOf(typed) >= 0; return '<button class="chip' + (hit ? '' : ' hide') + (typed && n === typed ? ' on' : '') + '" data-rs="' + x.id + '">' + esc(x.name) + '</button>'; }).join('');
    var brs = s ? (X.branchesOf[s.id] || []) : [], bx = $('fnBranches');
    bx.hidden = brs.length < 2;
    bx.innerHTML = brs.map(function (b) { return '<button class="chip" data-br="' + b.id + '">' + esc([b.city, b.area, b.label].filter(Boolean).join(' · ')) + '</button>'; }).join('') +
      '<button class="chip" data-br="">新的一家分店</button>';
    if (s && s.cuisine && !$('fnCui').value) $('fnCui').placeholder = '菜系：' + s.cuisine;
  }
  function summary() {
    var d = $('fnDate').value, t = here().today;
    $('fnSum').textContent = [d === t ? '今天' : short(d), picked('fnSlot'), picked('fnFrom') === 'dine' ? '店里吃' : '外卖', $('fnCity').value.trim() || '城市还没写'].filter(Boolean).join(' · ');
    $('fnPlat').disabled = picked('fnFrom') !== 'deliver';
  }
  function setMore(open) { $('fnMoreBox').hidden = !open; $('fnSumBtn').classList.toggle('open', open); $('fnSumBtn').setAttribute('aria-expanded', open); $('fnSumT').textContent = open ? '收起' : '更多'; }
  function useBranch(b) {
    $('fnCity').value = b.city; $('fnArea').value = b.area || ''; $('fnLabel').value = b.label || '';
    $('fnAddr').value = b.address || ''; $('fnPlat').value = b.platform || '';
    setCur(curFor(b.city));
  }
  function latestBranch(s) {
    var m = mealsOfShop(s)[0];
    return (m && X.branch[m.branch_id]) || (X.branchesOf[s.id] || [])[0];
  }
  function clearErr() { $('fnShopErr').hidden = true; $('fnCityErr').hidden = true; [].forEach.call($('fnDishes').querySelectorAll('.fd-err'), function (p) { p.remove(); }); }
  var FIELDS = ['fnShop', 'fnCity', 'fnArea', 'fnLabel', 'fnCui', 'fnAddr', 'fnPlat', 'fnTotal', 'fnNote', 'fnDate', 'fnCur'];
  function snapForm() {
    var v = {}; FIELDS.forEach(function (i) { v[i] = $(i).value; });
    return { v: v, slot: picked('fnSlot'), from: picked('fnFrom'), verdict: picked('fnVerdict'), photo: photo,
      dishes: [].map.call($('fnDishes').children, function (r) { var on = r.querySelector('[data-dv].on'); return { n: r.querySelector('.fdn').value, c: r.querySelector('.fdc').value, v: on ? on.dataset.dv : '' }; }) };
  }
  function restoreForm(sn) {
    FIELDS.forEach(function (i) { $(i).value = sn.v[i]; });
    pick('fnSlot', sn.slot); pick('fnFrom', sn.from); pick('fnVerdict', sn.verdict);
    photo = sn.photo; if (photo) { $('fnPhotoImg').src = photo; $('fnPhotoImg').hidden = false; }
    $('fnDishes').innerHTML = '';
    sn.dishes.forEach(function (d) { var r = dishRow(); r.querySelector('.fdn').value = d.n; r.querySelector('.fdc').value = d.c; if (d.v) { var b = r.querySelector('[data-dv="' + d.v + '"]'); b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); } });
    if (!sn.dishes.length) dishRow();
    refreshLists(); summary();
    dirty = true;   // 撤销回来的是她写的
  }
  function hasDraft() {   /* 草稿＝格子里真有她写的东西（复查：用一个清不掉的标记，开一次念叨一次） */
    if (photo) return true;
    if (['fnShop', 'fnArea', 'fnLabel', 'fnAddr', 'fnPlat', 'fnCui', 'fnTotal', 'fnNote'].some(function (i) { return $(i).value.trim(); })) return true;
    if (picked('fnVerdict')) return true;
    return [].some.call($('fnDishes').children, function (r) { return r.querySelector('.fdn').value.trim() || r.querySelector('.fdc').value.trim() || r.querySelector('[data-dv].on'); });
  }
  function openForm(shop, name, dish) {
    formUndoOff(); dropRoom(form.querySelector('.subwrap'));
    dirty = dirty && hasDraft();   // 草稿＝她自己打过字、点过的（第六轮：骰子替她填的菜关上再开，被当成草稿并进了别家店）
    var ds0 = $('fnShop').value.trim();
    if (dirty && (name || dish || (shop && ds0 && low(ds0) !== low(shop.name)))) { var sn0 = snapForm(); resetForm(shop || null); undoBar('换成这一笔了，上回那笔' + (sn0.v.fnShop ? '（' + sn0.v.fnShop + '）' : '') + '点撤销拿回来', function () { undoBar(null); restoreForm(sn0); }).dataset.form = '1'; setTimeout(function () { var u = document.getElementById('fdundo'); if (u && !pend && u.dataset.form) u.remove(); }, 10000); }   // 第七轮：原来说「收起来了」，六秒就没了
    else if (dirty) {   // 草稿还在：接着填，从店页进来也不悄悄清掉（1008）
      var ds = $('fnShop').value.trim();
      if (shop && !ds) { $('fnShop').value = shop.name; var lb0 = latestBranch(shop); if (lb0 && !$('fnArea').value) useBranch(lb0); refreshLists(); summary(); }
      openSub(form);
      say(shop && ds && low(ds) !== low(shop.name) ? '上回没记完的那笔（' + ds + '）还在，不要了点右上角「清空」' : '接着填上回没记完的那笔，不要了点右上角「清空」');
      return;
    }
    else resetForm(shop);
    if (name) { $('fnShop').value = name; refreshLists(); }
    if (dish) { var r0 = $('fnDishes').querySelector('.fdn'); if (r0) r0.value = dish; }
    form.querySelector('.subwrap').scrollTop = 0;
    openSub(form);
  }
  function resetForm(shop) {
    ['fnShop', 'fnCity', 'fnArea', 'fnLabel', 'fnCui', 'fnAddr', 'fnPlat', 'fnTotal', 'fnNote'].forEach(function (i) { $(i).value = ''; });
    $('fnCui').placeholder = '菜系';
    $('fnDishes').innerHTML = '';
    dishRow();
    photo = '';
    $('fnPhotoImg').hidden = true;
    clearErr();
    $('fnSave').disabled = false;
    $('fnDate').value = here().today;
    $('fnDate').value = autoDay(slotNow()); dateAuto = true;
    $('fnDate').max = here().today;
    pick('fnSlot', slotNow());
    pick('fnFrom', 'deliver');
    pick('fnVerdict', '');
    $('fnCity').value = here().city || '';
    setCur(curFor($('fnCity').value));
    if (shop) { $('fnShop').value = shop.name; var b = latestBranch(shop); if (b) useBranch(b); }
    refreshLists();
    summary();
    setMore(!$('fnCity').value);   // 城市还不知道：把「更多」打开，让她一眼看见要填哪
    dirty = false;
  }
  function shrink(file) {   /* 长边压到 1280 再传 */
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('这张图打不开')); };
      img.src = url;
    });
  }
  function showErr(id, field, msg, openMore) {
    if (openMore) setMore(true);
    var p = $(id); p.textContent = msg; p.hidden = false;
    $(field).focus();
    $(field).scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' });
  }
  function save() {
    clearErr();
    var dishes = [], noname = null;
    [].forEach.call($('fnDishes').children, function (r) {
      var n = r.querySelector('.fdn').value.trim(), v = r.querySelector('[data-dv].on');
      if (!n) { if ((v || r.querySelector('.fdc').value.trim()) && !noname) noname = r; return; }   // 打了分没写名字：别悄悄扔
      dishes.push({ name: n, verdict: v ? v.dataset.dv : null, note: r.querySelector('.fdc').value.trim() || null });
    });
    var name = $('fnShop').value.trim(), city = $('fnCity').value.trim();
    if (!name) { showErr('fnShopErr', 'fnShop', '店名要写', false); return; }
    if (!city) { showErr('fnCityErr', 'fnCity', '城市要写，不同城市的雷分开放', true); return; }
    if (noname) {
      var ep = document.createElement('p'); ep.className = 'fd-err'; ep.textContent = '这道叫什么？写上名字才记得住';
      noname.querySelector('.fdn').insertAdjacentElement('afterend', ep);
      noname.querySelector('.fdn').focus(); noname.scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' });
      return;
    }
    var body = {
      shop: { name: name, cuisine: $('fnCui').value.trim() || null },
      branch: { city: city, area: $('fnArea').value.trim(), label: $('fnLabel').value.trim(), address: $('fnAddr').value.trim() || null, platform: picked('fnFrom') === 'deliver' ? ($('fnPlat').value.trim() || null) : null },
      meal: { eaten_on: $('fnDate').value, slot: picked('fnSlot') || null, how: picked('fnFrom') === 'dine' ? '堂食' : '外卖',
        total: $('fnTotal').value.trim() || null, currency: $('fnCur').value, verdict: picked('fnVerdict') || null,
        note: $('fnNote').value.trim() || null, photo: photo || null },
      dishes: dishes
    };
    flushDel();
    $('fnSave').disabled = true;
    api('/api/food/log', body).then(function (r) {
      var bad = dishes.filter(function (d) { return d.verdict === 'bad'; }).map(function (d) { return d.name; });
      var whole = !bad.length && picked('fnVerdict') === 'bad';   // 只点了这顿整体踩雷：一样替她挡
      banner = bad.length ? { names: bad, shopId: r.shop_id } : whole ? { names: [name + ' 这一顿'], shopId: r.shop_id } : null;
      if (!banner) say('记下了');
      dirty = false;
      closeSub(form);
      view = 'today'; q = ''; $('fdq').value = ''; $('fdqx').hidden = true; tasteEdit = false;
      return load().then(function () { page.querySelector('.subwrap').scrollTop = 0; });
    }).catch(function (e) { say(e.message); $('fnSave').disabled = false; });
  }
  function wireForm() {
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('click', function (e) {
      var b;
      if (e.target.closest('button') && !e.target.closest('[data-close], #fnSave, #fnSumBtn')) dirty = true;
      if ((b = e.target.closest('[data-close]'))) { closeSub(form); return; }
      if ((b = e.target.closest('#fnSlot .chip, #fnFrom .chip'))) { pick(b.parentNode.id, b.dataset.v); if (b.parentNode.id === 'fnSlot' && dateAuto) $('fnDate').value = autoDay(b.dataset.v); summary(); return; }
      if ((b = e.target.closest('#fnVerdict [data-v]'))) { pick('fnVerdict', b.classList.contains('on') ? '' : b.dataset.v); return; }
      if ((b = e.target.closest('[data-rs]'))) {
        var s = X.shop[+b.dataset.rs]; if (!s) return;
        $('fnShop').value = s.name; var lb = latestBranch(s); if (lb) useBranch(lb);
        clearErr(); refreshLists(); summary(); $('fnDishes').querySelector('.fdn').focus();
        return;
      }
      if ((b = e.target.closest('[data-br]'))) {
        var br = b.dataset.br && X.branch[+b.dataset.br];
        [].forEach.call($('fnBranches').children, function (c) { c.classList.toggle('on', c === b); });
        if (br) useBranch(br); else { ['fnArea', 'fnLabel', 'fnAddr', 'fnPlat'].forEach(function (i) { $(i).value = ''; }); $('fnArea').focus(); }
        summary();
        return;
      }
      if ((b = e.target.closest('[data-dv]'))) {
        var on = b.classList.contains('on');
        [].forEach.call(b.parentNode.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
        if (!on) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }            // 再点一下同一个＝不打分
        return;
      }
      if ((b = e.target.closest('.fd-x'))) {
        var row = b.closest('.fd-dish');
        if ($('fnDishes').children.length > 1) fold(row, function () { var hadF = row.contains(document.activeElement); row.remove(); if (hadF) try { $('fnMore').focus({ preventScroll: true }); } catch (er) {} });
        else { row.querySelectorAll('input').forEach(function (i) { i.value = ''; }); row.querySelectorAll('[data-dv]').forEach(function (x) { x.classList.remove('on'); }); row.querySelectorAll('.fd-err').forEach(function (x) { x.remove(); }); }   // 1008：最后一张点 ×，评价还亮着
        return;
      }
      if (e.target.closest('#fnMore')) { var nd = dishRow(); grow(nd); nd.querySelector('.fdn').focus({ preventScroll: true }); setTimeout(function () { nd.scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' }); }, RM ? 0 : 280); return; }
      if (e.target.closest('#fnSumBtn')) {
        var mb = $('fnMoreBox');
        if (mb.hidden) { setMore(true); grow(mb, 280); setTimeout(function () { var sw2 = form.querySelector('.subwrap'), over = mb.getBoundingClientRect().top + 220 - sw2.getBoundingClientRect().bottom; if (over > 0) sw2.scrollBy({ top: over, behavior: RM ? 'auto' : 'smooth' }); }, 120); }
        else {
          keepRoom(form.querySelector('.subwrap'), mb.offsetHeight);   // 垫住：「收起」停在手指底下（第五轮：原来跟着滑回去，按钮还是跑了 441px）
          fold(mb, function () { mb.getAnimations().forEach(function (a) { a.cancel(); }); mb.style.overflow = ''; setMore(false); }, 220);
        }
        return;
      }
      if (e.target.closest('#fnClear')) {
        if (!hasDraft()) { say('本来就是空的'); return; }
        var snap = snapForm();
        resetForm(null);
        undoBar('清空了这一笔', function () { undoBar(null); restoreForm(snap); say('回来了'); }).dataset.form = '1';   // 第五轮：关了表单它还在，撤销会把上一笔塞进下一张
        setTimeout(function () { var u = document.getElementById('fdundo'); if (u && !pend) u.remove(); }, 6000);
        return;
      }
      if (e.target.closest('#fnPhotoBtn')) { $('fnPhoto').click(); return; }
      if (e.target.closest('#fnSave')) { save(); }
    });
    $('fnShop').addEventListener('input', function () { clearErr(); refreshLists(); });
    $('fnShop').addEventListener('change', function () {
      var s = shopByName($('fnShop').value);
      refreshLists();
      if (s && !$('fnArea').value) { var lb = latestBranch(s); if (lb) useBranch(lb); summary(); }
    });
    $('fnCity').addEventListener('input', function () { $('fnCityErr').hidden = true; summary(); });
    $('fnCity').addEventListener('change', function () { setCur(curFor($('fnCity').value.trim())); refreshLists(); summary(); });
    $('fnDate').addEventListener('change', function () { dateAuto = false; summary(); });
    $('fnPhoto').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      say('传照片…');
      shrink(f).then(function (du) { return api('/api/upload', { dataURL: du }); })
        .then(function (j) { photo = j.url; $('fnPhotoImg').src = j.url; $('fnPhotoImg').hidden = false; dirty = true; })
        .catch(function (e) { say(e.message); });
      this.value = '';
    });
  }

  function start() {
    if (!build()) return;
    if (SOLO) { page.classList.add('on'); load(); }
  }
  if (document.getElementById('app')) start(); else document.addEventListener('DOMContentLoaded', start);
  window.foodUI = { reload: load };
})();
