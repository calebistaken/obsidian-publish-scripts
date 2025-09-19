// Obsidian Publish — Auto-detect custom domain & set favicon
(function () {
  // True if we are on publish.obsidian.md (or any subdomain of it)
  const ON_PUBLISH =
    location.hostname === "publish.obsidian.md" ||
    location.hostname.endsWith(".publish.obsidian.md");

  if (ON_PUBLISH) return; // keep Obsidian's default on publish.obsidian.md

  // Cache-buster: bump when you update icons
  const v = "1";
  const q = v ? `?v=${v}` : "";

  // Use the existing icon's directory (or site root) so paths stay portable
  const existing = document.querySelector('link[rel~="icon"]');
  const baseURL = existing ? new URL(existing.href, document.baseURI) : new URL("/", document.baseURI);
  baseURL.pathname = baseURL.pathname.replace(/[^/]*$/, ""); // strip filename, keep folder

  // Candidate filenames you’ve published (first that loads wins)
  const candidates = [
    "favicon-32.png",
    "favicon.png",
    "favicon.ico",
    "logo.png"
  ];

  function setIcon(href, rel = "icon", type = "") {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      if (type) link.type = type;
      document.head.appendChild(link);
    }
    link.href = href;
  }

  // Try candidates in order; pick the first that returns a 200
  (async () => {
    for (const name of candidates) {
      try {
        const url = new URL(name + q, baseURL).toString();
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (res.ok) {
          // set favicon
          const ext = name.split(".").pop();
          const type = ext === "png" ? "image/png" : ext === "ico" ? "image/x-icon" : "";
          setIcon(url, "icon", type);

          // nice-to-have for mobile home screens if you’ve got it
          const apple = new URL("apple-touch-icon.png" + q, baseURL).toString();
          fetch(apple, { method: "HEAD", cache: "no-store" }).then(r => {
            if (r.ok) setIcon(apple, "apple-touch-icon");
          });
          break;
        }
      } catch (_) { /* ignore and try next */ }
    }
  })();
})();