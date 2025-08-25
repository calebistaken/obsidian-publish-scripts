/**
 * Obsidian Publish — Right sidebar OSM map (above graph view)
 * - Inserts a simple OSM iframe inside `.site-body-right-column-inner`,
 *   immediately above `.graph-view-outer` (or at the end if graph is absent).
 * - Dark theme softened; metadata below map shows place + natural date.
 * - Loads only for wide viewports (>= window.SIDE_MAP_MIN_VW, default 0).
 *
 * Frontmatter fields used (in priority order):
 *   1) lat / lng : numbers
 *   2) location  : [lat, lng] (single-line YAML array)
 *   3) map_view_link : "[](geo:<a>,<b>)"
 *   4) map_link  : Apple/Google/OSM URL with coordinates
 *   address : comma-separated string; we render "first, last-non-zip"
 *   date    : scalar, list, or CSV; we normalize it
 */

(() => {
  const STYLE_ID  = 'side-map-style';
  const BLOCK_ID  = 'side-map-block';
  const WRAP_ID   = 'side-map-wrap';
  const IFRAME_ID = 'side-map-iframe';
  const META_ID   = 'side-map-meta';

  const MAP_ZOOM   = Number.isFinite(window.MAP_ZOOM) ? window.MAP_ZOOM : 12;
  const MAP_HEIGHT = Number.isFinite(window.SIDE_MAP_HEIGHT) ? window.SIDE_MAP_HEIGHT : 400;
  const MIN_VW     = Number.isFinite(window.SIDE_MAP_MIN_VW) ? window.SIDE_MAP_MIN_VW : 0;

  // ---------- DOM helpers ----------
  const getRightInner = () => document.querySelector('.site-body-right-column-inner');
  const getGraphOuter = () => document.querySelector('.site-body-right-column-inner .graph-view-outer');
  const getContentContainer = () =>
    document.querySelector('#content') ||
    document.querySelector('.markdown-preview-view') ||
    document.querySelector('.markdown-preview-section') ||
    document.body;

  // ---------- frontmatter helpers ----------
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

  const readMapLink      = () => readFMField('map_link');
  const readMapViewLink  = () => readFMField('map_view_link');
  const readAddressStr   = () => readFMField('address');

  // address → "first, last-non-zip"
  const formatLocationFromAddress = (addr) => {
    if (!addr) return null;
    const parts = String(addr).split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const isZip = (s) => /\b\d{5}(?:-\d{4})?\b/.test(s);
    const first = parts[0];
    let last = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!isZip(parts[i])) { last = parts[i]; break; }
    }
    if (!last) last = parts[parts.length - 1];
    return `${first}, ${last}`;
  };

  // ---------- URL/coords ----------
  const toFloat = (s)=>{const n=parseFloat(String(s).trim());return Number.isFinite(n)?n:null;};
  const pair = (s)=>{ if(!s) return null; const m=String(s).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/); if(!m) return null; return {a:toFloat(m[1]), b:toFloat(m[2])}; };
  const qobj = (u)=>{const o=Object.create(null); for (const [k,v] of u.searchParams.entries()) o[k]=v; return o;};

  const toLatLon = (a, b) => {
    let lat = a, lon = b;
    const inLat = (x) => x != null && Math.abs(x) <= 90;
    const inLon = (x) => x != null && Math.abs(x) <= 180;
    if (!inLat(lat) || !inLon(lon)) if (inLat(b) && inLon(a)) { lat=b; lon=a; }
    return (inLat(lat) && inLon(lon)) ? { lat, lon } : null;
  };

  const parseGeoMarkdownLink = (raw) => {
    if (!raw) return null;
    const m = String(raw).match(/\]\(\s*geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (!m) return null;
    return toLatLon(toFloat(m[1]), toFloat(m[2]));
  };

  const readCoordsFromFM = () => {
    const latStr = readFMField('lat'), lngStr = readFMField('lng');
    const lat = toFloat(latStr), lon = toFloat(lngStr);
    if (lat != null && lon != null) return { lat, lon };

    const fmText = getFMPlainText();
    let m = fmText.match(/^\s*location\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/mi);
    if (m) { const t=toLatLon(toFloat(m[1]), toFloat(m[2])); if (t) return t; }

    const locInline = readFMField('location');
    const p = pair(locInline); if (p) { const t=toLatLon(p.a,p.b); if (t) return t; }

    const mvl = readMapViewLink(); const g=parseGeoMarkdownLink(mvl); if (g) return g;

    return null;
  };

  const normalizeMap = (raw) => {
    let href=(raw||'').replace(/&amp;/g,'&').trim();
    if (!/^https?:\/\//i.test(href)) return null;
    let u; try { u=new URL(href); } catch { return null; }
    const host=u.hostname.toLowerCase();

    if (host.endsWith('maps.apple.com')){
      const q=qobj(u); const c=pair(q.ll||q.sll)||pair(q.q);
      if (c) { const t = toLatLon(c.a, c.b); return {lat:t?.lat, lon:t?.lon}; }
    }
    if (host.includes('google.') && u.pathname.toLowerCase().includes('/maps')){
      const at=u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      const q=qobj(u);
      let t=null; if (at) t=toLatLon(toFloat(at[1]), toFloat(at[2]));
      if (!t) { const pq=pair(q.q)||pair(q.query); if (pq) t=toLatLon(pq.a,pq.b); }
      return {lat:t?.lat, lon:t?.lon};
    }
    if (host.includes('openstreetmap.org')){
      const q=qobj(u); let lat=toFloat(q.mlat), lon=toFloat(q.mlon);
      if (lat==null||lon==null){
        const m=(u.hash||'').match(/map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
        if (m){ const t=toLatLon(toFloat(m[1]), toFloat(m[2])); lat=t?.lat; lon=t?.lon; }
      }
      return {lat, lon};
    }
    return null;
  };

  // bbox + marker + hash keeps pin + zoom consistent
  const bboxFor = (lat, lon, zoom, pxW, pxH) => {
    const mpp=156543.03392*Math.cos(lat*Math.PI/180)/Math.pow(2,zoom);
    const halfWm=(pxW*mpp)/2, halfHm=(pxH*mpp)/2, pad=1.15;
    const latDegPerM=1/111320, lonDegPerM=1/(111320*Math.cos(lat*Math.PI/180));
    return {
      left:lon-(halfWm*lonDegPerM*pad), right:lon+(halfWm*lonDegPerM*pad),
      top:lat+(halfHm*latDegPerM*pad), bottom:lat-(halfHm*latDegPerM*pad)
    };
  };

  const osmEmbedUrl = (lat, lon, zoom) => {
    const wrap=document.getElementById('side-map-wrap');
    const pxW=Math.max(240,(wrap?.clientWidth||300));
    const pxH=Math.max(240,(wrap?.clientHeight||400));
    const {left,right,top,bottom}=bboxFor(lat,lon,zoom,pxW,pxH);
    const u=new URL('https://www.openstreetmap.org/export/embed.html');
    u.searchParams.set('layer','mapnik');
    u.searchParams.set('bbox',`${left},${bottom},${right},${top}`);
    u.searchParams.set('marker',`${lat},${lon}`);
    return `${u.href}#map=${zoom}/${lat}/${lon}`;
  };

  // ---------- Date formatting (Option A) ----------
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

  // ---------- styles ----------
  const ensureStyle=()=>{
    if(document.getElementById(STYLE_ID))return;
    const css=`
      :root{--side-map-h:${MAP_HEIGHT}px;--side-map-gap:var(--size-4-2,.5rem);--side-map-radius:var(--radius-s,6px);--side-map-bg:var(--background-primary,transparent);--side-map-filter:none;}
      body.theme-dark{--side-map-filter:brightness(.78) contrast(1.05) saturate(.9);}
      .site-body-right-column{padding-top:32px;}
      #${BLOCK_ID}{display:block;margin:0 0 var(--side-map-gap) 0;}
      #${WRAP_ID}{position:relative;width:100%;aspect-ratio:1/1;max-height:var(--side-map-h);border-radius:var(--side-map-radius);overflow:hidden;background:var(--side-map-bg);}
      #${IFRAME_ID}{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;filter:var(--side-map-filter);}
      #${META_ID}{margin-top:.35rem;font-size:var(--font-small,.85rem);color:var(--text-muted);font-family:'Alegreya SC',sans-serif;text-align:center;line-height:1.25;white-space:normal;word-break:break-word;}
      #${META_ID} .place{display:block;}
      #${META_ID} .date{display:block;margin-top:.1rem;}
      #${META_ID} .more{opacity:.7;font-size:.95em;}
      #${META_ID} .ord{font-size:.7em;vertical-align:super;}
    `;
    const el=document.createElement('style'); el.id=STYLE_ID; el.textContent=css; document.head.appendChild(el);
  };

  // ---------- mount/unmount ----------
  const buildBlock=(lat,lon,metaText)=>{
    const block=document.createElement('div'); block.id=BLOCK_ID;
    const wrap=document.createElement('div'); wrap.id=WRAP_ID;
    const ifr=document.createElement('iframe'); ifr.id=IFRAME_ID;
    ifr.src=osmEmbedUrl(lat,lon,MAP_ZOOM);
    ifr.referrerPolicy='no-referrer-when-downgrade';
    ifr.loading='lazy';
    wrap.appendChild(ifr); block.appendChild(wrap);

    const meta=document.createElement('div'); meta.id=META_ID;
    meta.innerHTML=metaText||''; block.appendChild(meta);
    return block;
  };

  const mountSideMap=(lat,lon,locationText,dateHTML)=>{
    const right=getRightInner(); if(!right) return;
    if(document.getElementById(BLOCK_ID)) return; // already mounted

    const pieces=[];
    if(locationText) pieces.push(`<div class="place">${locationText}</div>`);
    if(dateHTML)     pieces.push(`<div class="date">${dateHTML}</div>`);
    const metaHTML=pieces.join('');

    const block=buildBlock(lat,lon,metaHTML);
    const graph=getGraphOuter();
    if(graph && graph.parentNode===right) right.insertBefore(block,graph);
    else right.appendChild(block);
  };

  const unmountSideMap=()=>{
    const block=document.getElementById(BLOCK_ID);
    if(block && block.parentNode) block.parentNode.removeChild(block);
  };

  const shouldShowMap=()=> window.innerWidth >= MIN_VW;

  // ---------- boot/install ----------
  let installing=false;
  const installIfReady=()=>{
    if(installing) return; installing=true;

    ensureStyle();

    // coords priority: lat/lng → location → map_view_link → (fallback) map_link
    let coords=readCoordsFromFM();
    if(!coords){
      const raw=readMapLink(); const info=raw && normalizeMap(raw);
      if(info && info.lat!=null && info.lon!=null) coords={lat:info.lat,lon:info.lon};
    }

    if(!coords || !shouldShowMap()){
      unmountSideMap(); installing=false; return;
    }

    const tokens=readDateTokens();
    const dateHTML=formatDateSmart(tokens);
    const addrStr=readAddressStr();
    const locTxt =formatLocationFromAddress(addrStr);

    mountSideMap(coords.lat,coords.lon,locTxt,dateHTML);
    installing=false;
  };

  const debounced=(fn,ms=120)=>{let t; return()=>{clearTimeout(t); t=setTimeout(fn,ms);};};

  const haveFM=()=> qFM(document).length>0;
  const waitFM=(cb)=>{
    if(haveFM()){cb();return;}
    const mo=new MutationObserver(()=>{if(haveFM()){mo.disconnect();cb();}});
    mo.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(()=>{if(haveFM()){mo.disconnect();cb();}},2000);
  };

  const boot=()=>{
    waitFM(installIfReady);
    let lastPath=location.pathname;
    setInterval(()=>{ if(location.pathname!==lastPath){ lastPath=location.pathname; waitFM(installIfReady);} },150);
    const mo=new MutationObserver(debounced(installIfReady,120));
    mo.observe(getContentContainer()||document.body,{childList:true,subtree:true});
    window.addEventListener('resize',debounced(installIfReady,120),{passive:true});
  };

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot,{once:true});
  }else{
    boot();
  }
})();