/*!
 * side-map.js (date-free)
 * Inserts an OSM iframe inside `.site-body-right-column-inner`,
 * immediately above `.graph-view-outer` (or at end if graph missing).
 * - Uses *only* location fields; **no date parsing/formatting** inside.
 *
 * Frontmatter fields used (in priority order):
 *   1) lat / lng : numbers
 *   2) location  : [lat, lng] (single-line YAML array)
 *   3) map_view_link : "[](geo:<a>,<b>)"
 *   4) map_link  : Apple/Google/OSM URL with coordinates
 *   address : comma-separated string; we render "first, last-non-zip"
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

  // ---------- frontmatter scraping (no dates) ----------
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
    theLon:
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

    // fallback: parse map_link
    const raw=readMapLink(); const info=raw && normalizeMap(raw);
    if (info && info.lat!=null && info.lon!=null) return {lat:info.lat,lon:info.lon};

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
    const wrap=document.getElementById(WRAP_ID);
    const pxW=Math.max(240,(wrap?.clientWidth||300));
    const pxH=Math.max(240,(wrap?.clientHeight||400));
    const {left,right,top,bottom}=bboxFor(lat,lon,zoom,pxW,pxH);
    const u=new URL('https://www.openstreetmap.org/export/embed.html');
    u.searchParams.set('layer','mapnik');
    u.searchParams.set('bbox',`${left},${bottom},${right},${top}`);
    u.searchParams.set('marker',`${lat},${lon}`);
    return `${u.href}#map=${zoom}/${lat}/${lon}`;
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
    `;
    const el=document.createElement('style'); el.id=STYLE_ID; el.textContent=css; document.head.appendChild(el);
  };

  // ---------- mount/update/unmount ----------
  let LAST = { lat: null, lon: null, text: null };

  const buildBlock = (lat, lon, locationText) => {
    const block = document.createElement('div'); block.id = BLOCK_ID;
    const wrap = document.createElement('div'); wrap.id = WRAP_ID;
    const ifr = document.createElement('iframe'); ifr.id = IFRAME_ID;
    ifr.src = osmEmbedUrl(lat, lon, MAP_ZOOM);
    ifr.referrerPolicy = 'no-referrer-when-downgrade';
    ifr.loading = 'lazy';
    wrap.appendChild(ifr); block.appendChild(wrap);

    const meta = document.createElement('div'); meta.id = META_ID;
    meta.innerHTML = locationText ? `<div class="place">${locationText}</div>` : '';
    block.appendChild(meta);
    return block;
  };

  const updateSideMap = (lat, lon, locationText) => {
    const ifr = document.getElementById(IFRAME_ID);
    const meta = document.getElementById(META_ID);
    if (ifr) ifr.src = osmEmbedUrl(lat, lon, MAP_ZOOM);
    if (meta) meta.innerHTML = locationText ? `<div class="place">${locationText}</div>` : '';
  };

  const mountOrUpdateSideMap = (lat, lon, locationText) => {
    const right = getRightInner();
    if (!right) return;

    const exists = document.getElementById(BLOCK_ID);
    if (exists) {
      updateSideMap(lat, lon, locationText);
      return;
    }

    const block = buildBlock(lat, lon, locationText);
    const graph = getGraphOuter();
    if (graph && graph.parentNode === right) right.insertBefore(block, graph);
    else right.appendChild(block);
  };

  const unmountSideMap = () => {
    const block = document.getElementById(BLOCK_ID);
    if (block && block.parentNode) block.parentNode.removeChild(block);
  };

  const shouldShowMap = () => window.innerWidth >= MIN_VW;

  // ---------- boot/install ----------
  let installing = false;

  const installIfReady = () => {
    if (installing) return; installing = true;
    ensureStyle();

    // coords priority: lat/lng → location → map_view_link → map_link
    const coords = readCoordsFromFM();
    const show = !!coords && shouldShowMap();

    if (!show) {
      LAST = { lat: null, lon: null, text: null };
      unmountSideMap(); installing = false; return;
    }

    const addrStr = readAddressStr();
    const locTxt  = formatLocationFromAddress(addrStr);

    // only update if something changed
    const same = LAST.lat === coords.lat && LAST.lon === coords.lon && LAST.text === locTxt;
    if (!same) {
      mountOrUpdateSideMap(coords.lat, coords.lon, locTxt);
      LAST = { lat: coords.lat, lon: coords.lon, text: locTxt };
    }

    installing = false;
  };

  const debounced = (fn, ms=120) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  const haveFM = () => qFM(document).length > 0;
  const waitFM = (cb) => {
    if (haveFM()) { cb(); return; }
    const mo = new MutationObserver(() => { if (haveFM()) { mo.disconnect(); cb(); }});
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { if (haveFM()) { mo.disconnect(); cb(); }}, 2000);
  };

  const boot = () => {
    waitFM(installIfReady);

    // Detect SPA-style route changes
    let lastPath = location.pathname + location.search + location.hash;
    setInterval(() => {
      const now = location.pathname + location.search + location.hash;
      if (now !== lastPath) { lastPath = now; waitFM(installIfReady); }
    }, 150);

    // Watch content swaps
    const target = getContentContainer() || document.body;
    const mo = new MutationObserver(debounced(installIfReady, 120));
    mo.observe(target, { childList: true, subtree: true });

    // Resize responsiveness
    window.addEventListener('resize', debounced(installIfReady, 120), { passive: true });

    // Bonus: listen for common SPA events if present
    ['as:routechange','popstate','hashchange','pageshow','visibilitychange','turbo:load','pjax:end']
      .forEach(ev => window.addEventListener(ev, debounced(installIfReady, 50)));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();