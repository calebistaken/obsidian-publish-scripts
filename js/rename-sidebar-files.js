(() => {
  // ---------- Tunables ----------
  const SIDEBAR_SCOPE = ".filetree-sidebar .nav-view";
  const LINK_SELECTOR = ".tree-item a[href]";
  const YAML_SELECTOR = ".el-pre.mod-frontmatter .frontmatter.language-yaml code";
  const H1_SELECTOR   = "h1.publish-article-heading, .el-h1 > h1";

  // ---------- Cache & logger ----------
  const cache = new Map(); // href -> resolved title
  const log = (...args) => console.debug("[sidebar-title]", ...args);

  // ---------- Parsers ----------
  function parseYamlTitle(yamlText) {
    if (!yamlText) return null;
    const m = yamlText.match(/^\s*title\s*:\s*(.+)\s*$/mi);
    if (!m) return null;
    let v = m[1].trim().replace(/^['"]|['"]$/g, "");
    return v || null;
  }
  function extractBareH1Text(h1El) {
    if (!h1El) return null;
    let txt = "";
    h1El.childNodes.forEach(n => { if (n.nodeType === 3) txt += n.textContent; });
    txt = (txt || h1El.textContent || "").trim();
    return txt.replace(/\bCopy link\b/i, "").trim() || null;
  }

  // ---------- Fetch -> (frontmatter title || h1) ----------
  async function resolveTitleFromHref(href) {
    if (cache.has(href)) return cache.get(href);

    let title = null;
    try {
      log("fetch", href);
      const resp = await fetch(href, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // 1) Frontmatter block (hidden <pre><code> YAML)
      const yamlCode = doc.querySelector(YAML_SELECTOR);
      if (yamlCode) {
        title = parseYamlTitle(yamlCode.textContent || "");
        log("yaml title:", title);
      } else {
        log("yaml block not found");
      }

      // 2) Fallback: first H1
      if (!title) {
        title = extractBareH1Text(doc.querySelector(H1_SELECTOR));
        log("h1 fallback:", title);
      }
    } catch (e) {
      log("error:", e);
    }

    if (!title) log("no title resolved for", href);
    cache.set(href, title || null);
    return title || null;
  }

  // ---------- DOM updates ----------
  async function relabelLink(a) {
    // Only same-origin links (skip external)
    try {
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) {
        log("skip external", a.href);
        return;
      }
    } catch { /* leave it; browser-resolved a.href is absolute */ }

    const newText = await resolveTitleFromHref(a.href);
    if (!newText) return;

    const curr = (a.textContent || "").trim();
    if (curr !== newText) {
      log("update", { href: a.href, from: curr, to: newText });
      a.textContent = newText;
      a.title = newText;
    } else {
      log("unchanged", a.href);
    }
  }

  async function relabelAll(root = document) {
    const links = root.querySelectorAll(`${SIDEBAR_SCOPE} ${LINK_SELECTOR}`);
    log("links found:", links.length);
    const BATCH = 10;
    for (let i = 0; i < links.length; i += BATCH) {
      const slice = Array.from(links).slice(i, i + BATCH);
      await Promise.all(slice.map(relabelLink));
    }
  }

  function observeSidebar() {
    const sidebar = document.querySelector(SIDEBAR_SCOPE);
    if (!sidebar) {
      log("sidebar not found");
      return;
    }
    const mo = new MutationObserver(() => relabelAll(sidebar));
    mo.observe(sidebar, { subtree: true, childList: true, characterData: true });
    window.addEventListener("popstate", () => relabelAll(sidebar));
    window.addEventListener("hashchange", () => relabelAll(sidebar));
  }

  function start() {
    log("init");
    relabelAll();
    observeSidebar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();