const knockOut = () => {
  const hdr = document.querySelector('h1.page-header');
  if (hdr) {
    hdr.classList.remove('page-header');
    console.log("Removed .page-header from:", hdr);
    return true;
  }
  return false;
};

if (!knockOut()) {
  const obs = new MutationObserver(() => { if (knockOut()) obs.disconnect(); });
  obs.observe(document.body, { childList: true, subtree: true });
}