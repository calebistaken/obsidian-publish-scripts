/**
 * Clean display text by removing leading YYYYMMDDx + space, e.g. "20240814a "
 * - Affects: link labels + visible titles + document.title (tab)
 * - Does NOT change href/URLs
 * - Works on SPA route changes
 */
(() => {
  // \b[0-9]{8}[a-z]\s+  (case-insensitive)
  const RE = /\b\d{8}[a-z]\s+/i;

  // Replace once at the start of a string, then trim leftover whitespace
  const stripStamp = (s) => (s ? s.replace(RE, '').trim() : s);

  // Walk text nodes under an element and clean those that match
  const cleanTextNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return RE.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const toEdit = [];
    let n;
    while ((n = walker.nextNode())) toEdit.push(n);
    for (const node of toEdit) node.nodeValue = stripStamp(node.nodeValue);
  };

  // Clean link labels (without touching href)
  const cleanLinks = (scope = document) => {
    const anchors = scope.querySelectorAll('a');
    anchors.forEach((a) => {
      // If the link has only a text node, easy path:
      if (a.childNodes.length === 1 && a.firstChild.nodeType === Node.TEXT_NODE) {
        const original = a.textContent;
        if (RE.test(original)) a.textContent = stripStamp(original);
      } else {
        // For nested spans/icons, clean all text nodes within
        cleanTextNodes(a);
      }
    });
  };

  // Clean visible note titles + tab title
  const cleanTitles = (scope = document) => {
    // Try a few common Publish selectors for the visible H1/title
    const titleEls = scope.querySelectorAll(
      'h1, .view-header-title, header h1, .markdown-reading-view h1, .markdown-rendered h1'
    );
    titleEls.forEach((el) => {
      // Text-only title
      if (el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE) {
        const t = el.textContent;
        if (RE.test(t)) el.textContent = stripStamp(t);
      } else {
        // In case the title is split across spans
        cleanTextNodes(el);
      }
    });

    // Browser tab title
    if (document.title && RE.test(document.title)) {
      document.title = stripStamp(document.title);
    }
  };

  const run = (root = document) => {
    cleanLinks(root);
    cleanTitles(root);
  };

  // Initial pass
  run();

  // Observe SPA route/content changes and re-run
  const observer = new MutationObserver((mutations) => {
    // If nodes added to the DOM, re-run in a cheap way
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        // Run once per batch using the document scope for simplicity/robustness
        run();
        break;
      }
    }
  });

  // Observe the whole document body (Publish updates content inside it)
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also catch hash/History changes (belt-and-suspenders)
  window.addEventListener('hashchange', () => run());
  window.addEventListener('popstate', () => run());
})();