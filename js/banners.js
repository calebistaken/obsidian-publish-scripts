document.addEventListener("DOMContentLoaded", () => {
  const pageEl = document.querySelector(".markdown-preview-view");
  if (!pageEl) return;

  // --- Inject CSS directly ---
  const style = document.createElement("style");
  style.textContent = `
    .banner-meta {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-family: var(--font-interface-theme, sans-serif);
      margin-bottom: 0.5em;
    }
    .banner-date {
      font-size: 0.9em;
      font-weight: bold;
    }
    .banner-file {
      font-size: 1.5em;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);

  // --- Extract frontmatter ---
  const rawFrontmatter = pageEl.querySelector("pre.frontmatter, .frontmatter-container");
  if (!rawFrontmatter) return;

  let bannerFile = null;
  let dateValue = null;

  rawFrontmatter.textContent.split("\n").forEach(line => {
    const [key, ...rest] = line.split(":");
    if (!key || !rest.length) return;
    const val = rest.join(":").trim();

    if (key.trim() === "banner") bannerFile = val.replace(/^["']|["']$/g, "");
    if (key.trim() === "date") dateValue = val.replace(/[\[\]]/g, "").trim();
  });

  // --- Format the date nicely ---
  let dateStr = "";
  if (dateValue) {
    const date = new Date(dateValue);
    const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    dateStr = date.toLocaleDateString(undefined, options);
  }

  // --- Insert date + banner filename ---
  if (bannerFile || dateStr) {
    const container = document.createElement("div");
    container.className = "banner-meta";

    if (dateStr) {
      const dateEl = document.createElement("div");
      dateEl.className = "banner-date";
      dateEl.textContent = dateStr;
      container.appendChild(dateEl);
    }

    if (bannerFile) {
      const fileEl = document.createElement("div");
      fileEl.className = "banner-file";
      fileEl.textContent = bannerFile;
      container.appendChild(fileEl);
    }

    const titleEl = pageEl.querySelector("h1, .page-title");
    if (titleEl) {
      titleEl.parentNode.insertBefore(container, titleEl);
    } else {
      pageEl.prepend(container);
    }
  }
});