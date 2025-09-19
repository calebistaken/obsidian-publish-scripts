// publish.js — Obsidian Publish inline debug panel (iPad friendly)
// Toggle with ?debug=1 or the floating bug button.
// MIT-ish; keep or tweak as you wish.
(() => {
  const QS = new URLSearchParams(location.search);
  const ENABLED = QS.get("debug") === "1";

  const STYLE_ID = "obs-publish-debug-style";
  const WRAP_ID  = "obs-publish-debug";
  const BTN_ID   = "obs-publish-debug-btn";

  if (document.getElementById(WRAP_ID)) return;

  const css = `
#${BTN_ID}{
  position:fixed;inset:auto 12px 12px auto;z-index:9999999;
  width:42px;height:42px;border-radius:21px;border:1px solid rgba(0,0,0,.2);
  background:rgba(255,255,255,.85);backdrop-filter:saturate(150%) blur(6px);
  box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;
  font:600 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;cursor:pointer;user-select:none
}
#${WRAP_ID}{
  position:fixed;inset:auto 12px 12px auto;z-index:9999998;
  width:min(92vw,820px);height:min(60vh,520px);display:none;flex-direction:column;
  background:rgba(18,18,18,.92);color:#eee;border:1px solid #333;border-radius:10px;
  box-shadow:0 12px 40px rgba(0,0,0,.45);backdrop-filter:saturate(150%) blur(8px)
}
#${WRAP_ID}.show{display:flex}
#${WRAP_ID} header{
  display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-bottom:1px solid #2b2b2b;
  -webkit-user-select:none;user-select:none;cursor:grab
}
#${WRAP_ID} header strong{font-weight:700}
#${WRAP_ID} header .sp{flex:1}
#${WRAP_ID} header button{
  background:#2a2a2a;border:1px solid #3a3a3a;color:#eee;border-radius:6px;padding:.35rem .6rem;cursor:pointer
}
#${WRAP_ID} main{flex:1;overflow:auto;padding:.5rem}
#${WRAP_ID} pre{white-space:pre-wrap;word-break:break-word;margin:0;font:12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace}
#${WRAP_ID} .line{padding:.25rem .35rem;border-bottom:1px dashed #2a2a2a}
#${WRAP_ID} .line.err{background:rgba(255,68,68,.08);border-left:3px solid #ff5c5c}
#${WRAP_ID} .line.warn{background:rgba(255,204,0,.08);border-left:3px solid #ffcc00}
#${WRAP_ID} .meta{opacity:.7}
#${WRAP_ID} footer{display:flex;gap:.5rem;border-top:1px solid #2b2b2b;padding:.5rem}
#${WRAP_ID} input[type=text]{flex:1;background:#1b1b1b;border:1px solid #343434;color:#eee;border-radius:6px;padding:.45rem .6rem}
.error-overlay{
  position:fixed;inset:0;pointer-events:none;z-index:9999997;
  background:linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.35));
  display:none
}
.error-overlay.show{display:block}
.error-overlay .box{
  position:absolute;right:12px;bottom:64px;max-width:min(92vw,840px);
  background:#1a0000;border:1px solid #550000;color:#ffd5d5;border-radius:10px;
  box-shadow:0 10px 30px rgba(0,0,0,.5);padding:.75rem .85rem
}
.error-overlay .box h3{margin:.2rem 0 .4rem 0;font:600 14px system-ui}
.error-overlay .box pre{white-space:pre-wrap;word-break:break-word;margin:0;font:12px ui-monospace}
  `;

  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent = css;
  document.documentElement.appendChild(styleEl);

  const btn = document.createElement("div");
  btn.id = BTN_ID;
  btn.title = "Toggle debug";
  btn.textContent = "🐞";
  document.body.appendChild(btn);

  const wrap = document.createElement("section");
  wrap.id = WRAP_ID;
  wrap.innerHTML = `
    <header><strong>Obsidian Publish • Debug</strong><span class="sp"></span>
      <button data-act="copy">Copy</button>
      <button data-act="clear">Clear</button>
      <button data-act="hide">Hide</button>
    </header>
    <main><pre id="dbg-log"></pre></main>
    <footer>
      <input id="dbg-eval" type="text" placeholder="Run JS (e.g., $$('h1'), app?.plugins)">
      <button data-act="run">Run</button>
    </footer>
  `;
  document.body.appendChild(wrap);

  const overlay = document.createElement("div");
  overlay.className = "error-overlay";
  overlay.innerHTML = `<div class="box"><h3>JavaScript error</h3><pre id="dbg-err"></pre></div>`;
  document.body.appendChild(overlay);

  const logEl = wrap.querySelector("#dbg-log");
  const evalInput = wrap.querySelector("#dbg-eval");

  // Helpers
  const now = () => new Date().toLocaleTimeString();
  const storeKey = "__obs_debug_log__";
  const getStore = () => {
    try { return JSON.parse(sessionStorage.getItem(storeKey) || "[]"); } catch { return []; }
  };
  const setStore = (arr) => {
    try { sessionStorage.setItem(storeKey, JSON.stringify(arr.slice(-1000))); } catch {}
  };
  const append = (type, msg) => {
    const line = document.createElement("div");
    line.className = "line" + (type === "error" ? " err" : type === "warn" ? " warn" : "");
    line.innerHTML = `<span class="meta">[${now()}] ${type.toUpperCase()}:</span> ${msg}`;
    logEl.appendChild(line);
    logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight;
    const arr = getStore();
    arr.push({ t: Date.now(), type, msg });
    setStore(arr);
  };
  const restore = () => {
    getStore().forEach(({ type, msg }) => append(type, msg));
  };

  // Basic selectors handy on iPad
  window.$ = (sel, root=document) => root.querySelector(sel);
  window.$$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Patch console
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  console.log = (...a) => { append("log", escapeHtml(fmt(a))); orig.log.apply(console, a); };
  console.warn = (...a) => { append("warn", escapeHtml(fmt(a))); orig.warn.apply(console, a); };
  console.error = (...a) => { append("error", escapeHtml(fmt(a))); orig.error.apply(console, a); };

  // Error capture
  window.addEventListener("error", (e) => {
    const txt = `${e.message}\n${(e.error && e.error.stack) || e.filename + ":" + e.lineno}`;
    overlay.classList.add("show");
    overlay.querySelector("#dbg-err").textContent = txt;
    append("error", escapeHtml(txt));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason?.stack || String(e.reason);
    overlay.classList.add("show");
    overlay.querySelector("#dbg-err").textContent = reason;
    append("error", escapeHtml("Promise rejection: " + reason));
  });

  // Patch fetch to log requests
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const start = performance.now();
    try {
      const res = await realFetch(input, init);
      const dur = (performance.now() - start).toFixed(1);
      append("log", escapeHtml(`fetch ${methodOf(init)} ${urlOf(input)} → ${res.status} (${dur}ms)`));
      return res;
    } catch (err) {
      const dur = (performance.now() - start).toFixed(1);
      append("error", escapeHtml(`fetch ${methodOf(init)} ${urlOf(input)} ✖ (${dur}ms): ${err}`));
      throw err;
    }
  };

  function methodOf(init){ return (init && init.method) || "GET"; }
  function urlOf(input){ return (typeof input === "string") ? input : (input?.url || String(input)); }
  function fmt(args){
    return args.map(a => {
      if (a instanceof Element) return `<${a.tagName.toLowerCase()} …>`;
      if (typeof a === "object") { try { return JSON.stringify(a, null, 2); } catch { return String(a); } }
      return String(a);
    }).join(" ");
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // UI wire-up
  btn.addEventListener("click", () => wrap.classList.toggle("show"));
  wrap.querySelector('[data-act="hide"]').addEventListener("click", () => wrap.classList.remove("show"));
  wrap.querySelector('[data-act="clear"]').addEventListener("click", () => { logEl.textContent = ""; setStore([]); overlay.classList.remove("show"); });
  wrap.querySelector('[data-act="copy"]').addEventListener("click", async () => {
    const text = Array.from(logEl.querySelectorAll(".line")).map(el => el.textContent).join("\n");
    try { await navigator.clipboard.writeText(text); } catch {}
  });
  wrap.querySelector('[data-act="run"]').addEventListener("click", () => runEval());
  evalInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runEval(); });

  function runEval(){
    const code = evalInput.value;
    if (!code) return;
    try {
      // eslint-disable-next-line no-new-func
      const out = Function(`"use strict"; return (async()=>(${code}))()`)();
      Promise.resolve(out).then(v => console.log("▶", v)).catch(e => console.error(e));
    } catch(e){ console.error(e); }
  }

  // Drag to move
  (() => {
    const header = wrap.querySelector("header");
    let sx=0, sy=0, ox=0, oy=0, dragging=false;
    const start = (e) => {
      dragging = true;
      header.style.cursor = "grabbing";
      const r = wrap.getBoundingClientRect();
      ox = r.left; oy = r.top;
      sx = ("touches" in e ? e.touches[0].clientX : e.clientX);
      sy = ("touches" in e ? e.touches[0].clientY : e.clientY);
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const x = ("touches" in e ? e.touches[0].clientX : e.clientX);
      const y = ("touches" in e ? e.touches[0].clientY : e.clientY);
      wrap.style.left = Math.max(6, ox + (x - sx)) + "px";
      wrap.style.top  = Math.max(6, oy + (y - sy)) + "px";
      wrap.style.right = "auto";
      wrap.style.bottom = "auto";
    };
    const end = () => { dragging = false; header.style.cursor = "grab"; };
    header.addEventListener("mousedown", start);
    header.addEventListener("touchstart", start, {passive:false});
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, {passive:false});
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
  })();

  // Auto-show if ?debug=1
  if (ENABLED) wrap.classList.add("show");
  restore();
})();