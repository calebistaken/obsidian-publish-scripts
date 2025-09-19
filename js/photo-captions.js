// alt-figure-captions.js — wrap embeds in <figure> with <figcaption>
(() => {
  const STYLE_ID = "alt-figure-caption-style";
  const SEL = [".image-embed[alt]", ".video-embed[alt]"].join(",");
  const EXT_RX = /\.(png|webp|jpg|jpeg|tif|tiff|mp4|heic|mov|heif)$/i;

  // ---------- CSS injection ----------
  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      figure.alt-figure {
        display: inline-block;
        text-align: center;
        margin: 1.2em auto;
      }
      figure.alt-figure > .image-embed,
      figure.alt-figure > .video-embed {
        display: block;
        margin: 0 auto;
      }
      figure.alt-figure figcaption.alt-caption {
        margin-top: .4rem;
        color: var(--text-muted);
        font-family: var(--font-caption-theme, var(--font-monospace-caption,
          ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace));
        font-size: var(--font-small, 0.875rem);
        line-height: var(--line-height-tight, 1.3);
      }
      figure.alt-figure figcaption.alt-caption em {
        font-style: italic;
      }
      figure.alt-figure figcaption.alt-caption strong {
        font-weight: var(--font-semibold, 600);
      }
    `;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  };

  // ---------- helpers ----------
  const escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const mdEmStrong = (s) => {
    let t = escapeHtml(String(s));
    t = t.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
    t = t.replace(/(\*|_)([^*_].*?)\1/g, "<em>$2</em>");
    t = t.replace(/\n+/g, "<br>");
    return t;
  };

  const wrapFigures = (root = document) => {
    root.querySelectorAll(SEL).forEach((el) => {
      if (el.dataset.altCaptionApplied === "1") return;
      const alt = el.getAttribute("alt") || "";
      if (!alt || EXT_RX.test(alt)) return;

      // Build <figure>
      const figure = document.createElement("figure");
      figure.className = "alt-figure";

      // Clone or move the element
      el.parentNode.insertBefore(figure, el);
      figure.appendChild(el);

      // Build caption
      const cap = document.createElement("figcaption");
      cap.className = "alt-caption";
      cap.innerHTML = mdEmStrong(alt);
      figure.appendChild(cap);

      el.dataset.altCaptionApplied = "1";
    });
  };

  // ---------- boot ----------
  const boot = () => {
    ensureStyle();
    wrapFigures();

    // Handle Publish SPA-ish route changes
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        wrapFigures();
      }
    }, 200);

    // Watch for newly loaded content
    const mo = new MutationObserver(() => wrapFigures());
    mo.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();