/**
 * Prev | Next from the visible File Tree (Publish / Digital Garden)
 * v2 — fixes SPA navigation: reacts to in-page link clicks & history changes
 */

(() => {
  const NAV_CLASS = 'note-nav';
  const TOP_ID = 'note-nav-top';
  const BOT_ID = 'note-nav-bottom';
  const STYLE_ID = 'note-nav-style';
  const SHOW_HR_TOP = !!window.NAV_HR_TOP;
  const SHOW_HR_BOTTOM = !!window.NAV_HR_BOTTOM;

  const ORIGIN = (window.siteInfo && window.siteInfo.customurl)
    ? ('https://' + window.siteInfo.customurl.replace(/^https?:\/\//,'').replace(/\/$/,''))
    : (location.origin || 'https://publish.obsidian.md');

  // ---------- utils ----------
  const getContentContainer = () =>
    document.querySelector('.markdown-preview-sizer')
    || document.querySelector('.markdown-preview-view .markdown-preview-section')
    || document.querySelector('#content')
    || document.querySelector('.markdown-preview-view')
    || document.body;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      .${NAV_CLASS}{
        display:flex;justify-content:center;align-items:center;
        gap:.5rem;margin:1rem 0;font-size:var(--font-normal,1rem);
        line-height:1.2;color:var(--text-normal,inherit)
      }
      .${NAV_CLASS}__link{ text-decoration:none }
      .${NAV_CLASS}__link[href]{ text-decoration:underline }
      .${NAV_CLASS}__sep{ opacity:.6 }
      .${NAV_CLASS}__link:not([href]){ opacity:.4; pointer-events:none }
      .${NAV_CLASS}__rule{ border:0;border-top:1px solid var(--background-modifier-border,rgba(127,127,127,.35));margin:.5rem 0 1rem }
      .${NAV_CLASS}[data-hidden="1"]{ visibility:hidden; height:0; margin:0 }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  };

  const normPath = (href) => {
    if (!href) return '';
    let u;
    try { u = new URL(href, ORIGIN); } catch { return ''; }
    let p = (u.pathname || '').replace(/\.html?$/i,'');
    try { p = p.replace(/\+/g,' '); p = /%[0-9A-Fa-f]{2}/.test(p) ? decodeURIComponent(p) : p; } catch {}
    return p.replace(/\/{2,}/g,'/').replace(/^\/+/,'');
  };
  const curSlug = () => normPath(location.pathname);
  const encodePublish = (slug) => encodeURI(slug).replace(/%20/g,'+').replace(/&/g,'%26');

  // ---------- tree scraping ----------
  const treeRoots = [
    '.filetree-sidebar',
    '.site-body-left-column',
    '.nav-view',
    '.tree-container'
  ];
  const anchorSelectors = [
    '.file-tree-item-inner a[href]',
    '.tree-item-self[href]',
    'a[href]'
  ];
  const getTreeRoot = () => treeRoots.map(s => document.querySelector(s)).find(Boolean) || null;
  const getTreeAnchors = (root) => {
    if (!root) return [];
    for (const sel of anchorSelectors) {
      const list = Array.from(root.querySelectorAll(sel)).filter(a => a.getAttribute('href'));
      if (list.length) return list;
    }
    const wide = document.querySelector('.filetree-sidebar') || document.querySelector('.site-body-left-column');
    return wide ? Array.from(wide.querySelectorAll('a[href]')) : [];
  };
  const getSlugs = () => {
    const root = getTreeRoot();
    if (!root) return [];
    const anchors = getTreeAnchors(root);
    const slugs = anchors.map(a => normPath(a.getAttribute('href')))
      .filter(Boolean)
      .filter(s => !/^https?:\/\//i.test(s));
    const seen = new Set(); const uniq = [];
    for (const s of slugs) if (!seen.has(s)) { seen.add(s); uniq.push(s); }
    return uniq;
  };

  // ---------- DOM builders ----------
  const mkSep = () => Object.assign(document.createElement('span'), { className: `${NAV_CLASS}__sep`, textContent: ' | ' });
  const mkLink = (slug, label) => {
    const el = document.createElement(slug ? 'a' : 'span');
    el.className = `${NAV_CLASS}__link`;
    el.textContent = label;
    if (slug) el.href = new URL('/' + encodePublish(slug), ORIGIN).href;
    return el;
  };
  const mkRule = () => Object.assign(document.createElement('hr'), { className: `${NAV_CLASS}__rule` });

  const ensureMount = (id, where) => {
    let nav = document.getElementById(id);
    if (!nav) {
      nav = document.createElement('nav');
      nav.id = id;
      nav.className = NAV_CLASS;
      nav.setAttribute('aria-label','Note navigation');
      const container = getContentContainer();
      if (where === 'top') {
        if (container.firstElementChild) {
          container.insertBefore(nav, container.firstElementChild);
          if (SHOW_HR_TOP) container.insertBefore(mkRule(), nav.nextSibling);
        } else {
          container.appendChild(nav);
          if (SHOW_HR_TOP) container.appendChild(mkRule());
        }
      } else {
        const backlinks = container.querySelector('div.backlinks') || document.querySelector('div.backlinks');
        if (backlinks) {
          if (SHOW_HR_BOTTOM) backlinks.parentNode.insertBefore(mkRule(), backlinks);
          backlinks.parentNode.insertBefore(nav, backlinks);
        } else {
          if (SHOW_HR_BOTTOM) container.appendChild(mkRule());
          container.appendChild(nav);
        }
      }
    }
    return nav;
  };

  const renderNav = (nav, prevSlug, nextSlug) => {
    nav.replaceChildren();
    const havePrev = !!prevSlug, haveNext = !!nextSlug;
    if (!havePrev && !haveNext) { nav.dataset.hidden = '1'; return; }
    nav.removeAttribute('data-hidden');
    if (havePrev) nav.append(mkLink(prevSlug,'Prev'));
    if (havePrev && haveNext) nav.append(mkSep());
    if (haveNext) nav.append(mkLink(nextSlug,'Next'));
  };

  // ---------- main compute/update ----------
  let lastKey = '';
  const update = () => {
    const slugs = getSlugs();
    const cur = curSlug();
    const idx = slugs.indexOf(cur);
    const prev = idx > 0 ? slugs[idx - 1] : null;
    const next = idx >= 0 && idx < slugs.length - 1 ? slugs[idx + 1] : null;

    const key = [location.pathname, slugs.length, idx, prev || '', next || ''].join('|');
    if (key === lastKey) return;
    lastKey = key;

// ONLY SHOW BOTTOM LINKS. COMMENT OUT TOP LINKS
//    const top = ensureMount(TOP_ID, 'top');
//    const bot = ensureMount(BOT_ID, 'bottom');
    renderNav(top, prev, next);
    renderNav(bot, prev, next);
  };

  // If the markdown column is re-rendered, recreate the mounts
  const keepAlive = () => {
    const top = document.getElementById(TOP_ID);
    const bot = document.getElementById(BOT_ID);
    if (!top || !bot || !top.isConnected || !bot.isConnected) {
      lastKey = '';
      update();
    }
  };

  // ---------- SPA route hooks ----------
  const routeTick = () => {
    // stagger a few updates to catch late DOM swaps
    update();
    setTimeout(update, 75);
    setTimeout(update, 200);
    setTimeout(keepAlive, 350);
  };

  const installHistoryHooks = () => {
    const fire = () => window.dispatchEvent(new Event('nav:route'));
    const wrap = (fn) => function() { const r = fn.apply(this, arguments); fire(); return r; };
    try {
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
    } catch {}
    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);
    window.addEventListener('nav:route', routeTick);
  };

  // Intercept same-origin in-page link clicks (including our Prev/Next)
  const installClickHook = () => {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      // Same origin + not targeting new window
      let u;
      try { u = new URL(a.href, ORIGIN); } catch { return; }
      if (u.origin !== new URL(ORIGIN).origin) return;
      // Let the app handle navigation; we just schedule updates
      setTimeout(routeTick, 0);
      setTimeout(routeTick, 150);
    }, true);
  };

  // Watch only the tree for changes
  const observeTree = () => {
    const root = getTreeRoot();
    if (!root) return;
    const obs = new MutationObserver(() => { setTimeout(update, 0); });
    obs.observe(root, { childList:true, subtree:true, attributes:true, attributeFilter:['class','href'] });
  };

  // Periodic guard (cheap)
  const routeGuard = () => {
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        routeTick();
      }
      keepAlive();
    }, 300);
  };

  // ---------- boot ----------
  const boot = () => {
    if (localStorage.getItem('nav:disable') === '1' || window.NAV_DISABLE) return;
    ensureStyle();
    installHistoryHooks();
    installClickHook();
    observeTree();
    routeGuard();
    routeTick(); // first paint
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();