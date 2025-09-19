/* ==============================================================
   NO LONGER USED: Setup for pulling scripts from a guthub repository
   ============================================================== */
const repo = 'https://cdn.jsdelivr.net/gh/calebistaken/obsidian-publish-scripts';
let commit = ''; //'c91addc261a733b497333a65a1241cdf119d6464'; // at least the first 7 digits of the hash
let v      = ''; // Math.floor(Math.random() * 1000); // cache-bust with random version #

commit = '' && '@'   + commit;
v =      '' && '?v=' + v;


/* ==============================================================
   CUSTOM SYNTAX: Local import/script replacements
   ============================================================== */

// add classes to the body for minimal compatability with stylesettings
import "./js/style-settings.js";

// wrap images with alt-text in figures with figcaps 
import "./js/photo-captions.js";

// Auto switch light/dark theme with the browser
import "./js/auto-light-dark-switching.js";

// Sanitize display text of links and titles by removing the leading YYYYMMDDx date string.
import "./js/sanitize-filenames.js";

// Fullscreen Lightbox image gallary for pictures on click
import "./js/image-lightbox.js";

// Add `[Prev] | [Next]` buttons to each note
import "./js/next-previous-story.js";

// Make h1.page-header look like normal h1
import "./js/h1-page-header.js";

// Add a location map to the right sidebar
import "./js/insert-maps.js";

// Add a dates abov the H1
import "./js/insert-dates.js";

// Add Disqus comments to the bottom of the story
window.DISQUS_SHORTNAME = 'adventure-stories';
import "./js/disqus.js";



