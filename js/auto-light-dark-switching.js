(() => {
  // Detect what Publish set as the starting theme
  let defaultIsDark = document.body.classList.contains('theme-dark') ||
                      document.body.getAttribute('data-theme') === 'dark';

  // Listen for OS theme changes
  const q = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = () => {
    const prefersDark = q.matches;
    // If OS preference matches the default, leave it alone
    // If it doesn’t, flip
    const useDark = prefersDark ? true : !defaultIsDark ? false : defaultIsDark;
    document.body.classList.toggle('theme-dark', useDark);
    document.body.classList.toggle('theme-light', !useDark);
    document.body.setAttribute('data-theme', useDark ? 'dark' : 'light');
  };

  apply();
  q.addEventListener('change', apply);
})();