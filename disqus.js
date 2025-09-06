(() => {
  // --- Config: pick up shortname from the calling script ---
  const SHORTNAME =
    (typeof window.DISQUS_SHORTNAME === 'string' && window.DISQUS_SHORTNAME.trim()) ||
    (typeof window.__DISQUS_SHORTNAME === 'string' && window.__DISQUS_SHORTNAME.trim()) ||
    '';

  if (!SHORTNAME) {
    console.warn('[Disqus] No SHORTNAME provided. Set window.DISQUS_SHORTNAME before loading this script.');
    return;
  }

  // --- Helpers ---
  const pageIdentifier = () => (
    // path is typically the most stable identifier across Publish
    window.location.pathname || document.title || window.location.href
  );

  const pageUrl = () => (
    window.location.origin + window.location.pathname
  );

  function resetDisqus() {
    if (typeof window.DISQUS !== 'undefined') {
      window.DISQUS.reset({
        reload: true,
        config: function () {
          this.page.identifier = pageIdentifier();
          this.page.url = pageUrl();
        }
      });
    }
  }

  function loadDisqus() {
    if (typeof window.DISQUS === 'undefined') {
      // Disqus expects a global function named disqus_config if you want to set per-page info on first load
      window.disqus_config = function () {
        this.page.identifier = pageIdentifier();
        this.page.url = pageUrl();
      };

      const d = document;
      const s = d.createElement('script');
      s.src = `https://${SHORTNAME}.disqus.com/embed.js`;
      s.setAttribute('data-timestamp', String(+new Date()));
      (d.head || d.body).appendChild(s);
    } else {
      resetDisqus();
    }
  }

  function findMount() {
    // Obsidian Publish usually has .mod-footer; if not, fall back to main content end.
    const all = document.querySelectorAll('.mod-footer');
    const last = all[all.length - 1];
    if (last) return last;

    const content = document.querySelector('.markdown-reading-view, .markdown-preview-view, main, body');
    return content || document.body;
  }

  function insertCommentComponent() {
    // Reuse existing thread if present
    let thread = document.getElementById('disqus_thread');
    if (!thread) {
      thread = document.createElement('div');
      thread.id = 'disqus_thread';

      const mount = findMount();
      if (!mount) {
        console.warn('[Disqus] Mount container not found.');
        return;
      }

      // Visual divider
      const divider = document.createElement('hr');
      divider.style.marginTop = '3rem';
      divider.style.marginBottom = '3rem';
      divider.style.border = 'none';
      divider.style.borderTop = '2px solid var(--background-modifier-border, #ccc)';

      mount.appendChild(divider);
      mount.appendChild(thread);
    }

    loadDisqus();
  }

  // Delay a touch to let Publish finish DOM work
  function scheduleInsert() {
    window.clearTimeout(scheduleInsert._t);
    scheduleInsert._t = window.setTimeout(insertCommentComponent, 600);
  }

  // Run once DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    scheduleInsert();
  } else {
    document.addEventListener('DOMContentLoaded', scheduleInsert, { once: true });
  }

  // Singleton observer to re-add thread after soft navigations / DOM swaps
  if (!window.__DISQUS_OBSERVER__) {
    const observer = new MutationObserver((mutations) => {
      let shouldReinsert = false;
      for (const m of mutations) {
        // If thread got removed, or if content area was replaced, try to reinsert
        for (const node of m.removedNodes) {
          if (node.nodeType === 1 && (node.id === 'disqus_thread' || node.querySelector?.('#disqus_thread'))) {
            shouldReinsert = true;
            break;
          }
        }
        if (shouldReinsert) break;
        if (m.type === 'childList' && (m.target?.classList?.contains('markdown-reading-view') ||
                                       m.target?.classList?.contains('markdown-preview-view'))) {
          shouldReinsert = true;
        }
      }
      if (shouldReinsert) scheduleInsert();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.__DISQUS_OBSERVER__ = observer;
  }

  // Also reload Disqus when URL path truly changes (Publish full navigate)
  window.addEventListener('popstate', scheduleInsert);
  window.addEventListener('hashchange', scheduleInsert);
})();