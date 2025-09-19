/* ==============================================================
   add classes to the body of the document to evoke Style settings
   ============================================================== */
function applyClasses() {
    document.body.classList.add(
      'heading-ligatures', // typomagical
      'no-image-alttext-caption',
      //'ss-title-gradient', //typomagical
    );
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    applyClasses();
} else {
    document.addEventListener("DOMContentLoaded", applyClasses);
}
