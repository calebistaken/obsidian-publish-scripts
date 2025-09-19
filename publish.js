/* ==============================================================
   NO LONGER USED: Setup for pulling scripts from a guthub repository
   ============================================================== */
const repo = 'https://cdn.jsdelivr.net/gh/calebistaken/obsidian-publish-scripts';
let commit = ''; //'c91addc261a733b497333a65a1241cdf119d6464'; // at least the first 7 digits of the hash
let v      = ''; // Math.floor(Math.random() * 1000); // cache-bust with random version #

commit = '' && '@'   + commit;
v =      '' && '?v=' + v);


/* ==============================================================
   CUSTOM SYNTAX: Local import/script replacements
   ============================================================== */

// add classes to the body for minimal compatability with stylesettings
import(repo + commit + "/js/style-settings.js" + v);

// wrap images with alt-text in figures with figcaps 
import(repo + commit + "/js/photo-captions.js" + v);

// Auto switch light/dark theme with the browser
import(repo + commit + "/js/auto-light-dark-switching.js" + v);

// Sanitize display text of links and titles by removing the leading YYYYMMDDx date string.
import(repo + commit + "/js/sanitize-filenames.js" + v);

// Fullscreen Lightbox image gallary for pictures on click
import(repo + commit + "/js/image-lightbox.js" + v);

// Add `[Prev] | [Next]` buttons to each note
import(repo + commit + "/js/next-previous-story.js" + v);

// Make h1.page-header look like normal h1
import(repo + commit + "/js/h1-page-header.js" + v);

// Add a location map to the right sidebar
import(repo + commit + "/js/insert-maps.js" + v);

// Add a dates abov the H1
import(repo + commit + "/js/insert-dates.js" + v);

// Add Disqus comments to the bottom of the story
window.DISQUS_SHORTNAME = 'adventure-stories';
import(repo + commit + "/js/disqus.js" + v);



