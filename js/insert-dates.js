/*!
 * publish-date-banner.js
 * Reads `date` and `date_modified` from rendered frontmatter and injects
 * a monospace banner *above the first H1*.
 * - Uses Obsidian standard CSS variables for fonts, colors, and sizes.
 * - `date` supports scalar, CSV, YAML [list], or YAML multiline list.
 * - `date_modified` is shown in a muted tone.
 */
(() => {
  const STYLE_ID = 'note-date-banner-style';
  const BLOCK_ID = 'note-date-banner';

  // ---------- DOM helpers ----------
  const getContentContainer = () =>
    document.querySelector('#content') ||
    document.querySelector('.markdown-preview-view') ||
    document.querySelector('.markdown-preview-section') ||
    document.body;

  const findFirstH1 = () =>
    (getContentContainer() || document).querySelector('h1, .markdown-rendered h1, .cm-header-1');

  // ---------- frontmatter scraping ----------
  const qFM = (root=document) => root.querySelectorAll([
    '.el-pre.mod-frontmatter.mod-ui pre.language-yaml code.language-yaml',
    '.el-pre.mod-frontmatter.mod-ui code.language-yaml',
    'pre.frontmatter.language-yaml code.language-yaml',
    'pre.language-yaml code.language-yaml',
    'code.language-yaml',
    '.frontmatter code.language-yaml',
    '.metadata-container table',
    '.frontmatter-container table',
    '.frontmatter table'
  ].join(','));

  const getFMPlainText = () => {
    const nodes = qFM(document);
    let out = '';
    for (const n of nodes) {
      if (n.tagName === 'TABLE') {
        for (const tr of n.querySelectorAll('tr')) {
          const k = tr.querySelector('th, td:first-child');
          const v = tr.querySelector('td:last-child');
          if (k && v) out += `${k.textContent.trim()}: ${v.textContent.trim()}\n`;
        }
      } else {
        out += (n.innerText || n.textContent || '') + '\n';
      }
    }
    return out.replace(/&amp;/g, '&');
  };

  const readFMField = (fieldName) => {
    const nodes = qFM(document);
    // table-style
    for (const n of nodes) {
      if (n.tagName === 'TABLE') {
        for (const tr of n.querySelectorAll('tr')) {
          const k = tr.querySelector('th, td:first-child');
          const v = tr.querySelector('td:last-child');
          if (k && v && k.textContent.trim() === fieldName) {
            return v.textContent.trim().replace(/^["']|["']$/g,'');
          }
        }
      }
    }
    // code/prism/raw
    const rx = new RegExp(`^\\s*${fieldName}\\s*:\\s*["']?(.+?)["']?\\s*$`, 'mi');
    for (const n of nodes) {
      if (n.tagName === 'TABLE') continue;
      const txt = (n.innerText || n.textContent || '').replace(/&amp;/g,'&');
      const m = txt.match(rx);
      if (m) return m[1].trim();
    }
    return null;
  };

  // ---------- date parsing/formatting ----------
  const ORD = (n) => { const s=n%100; if(s>=11&&s<=13)return'th'; switch(n%10){case 1:return'st';case 2:return'nd';case 3:return'rd';default:return'th';}};
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const parseDateToken=(tok)=>{
    const t=String(tok).trim().replace(/^\[|\]$/g,'');
    let m=t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m){const y=+m[1],mo=+m[2],d=+m[3];const dt=new Date(Date.UTC(y,mo-1,d));return{kind:'full',y,mo,d,date:dt};}
    m=t.match(/^(\d{4})-(\d{2})$/); if(m)return{kind:'ym',y:+m[1],mo:+m[2]};
    m=t.match(/^(\d{4})$/); if(m)return{kind:'y',y:+m[1]};
    return null;
  };

  // Read "date" supporting scalar, CSV, YAML [list], YAML multiline list
  const readDateTokens=()=>{
    const out=[]; const fmText=getFMPlainText();
    // 1) single-line array: date: [2016-10-10, 2016-10-12]
    let m=fmText.match(/^\s*date\s*:\s*\[([^\]]+)\]\s*$/mi);
    if(m){ m[1].split(/[,;]+/).forEach(s=>{if(s.trim())out.push(s.trim());}); }
    else{
      // 2) multi-line list
      m=fmText.match(/^\s*date\s*:\s*\n((?:\s*-\s*[^\n]+\n)+)/mi);
      if(m){ m[1].split(/\n/).forEach(line=>{const mm=line.match(/-\s*(.+)$/);if(mm){const v=mm[1].trim(); if(v) out.push(v);}}); }
      else{
        // 3) scalar/CSV
        const raw=readFMField('date'); if(raw) raw.split(/[,;]+/).forEach(s=>{if(s.trim())out.push(s.trim());});
      }
    }
    return out;
  };

  const fmtFull=({date,y,mo,d})=>{
    const weekday=WEEKDAYS[date.getUTCDay()], month=MONTHS[mo-1], ord=ORD(d);
    return `${weekday}, ${month}&nbsp;${d}<sup class="ord">${ord}</sup>,&nbsp;${y}`;
  };
  const fmtYM=({y,mo})=>`${MONTHS[mo-1]}&nbsp;${y}`;
  const fmtY=({y})=>String(y);

  const formatDateSmart=(tokens)=>{
    const parsed=tokens.map(parseDateToken).filter(Boolean);
    if(!parsed.length) return '';
    const fulls=parsed.filter(p=>p.kind==='full').sort((a,b)=>a.date-b.date);
    const yms=parsed.filter(p=>p.kind==='ym').sort((a,b)=>(a.y-b.y)||(a.mo-b.mo));
    const ys=parsed.filter(p=>p.kind==='y').sort((a,b)=>a.y-b.y);

    if(fulls.length===2){
      const a=fulls[0],b=fulls[1];
      if(a.y===b.y){
        if(a.mo===b.mo)
          return `${MONTHS[a.mo-1]}&nbsp;${a.d}<sup class="ord">${ORD(a.d)}</sup>–${b.d}<sup class="ord">${ORD(b.d)}</sup>,&nbsp;${a.y}`;
        return `${MONTHS[a.mo-1]}&nbsp;${a.d}<sup class="ord">${ORD(a.d)}</sup> – ${MONTHS[b.mo-1]}&nbsp;${b.d}<sup class="ord">${ORD(b.d)}</sup>,&nbsp;${a.y}`;
      }
      return `${MONTHS[a.mo-1]}&nbsp;${a.d}<sup class="ord">${ORD(a.d)}</sup>,&nbsp;${a.y} – ${MONTHS[b.mo-1]}&nbsp;${b.d}<sup class="ord">${ORD(b.d)}</sup>,&nbsp;${b.y}`;
    }
    if(fulls.length){
      const main=fmtFull(fulls[0]);
      const extra=(parsed.length>1)?`&nbsp;<span class="more">(＋${parsed.length-1} more)</span>`:'';
      return main+extra;
    }
    if(yms.length){
      const main=fmtYM(yms[0]);
      const extra=(parsed.length>1)?`&nbsp;<span class="more">(＋${parsed.length-1} more)</span>`:'';
      return main+extra;
    }
    const main=fmtY(ys[0]);
    const extra=(ys.length>1)?`&nbsp;<span class="more">(＋${ys.length-1} more)</span>`:'';
    return main+extra;
  };

  // date_modified
  const parseISO = (s) => {
    if(!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const fmtISOCompact = (dUTC) => {
    const y = dUTC.getUTCFullYear();
    const m = String(dUTC.getUTCMonth()+1).padStart(2,'0');
    const dd = String(dUTC.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };

  // ---------- styles (Obsidian variables) ----------
  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${BLOCK_ID}{
        margin: var(--size-4-1, .25rem) 0 var(--size-4-2, .5rem) 0;
        display: flex;
        gap: var(--size-4-2, .5rem);
        align-items: baseline;
        flex-wrap: wrap;
        font-family: var(--font-monospace, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
        font-size: var(--font-small, 0.875rem);
        line-height: var(--line-height-tight, 1.3);
        color: var(--text-normal);
      }
      #${BLOCK_ID} .primary-date { font-weight: var(--font-medium, 500); }

      /* Hide modified date by default */
      #${BLOCK_ID} .mod-date { display: none; color: var(--text-muted); }

      /* Reveal it when the user hovers over the whole banner, or just the primary date */
      #${BLOCK_ID}:hover .mod-date, #${BLOCK_ID} .primary-date:hover + .mod-date { display: inline; }
      #${BLOCK_ID} .ord { font-size: .7em; vertical-align: super; }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  };

  const renderBanner = () => {
    const tokens = readDateTokens();
    const primary = formatDateSmart(tokens);           // main date (if present)

    const dmRaw = readFMField('date_modified');
    const dm = parseISO(dmRaw);
    const mod = dm ? fmtISOCompact(dm) : null;

    // If neither exists, render nothing
    if (!primary && !mod) return null;

    // Build in strict order: primary date first (if present), then modified
    const div = document.createElement('div');
    div.id = BLOCK_ID;
    const parts = [];
    if (primary) parts.push(`<span class="primary-date">${primary}</span>`);
    if (mod)     parts.push(`<span class="mod-date">updated&nbsp;${mod}</span>`);
    div.innerHTML = parts.join('');
    return div;
  };

  // ---------- boot ----------
  const haveFM = () =>
    document.querySelectorAll('.frontmatter, .frontmatter-container, .metadata-container, code.language-yaml').length > 0;

  const waitFM = (cb) => {
    if (haveFM()) { cb(); return; }
    const mo = new MutationObserver(() => { if (haveFM()) { mo.disconnect(); cb(); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { if (haveFM()) { mo.disconnect(); cb(); } }, 2000);
  };

  const debounced=(fn,ms=120)=>{let t; return()=>{clearTimeout(t); t=setTimeout(fn,ms);};};

  const install = () => {
    ensureStyle();
    const existing = document.getElementById(BLOCK_ID);
    if (existing) existing.remove();

    const h1 = findFirstH1();
    const banner = renderBanner();
    if (h1 && banner) h1.parentNode.insertBefore(banner, h1);
  };

  const boot = () => {
    waitFM(install);
    // Handle Publish SPA-style navigation
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        waitFM(install);
      }
    }, 150);

    const mo = new MutationObserver(debounced(install, 120));
    mo.observe(getContentContainer() || document.body, { childList: true, subtree: true });
    window.addEventListener('resize', debounced(install, 120), { passive: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();