(() => {
  const apply = () => {
    let hit = false;
    document.querySelectorAll('h1.page-header').forEach(h => {
      h.classList.remove('page-header');
      hit = true;
    });
    if (hit) console.log('[knockOut] normalized page header(s).');
    return hit;
  };

  // Debounce helper
  let t;
  const schedule = () => { clearTimeout(t); t = setTimeout(apply, 50); };

  // 1) Initial
  schedule();

  // 2) Keep watching DOM for SPA swaps
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });

  // 3) Watch URL changes (pushState/replaceState/hashchange/back/forward)
  const emitRoute = () => window.dispatchEvent(new Event('as:routechange'));
  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function(...args){ const r = orig.apply(this, args); emitRoute(); return r; };
  });
  window.addEventListener('popstate', emitRoute);
  window.addEventListener('hashchange', emitRoute);
  window.addEventListener('as:routechange', schedule);

  // 4) Safety nets some frameworks emit
  ['pageshow','visibilitychange','turbo:load','pjax:end'].forEach(ev =>
    window.addEventListener(ev, schedule)
  );
})();