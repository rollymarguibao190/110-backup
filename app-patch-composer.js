
function waitForElement(selector, maxWait, interval) {
  maxWait  = maxWait  || 1500;
  interval = interval || 30;

  return new Promise(function(resolve) {
    // Already exists — resolve immediately
    var el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    var elapsed = 0;
    var timer = setInterval(function() {
      el = document.querySelector(selector);
      elapsed += interval;

      if (el) {
        clearInterval(timer);
        resolve(el);
        return;
      }

      if (elapsed >= maxWait) {
        clearInterval(timer);
        resolve(null); // timed out — caller handles null gracefully
      }
    }, interval);
  });
}


function openOrgPostModal(oid) {

  // STEP 1 — Navigate to organizer page (synchronous, unchanged)
  showPage('organizer');

  // STEP 2 — Wait for the organizer tab bar to exist in the DOM,
  //          then switch to the "My Organization Page" tab.
  //          #orgDashTabs is static HTML inside page-organizer,
  //          so it's available immediately after showPage() adds
  //          the 'active' class — but we poll to be safe on slow devices.
  waitForElement('#orgDashTabs', 800).then(function(tabBar) {

    if (!tabBar) {
      // Tab bar never appeared — organizer page didn't render.
      // Log for debugging, bail out gracefully.
      console.warn('[CEMS] openOrgPostModal: #orgDashTabs not found after 800ms');
      return;
    }

    // Find the "My Organization Page" tab (index 1)
    var tabs = tabBar.querySelectorAll('.tab');
    var myOrgTab = tabs[1];

    if (!myOrgTab) {
      console.warn('[CEMS] openOrgPostModal: tab[1] not found in #orgDashTabs');
      return;
    }

    // Switch to My Org tab — this synchronously calls renderOrgMyOrgContent()
    switchOrgMainTab('myorg', myOrgTab);

    // STEP 3 — Wait for the composer textarea to exist in the DOM.
    //          It's created by renderOrgMyOrgContent() which just ran,
    //          but the browser may not have committed the layout yet.
    //          Poll until it's real, then expand and focus it.
    var textareaId  = 'postTextInput_'         + oid;
    var expandedId  = 'postComposerExpanded_'  + oid;

    waitForElement('#' + textareaId, 1000).then(function(ta) {

      if (!ta) {
        // Textarea didn't appear — org may not have a post composer
        // (e.g. renderOrgMyOrgContent showed the "no org" empty state).
        // Navigation already succeeded, so don't show an error.
        // Just scroll the myorg section into view as minimal feedback.
        var myOrgSection = document.getElementById('orgDashMyOrgSection');
        if (myOrgSection) myOrgSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        console.warn('[CEMS] openOrgPostModal: textarea #' + textareaId + ' not found — org may have no composer');
        return;
      }

      // Expand the composer
      var expanded = document.getElementById(expandedId);
      if (expanded) expanded.style.display = 'block';

      // Focus the textarea — requestAnimationFrame ensures the
      // browser has finished layout before we attempt focus,
      // preventing the focus being silently dropped on Safari/iOS.
      requestAnimationFrame(function() {
        ta.focus();

        // Scroll the composer into view smoothly
        ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  });
}

/* ============================================================
   SELF-TEST: verify the fix loaded and the flow is wired
   ============================================================ */
(function verifyCOMPOSER_PATCH() {
  var checks = {
    'waitForElement is defined':       typeof waitForElement === 'function',
    'openOrgPostModal is overridden':  typeof openOrgPostModal === 'function',
    'showPage exists':                 typeof showPage === 'function',
    'switchOrgMainTab exists':         typeof switchOrgMainTab === 'function',
    'renderOrgMyOrgContent exists':    typeof renderOrgMyOrgContent === 'function',
    'renderFeedComposer exists':       typeof renderFeedComposer === 'function',
  };

  var allGood = true;
  Object.keys(checks).forEach(function(label) {
    if (!checks[label]) {
      console.error('[CEMS COMPOSER PATCH] ❌ FAIL:', label);
      allGood = false;
    }
  });

  if (allGood) {
    console.log('[CEMS COMPOSER PATCH] ✅ Navigation flow patch applied. waitForElement() replaces fragile setTimeout chain.');
  }
})();