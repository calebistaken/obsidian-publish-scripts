/* ===========================
   CDN base + versioning
   =========================== */
const REPO_BASE = 'https://cdn.jsdelivr.net/gh/calebistaken/obsidian-publish-scripts';
// Use a pinned commit for stability, or '@latest' while developing
const VERSION = '@latest'; // e.g. '@c91addc2' or '@latest'

// Cache-busting (optional, e.g. only when inline_debug)
const DEBUG_CACHE_BUST = true; // set true while debugging
const QS = DEBUG_CACHE_BUST ? `?v=${Date.now()}` : '';

/* ===========================
   Classic <script> injector
   (works with non-module code)
   =========================== */
function loadScript(path, { id, module = false, defer = true, async = false, replace = true } = {}) {
  const url = `${REPO_BASE}${VERSION}${path}${QS}`;

  if (replace) {
    if (id) document.querySelectorAll(`script#${CSS.escape(id)}`).forEach(n => n.remove());
    document.querySelectorAll(`script[src="${url}"]`).forEach(n => n.remove());
  }

  const s = document.createElement('script');
  if (id) s.id = id;
  s.src = url;
  s.defer = defer;
  s.async = async;
  if (module) s.type = 'module';
  document.head.appendChild(s);
  return s;
}

/* ===========================
   Load your scripts (classic)
   =========================== */
loadScript('/js/style-settings.js');
loadScript('/js/photo-captions.js');
loadScript('/js/auto-light-dark-switching.js');
loadScript('/js/sanitize-filenames.js');
loadScript('/js/image-lightbox.js');
loadScript('/js/next-previous-story.js');
loadScript('/js/h1-page-header.js');
loadScript('/js/insert-maps.js');
loadScript('/js/insert-dates.js');
loadScript('/js/ios-debug.js');

// Disqus shortname must be set before its loader runs
window.DISQUS_SHORTNAME = 'adventure-stories';
loadScript('/js/disqus.js');