/**
 * Obsidian Publish — Lightbox with fixed filmstrip, H1 title, H2 section, and sidebar map as last item
 * - Click any image/video in .markdown-rendered to open
 * - Filmstrip: drag-to-scroll (mouse/touch/pen) + click thumbs to jump
 * - Keyboard: ← → navigate, Esc close
 * - Header shows NOTE TITLE (line 1) and current image's H2 (line 2)
 * - Appends sidebar map <iframe> as final gallery item; map alt = text from #side-map-place .place
 * - Portrait/square media clamped to viewport (no overlap with filmstrip)
 */
(() => {
  if (window.__obsZoomBound_FinalFix) return;
  window.__obsZoomBound_FinalFix = true;

  /* ==================== CSS ==================== */
  const CSS = `
:root{
  --zoom-thumb-height: 100px;
  --zoom-thumb-pad: 8px;
  --zoom-thumb-gap: var(--callout-gallery-gap, 8px);
  --zoom-thumbs-total-height: calc(
    var(--zoom-thumb-height) + (var(--zoom-thumb-pad) * 2) + env(safe-area-inset-bottom,0px) + var(--zoom-thumb-gap)
  );
  --zoom-header-fallback-h: 56px;
  --zoom-header-actual-h: var(--zoom-header-fallback-h);
  --zoom-gap: var(--zoom-thumb-gap);
}

.zoom-overlay{
  position: fixed; inset: 0;
  background: rgba(0,0,0,.88);
  z-index: 9999;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
body.zoom-open{ overflow: hidden; }

/* Header (note title + current H2) */
.zoom-overlay__header{
  position: fixed; top: 0; left: 0; right: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; padding: 8px 56px 10px;
  pointer-events: none; z-index: 10002;
  background: linear-gradient(to bottom, rgba(0,0,0,.35), rgba(0,0,0,0));
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
}
.zoom-overlay__title, .zoom-overlay__section{
  pointer-events: auto;
  font-family: var(--font-caption-theme), var(--font-monospace-theme), sans-serif;
  text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 80%;
}
.zoom-overlay__title{
  font-size: var(--font-ui-large); font-weight: 600; color: rgba(255,255,255,.95);
}
.zoom-overlay__section{
  font-size: calc(var(--font-ui-large) * .9); font-weight: 500; color: rgba(255,255,255,.8);
}
.zoom-overlay__close{
  position: absolute; top: 6px; right: 10px;
  pointer-events: auto; z-index: 10003;
  font-size: var(--font-ui-large); line-height: 1;
  color: rgba(255,255,255,.9); background: transparent; border: none; cursor: pointer;
  padding: 6px 10px;
}
.zoom-overlay__close:hover{ color: #fff; }

/* Layout reserves header & filmstrip space */
.zoom-overlay__inner{
  position: fixed; inset: 0;
  padding-top: calc(var(--zoom-header-actual-h) + var(--zoom-gap));
  padding-bottom: calc(var(--zoom-thumbs-total-height) + var(--zoom-gap));
  display: grid; place-items: center;
  box-sizing: border-box;
}

/* Main media area */
.zoom-overlay__wrap{
  width: 100%; height: 100%;
  display: grid; place-items: center;
}
.zoom-overlay__media, .zoom-overlay__media--frame{
  max-width: 100vw;
  max-height: calc(100vh - var(--zoom-header-actual-h) - var(--zoom-thumbs-total-height) - (2 * var(--zoom-gap)));
  object-fit: contain;
  border-radius: var(--img-border-radius, 6px);
  box-shadow: 0 4px 20px rgba(0,0,0,.6);
  background: #000;
}
.zoom-overlay__media--frame{ width: 100%; height: 100%; border: 0; }

/* Caption (sits above filmstrip) */
.zoom-overlay__caption{
  position: fixed;
  left: 50%; transform: translateX(-50%);
  bottom: calc(var(--zoom-thumbs-total-height) + var(--zoom-gap));
  color: var(--text-muted);
  font-family: 'Alegreya SC', sans-serif;
  font-size: var(--font-ui-large);
  line-height: 1.3; max-width: 80ch; text-align: center;
  padding: 4px 10px;
}

/* Nav zones */
.zoom-overlay__nav{
  position: fixed; top: var(--zoom-header-actual-h); bottom: var(--zoom-thumbs-total-height);
  width: 40%; z-index: 9998;
}
.zoom-overlay__nav--left{ left: 0; cursor: w-resize; }
.zoom-overlay__nav--right{ right: 0; cursor: e-resize; }

/* Filmstrip (black) */
.zoom-overlay__thumbs{
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom,0px) + var(--zoom-gap));
  width: min(90vw, 1400px);
  box-sizing: border-box;
  padding: var(--zoom-thumb-pad);
  overflow-x: auto; overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  z-index: 10001;
  background: rgba(0,0,0,.96);
  border-radius: 8px;
  cursor: grab; user-select: none; touch-action: pan-x;
}
.zoom-overlay__thumbs.dragging{ cursor: grabbing; }
.zoom-overlay__thumbs-track{
  display: flex; align-items: center; gap: var(--zoom-thumb-gap); min-width: 100%;
}

/* Thumbs */
.zoom-thumb{
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  height: var(--zoom-thumb-height); aspect-ratio: 16/10;
  background: #000;
  cursor: pointer; border-radius: var(--img-border-radius, 6px);
  outline: 2px solid transparent;
  transition: box-shadow .18s ease, outline-color .18s ease, transform .18s ease;
  touch-action: manipulation; box-sizing: border-box;
}
.zoom-thumb__media, .zoom-thumb__frame{
  display: block;
  height: 100%; width: auto; max-width: 260px;
  object-fit: cover;
  border-radius: inherit;
  box-shadow: 0 2px 10px rgba(0,0,0,.35);
  background: #000;
  -webkit-user-drag: none; user-drag: none; pointer-events: none;
}
.zoom-thumb__frame{ border: 0; }

.zoom-thumb.is-active{
  outline-color: rgba(255,255,255,.85);
  box-shadow: 0 0 0 2px rgba(255,255,255,.25), 0 6px 18px rgba(0,0,0,.4);
  transform: translateY(-1px);
}
  `;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ==================== Utilities / Model ==================== */
  const SELECTOR_MEDIA = '.markdown-rendered .image-embed img, .markdown-rendered .video-embed video';

  function getSectionH2TextFor(el, root = document.querySelector('.markdown-rendered') || document) {
    if (!el || !root) return '';
    const h2s = Array.from(root.querySelectorAll('h2'));
    let last = '';
    for (const h2 of h2s) {
      if (h2.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        last = h2.textContent?.trim?.() || last;
      }
    }
    return last;
  }

  function captionFor(el) {
    const alt = (el.getAttribute?.('alt') || '').trim();
    const looksLikeFilename = /\.(png|jpe?g|tiff?|webp|gif|svg|mov|mp4|webm)$/i.test(alt);
    return alt && !looksLikeFilename ? alt : '';
  }

  // Map detector — exact selector you provided
  function detectSidebarMap() {
    const wrap =
      document.getElementById('side-map-wrap') ||
      document.querySelector('#side-map-wrap, .side-map-wrap, [data-side-map-wrap]') ||
      document.querySelector('[data-map-wrap], .map-wrap');

    const iframe =
      document.getElementById('side-map-iframe') ||
      document.querySelector('#side-map-iframe, .side-map-iframe, [data-side-map-iframe]') ||
      (wrap && wrap.querySelector('iframe'));

    if (!iframe || !iframe.src) return null;

    // Your exact location node:
    const placeEl = document.querySelector('div#side-map-place span.place');
    let label = placeEl?.textContent?.trim?.() || '';

    // Fallbacks if needed (kept, but your exact selector should cover it)
    if (!label && wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelector('iframe')?.remove();
      label = (clone.textContent || '').replace(/\s+/g,' ').trim();
    }
    if (!label) label = document.querySelector('h1')?.textContent?.trim?.() || document.title || 'Map';

    return { src: iframe.src, label };
  }

  let mediaItems = []; // [{type:'img'|'video'|'map', src, alt, caption, section}]
  let currentIndex = -1;

  function collectMedia() {
    const root = document.querySelector('.markdown-rendered') || document;
    const raw = Array.from(root.querySelectorAll(SELECTOR_MEDIA));

    mediaItems = raw.map(el => {
      const type = el.tagName.toLowerCase() === 'video' ? 'video' : 'img';
      return {
        type,
        src: el.currentSrc || el.src,
        alt: type === 'img' ? (el.getAttribute('alt') || '') : '',
        caption: captionFor(el),
        section: getSectionH2TextFor(el, root),
      };
    });

    const map = detectSidebarMap();
    if (map) {
      mediaItems.push({
        type: 'map',
        src: map.src,
        alt: map.label,      // exact location text
        caption: map.label,  // show below the frame too
        section: '',
      });
    }
  }

  /* ==================== Rendering ==================== */
  function measureAndSetHeaderHeight(headerEl) {
    const h = headerEl?.getBoundingClientRect?.().height || 0;
    document.documentElement.style.setProperty('--zoom-header-actual-h', `${Math.ceil(h)}px`);
  }

  function destroyMediaIn(wrap) {
    const prev = wrap.querySelector('.zoom-overlay__media, .zoom-overlay__media--frame');
    if (!prev) return;
    if (prev.tagName.toLowerCase() === 'video') {
      prev.pause();
      prev.removeAttribute('src');
      prev.load?.();
    }
    wrap.innerHTML = '';
  }

  function updateHeaderSection(idx) {
    const ov = document.querySelector('.zoom-overlay');
    const sectionEl = ov?.querySelector('.zoom-overlay__section');
    if (!sectionEl) return;
    const item = mediaItems[idx];
    const text = item?.section || '';
    sectionEl.textContent = text;
    sectionEl.style.display = text ? '' : 'none';
  }

  function updateThumbActive(idx) {
    const ov = document.querySelector('.zoom-overlay');
    ov?.querySelectorAll('.zoom-thumb').forEach(el => {
      el.classList.toggle('is-active', Number(el.dataset.index) === idx);
    });
    const sc = ov?.querySelector('.zoom-overlay__thumbs');
    const active = sc?.querySelector(`[data-index="${idx}"]`);
    if (sc && active) {
      const target = active.offsetLeft + active.clientWidth / 2 - sc.clientWidth / 2;
      const clamped = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, target));
      sc.scrollTo({ left: clamped, behavior: 'smooth' });
    }
  }

  function renderAt(index) {
    if (!mediaItems.length) return;
    if (index < 0) index = mediaItems.length - 1;
    if (index >= mediaItems.length) index = 0;
    currentIndex = index;

    const ov = document.querySelector('.zoom-overlay');
    if (!ov) return;

    const wrap = ov.querySelector('.zoom-overlay__wrap');
    const captionEl = ov.querySelector('.zoom-overlay__caption');

    destroyMediaIn(wrap);

    const item = mediaItems[currentIndex];
    let node;
    if (item.type === 'video') {
      node = document.createElement('video');
      node.src = item.src;
      node.controls = true;
      node.autoplay = true;
      node.playsInline = true;
      node.className = 'zoom-overlay__media';
    } else if (item.type === 'map') {
      node = document.createElement('iframe');
      node.src = item.src;
      node.className = 'zoom-overlay__media--frame';
      node.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      node.setAttribute('allowfullscreen', '');
      node.setAttribute('loading', 'eager');
    } else {
      node = document.createElement('img');
      node.src = item.src;
      node.alt = item.alt || '';
      node.className = 'zoom-overlay__media';
    }
    wrap.appendChild(node);

    captionEl.textContent = item.caption || '';
    captionEl.style.display = item.caption ? '' : 'none';

    updateHeaderSection(currentIndex);
    updateThumbActive(currentIndex);
  }

  function closeOverlay() {
    const ov = document.querySelector('.zoom-overlay');
    if (!ov) return;
    document.removeEventListener('keydown', ov._onKey);
    destroyMediaIn(ov.querySelector('.zoom-overlay__wrap'));
    ov.remove();
    document.body.classList.remove('zoom-open');
    currentIndex = -1;
  }

  /* ==================== Build overlay ==================== */
  // scroller drag state + per-thumb local thresholds
  let scrollerDragging = false;

  function openOverlay(startIndex) {
    collectMedia();
    if (!mediaItems.length) return;

    currentIndex = Math.max(0, Math.min(mediaItems.length - 1, startIndex));

    const ov = document.createElement('div');
    ov.className = 'zoom-overlay';
    ov.tabIndex = -1;
    ov.innerHTML = `
      <div class="zoom-overlay__header">
        <div class="zoom-overlay__title">${document.querySelector('h1')?.textContent?.trim?.() || document.title || ''}</div>
        <div class="zoom-overlay__section" style="display:none;"></div>
        <button class="zoom-overlay__close" aria-label="Close">&times;</button>
      </div>

      <div class="zoom-overlay__inner">
        <div class="zoom-overlay__wrap"></div>
      </div>

      <div class="zoom-overlay__caption"></div>

      <div class="zoom-overlay__nav zoom-overlay__nav--left"></div>
      <div class="zoom-overlay__nav zoom-overlay__nav--right"></div>

      <div class="zoom-overlay__thumbs">
        <div class="zoom-overlay__thumbs-track"></div>
      </div>
    `;
    document.body.appendChild(ov);
    document.body.classList.add('zoom-open');

    // Measure header height after mount
    const headerEl = ov.querySelector('.zoom-overlay__header');
    requestAnimationFrame(() => measureAndSetHeaderHeight(headerEl));

    // Build thumbnails
    const track = ov.querySelector('.zoom-overlay__thumbs-track');
    mediaItems.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.className = 'zoom-thumb';
      btn.type = 'button';
      btn.dataset.index = String(idx);
      btn.setAttribute('aria-label', item.type === 'map' ? `Open map: ${item.alt}` : `View media ${idx + 1}`);

      let thumbNode;
      if (item.type === 'map') {
        thumbNode = document.createElement('iframe');
        thumbNode.className = 'zoom-thumb__frame';
        thumbNode.src = item.src;
        thumbNode.setAttribute('tabindex', '-1');
      } else {
        thumbNode = document.createElement(item.type === 'video' ? 'video' : 'img');
        thumbNode.className = 'zoom-thumb__media';
        thumbNode.src = item.src;
        if (item.type === 'video') {
          thumbNode.muted = true; thumbNode.playsInline = true; thumbNode.loop = true; thumbNode.autoplay = true;
        } else {
          thumbNode.alt = item.alt || ''; thumbNode.loading = 'lazy'; thumbNode.decoding = 'async';
        }
      }
      thumbNode.setAttribute('draggable', 'false');
      btn.appendChild(thumbNode);
      track.appendChild(btn);

      // Per-thumb drag vs click discrimination
      let localDown = false, startX = 0, moved = 0;
      btn.addEventListener('pointerdown', (e) => { localDown = true; startX = e.clientX ?? 0; moved = 0; }, { passive: true });
      btn.addEventListener('pointermove', (e) => {
        if (!localDown) return;
        moved = Math.max(moved, Math.abs((e.clientX ?? 0) - startX));
      }, { passive: true });
      btn.addEventListener('pointerup', () => { localDown = false; }, { passive: true });

      btn.addEventListener('click', (e) => {
        // If the scroller is (or just was) dragging, or this thumb moved > threshold, ignore.
        if (scrollerDragging || moved > 6) return;
        e.preventDefault();
        e.stopPropagation();
        renderAt(idx);
      });
    });

    // Drag-to-scroll (Pointer Events) on filmstrip only
    const sc = ov.querySelector('.zoom-overlay__thumbs');
    let dragging = false, sx = 0, sl = 0;
    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      scrollerDragging = false;
      sx = e.clientX; sl = sc.scrollLeft;
      sc.classList.add('dragging');
      sc.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    sc.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      if (!scrollerDragging && Math.abs(dx) > 6) scrollerDragging = true; // threshold
      sc.scrollLeft = sl - dx;
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      sc.classList.remove('dragging');
      sc.releasePointerCapture?.(e.pointerId);
      // Allow clicks immediately after pointerup if there was no significant drag
      setTimeout(() => { scrollerDragging = false; }, 0);
    };
    sc.addEventListener('pointerup', endDrag);
    sc.addEventListener('pointercancel', endDrag);
    sc.addEventListener('pointerleave', endDrag);
    sc.addEventListener('dragstart', (e) => e.preventDefault());

    // Close / nav / backdrop
    ov.querySelector('.zoom-overlay__close').addEventListener('click', closeOverlay);
    ov.querySelector('.zoom-overlay__nav--left').addEventListener('click', (e) => { e.stopPropagation(); renderAt(currentIndex - 1); });
    ov.querySelector('.zoom-overlay__nav--right').addEventListener('click', (e) => { e.stopPropagation(); renderAt(currentIndex + 1); });
    ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(); });

    // Keyboard
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); renderAt(currentIndex + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); renderAt(currentIndex - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); }
    };
    document.addEventListener('keydown', onKey);
    ov._onKey = onKey;

    renderAt(currentIndex);
  }

  /* ==================== Open from normal view (delegated) ==================== */
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const media = e.target.closest(SELECTOR_MEDIA);
    if (!media) return;
    if (media.closest('a, .internal-link, .zoom-overlay')) return;
    e.preventDefault();

    const root = document.querySelector('.markdown-rendered') || document;
    const pageMedia = Array.from(root.querySelectorAll(SELECTOR_MEDIA));
    const startIndex = pageMedia.indexOf(media);
    openOverlay(startIndex >= 0 ? startIndex : 0);
  });
})();