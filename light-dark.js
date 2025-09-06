(() => {
  const q = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = q.matches;
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    // For themes that use data-theme instead of classes:
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
  };
  apply();
  q.addEventListener('change', apply);
  })();
