// --- Obsidian Publish: replace sidebar link text with page title ----------------
(function () {
  const DEBUG = false;
  const CACHE_PREFIX = "h1TitleCache::";
  const NAV_SELECTOR = ".site-body-left-column .nav-view";        // from your DOM
  const LINK_SELECTOR = ".tree-item-inner a[href]";
  const TITLE_META_SELECTORS = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]'
  ];

  // --- small fetch queue so we don't spam requests
  const queue = [];
  let working = false;
  async function runQueue() {
    if (working) return;
    working = true;
    while (queue.length) {
      const job = queue.shift();
      try { await job(); } catch (e) { DEBUG && console.warn(e); }
      await new Promise(r => setTimeout(r, 80));
    }
    working = false;
  }

  function log(...a){ if (DEBUG) console.log("[publish h1]", ...a); }

  function isInternal(href) {
    try { return new URL(href, location.origin).origin === location.origin; }
    catch { return false; }
  }

  function normalizePath(href) {
    const u = new URL(href, location.origin);
    // strip hash & query; normalize trailing slash
    return (u.pathname || "/").replace(/\/+$/, "") || "/";
  }

  function cacheGet(k){ try { return localStorage.getItem(CACHE_PREFIX + k); } catch { return null; } }
  function cacheSet(k,v){ try { localStorage.setItem(CACHE_PREFIX + k, v); } catch {} }

  function cleanTitle(raw) {
    let t = (raw || "").replace(/\s+/g, " ").trim();
    // Remove " - <Site Name>" suffix if present
    const siteName = document.querySelector(".site-body-left-column-site-name")?.textContent?.trim();
    if (siteName && t.endsWith(" - " + siteName)) t = t.slice(0, -(" - " + siteName).length);
    return t;
  }

  function extractTitleFromHTML(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 1) Prefer head meta tags (these exist even when body is client-rendered)
    for (const sel of TITLE_META_SELECTORS) {
      const m = doc.querySelector(sel);
      if (m?.content) return cleanTitle(m.content);
    }
    // 2) Fallback: <title>
    const tt = doc.querySelector("title")?.textContent;
    if (tt) return cleanTitle(tt);

    // 3) Last resort: an H1 in the parsed HTML (if SSR present)
    const h1 = doc.querySelector("h1.publish-article-heading") ||
               doc.querySelector("main h1") ||
               doc.querySelector("h1");
    if (h1) return cleanTitle(h1.textContent);

    return null;
  }

  async function fetchPageTitle(pathname) {
    const cached = cacheGet(pathname);
    if (cached) return cached;

    const res = await fetch(pathname, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Fetch ${pathname} -> ${res.status}`);
    const html = await res.text();
    const title = extractTitleFromHTML(html);
    if (title) cacheSet(pathname, title);
    return title;
  }

  function processLink(a) {
    if (a.dataset.h1Rewritten === "1") return;
    const href = a.getAttribute("href");
    if (!href || !isInternal(href)) return;

    const path = normalizePath(href);
    // Skip folder nodes (no page)
    if (!path || path === "/") return;

    queue.push(async () => {
      const t = await fetchPageTitle(path);
      if (t && t.length) {
        if (!a.dataset.originalText) a.dataset.originalText = a.textContent || "";
        a.textContent = t;
        a.title = t;
        a.dataset.h1Rewritten = "1";
        log("rewrote", path, "→", t);
      }
    });
    runQueue();
  }

  function scanSidebar(root = document) {
    document.querySelectorAll(NAV_SELECTOR).forEach(nav => {
      nav.querySelectorAll(LINK_SELECTOR).forEach(processLink);
    });
  }

  // initial pass
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanSidebar, { once: true });
  } else {
    scanSidebar();
  }

  // observe nav changes (folder toggles, route changes, lazy rendering)
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches?.(NAV_SELECTOR)) scanSidebar(n);
          n.querySelectorAll?.(LINK_SELECTOR).forEach(processLink);
        });
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // If the SPA router swaps content without DOM mutations in nav, re-run on popstate
  window.addEventListener("popstate", () => scanSidebar());
})();