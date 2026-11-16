/**
 * CEMS / CSU — SURGICAL PATCH FILE
 * ============================================================
 * Drop this AFTER app.js in your HTML (before </body>):
 *   <script src="app.js" defer></script>
 *   <script src="app_patch.js" defer></script>
 *
 * Each patch is labeled with its issue number, the exact broken
 * code, the fix, the root cause, and test steps.
 * ============================================================
 */

/* ============================================================
   PATCH #1 + #8 — renderOrgsDiscover(): TRUNCATED TEMPLATE
   ============================================================
   BROKEN CODE (inside renderOrgsDiscover, inside list.map()):
   ─────────────────────────────────────────────────────────────
     return `
       <div class="panel org-discover-card">
         <div style="height:110px;...${orgCoverStyle(o)};cursor:pointer"
              onclick="openOrgProfile('${o.id}')"></div>
         ...rest of card HTML...
       </div>`;

   ROOT CAUSE:
     An AI-assisted refactor replaced the full card template with a
     placeholder string "...rest of card HTML..." — valid JS syntax
     (it's just a string literal inside a template), so no parse
     error fires. The browser renders the literal text.

   FIX: Override renderOrgsDiscover with the complete card template,
        reconstructed from the pattern used in renderFeedSidebar
        and renderOrgProfile throughout the file.

   TEST STEPS:
     1. Log in as any user.
     2. Navigate to Organizations page.
     3. Confirm each org shows: cover photo, logo, name, category,
        follower count, Follow/Your Org button, View button.
     4. Click "View" — confirm it opens the org profile page.
     5. Click the cover photo — same navigation should trigger.
   ============================================================ */
function renderOrgsDiscover() {
  const grid = document.getElementById('orgsGrid');
  if (!grid) return;

  // Read search input if present
  const q = (document.getElementById('orgSearchInput')?.value || '').toLowerCase().trim();

  let list = (DB.organizations || []);
  if (q) {
    list = list.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.description || '').toLowerCase().includes(q) ||
      (o.category || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="ico">🏢</span>
        <h4>No organizations found</h4>
        <p>Try a different search term.</p>
      </div>`;
    return;
  }

  // Single assignment — no innerHTML += accumulation
  grid.innerHTML = list.map(o => {
    const following = isFollowing(o.id);
    const isOwn     = CU && CU.id === o.organizerId;
    const followers = orgFollowerCount(o.id);
    const postCount = orgPostCount(o.id);

    return `
      <div class="panel org-discover-card" style="overflow:hidden;border-radius:16px;padding:0;cursor:default">

        <!-- Cover photo -->
        <div style="height:110px;${orgCoverStyle(o)};cursor:pointer;position:relative"
             onclick="openOrgProfile('${o.id}')">
        </div>

        <!-- Logo overlapping cover -->
        <div style="padding:0 18px 16px;position:relative">
          <div style="margin-top:-28px;margin-bottom:10px;display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div style="cursor:pointer" onclick="openOrgProfile('${o.id}')">
              ${orgLogoHtml(o, 56)}
            </div>
            <div style="padding-bottom:4px">
              ${isOwn
                ? `<span style="font-size:11px;font-weight:700;color:var(--csu-green-dark);
                               background:var(--csu-green-soft);padding:4px 10px;border-radius:20px">
                     ✓ Your Org
                   </span>`
                : `<button class="btn btn-sm ${following ? 'btn-outline' : 'btn-primary'}"
                           style="font-size:12px;padding:5px 14px"
                           onclick="toggleFollow('${o.id}')">
                     ${following ? '✓ Following' : '+ Follow'}
                   </button>`
              }
            </div>
          </div>

          <!-- Name + category -->
          <div style="cursor:pointer" onclick="openOrgProfile('${o.id}')">
            <div style="font-family:'Playfair Display',serif;font-size:17px;font-weight:700;
                        color:var(--csu-green-dark);margin-bottom:4px;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${escapeHtml(o.name)}
            </div>
            <div style="margin-bottom:8px">
              <span class="role-badge organizer" style="font-size:11px">${escapeHtml(o.category || 'General')}</span>
            </div>
          </div>

          <!-- Description -->
          ${o.description
            ? `<p style="font-size:13px;color:var(--text-muted);line-height:1.5;
                         margin-bottom:10px;
                         display:-webkit-box;-webkit-line-clamp:2;
                         -webkit-box-orient:vertical;overflow:hidden">
                 ${escapeHtml(o.description)}
               </p>`
            : ''}

          <!-- Stats row -->
          <div style="display:flex;gap:16px;font-size:12px;color:var(--text-soft);
                      font-weight:600;margin-bottom:12px">
            <span>👥 ${followers} follower${followers === 1 ? '' : 's'}</span>
            <span>📝 ${postCount} post${postCount === 1 ? '' : 's'}</span>
          </div>

          <!-- View profile button -->
          <button class="btn btn-outline btn-sm"
                  style="width:100%;justify-content:center"
                  onclick="openOrgProfile('${o.id}')">
            View Profile →
          </button>
        </div>
      </div>`;
  }).join('');
}

/* ============================================================
   PATCH #2 — renderBrowseEvents(): MISSING SEARCH FILTER LOGIC
   ============================================================
   BROKEN CODE (inside renderBrowseEvents):
   ─────────────────────────────────────────────────────────────
     let evts = DB.events.filter(e => e.status === 'approved');
     if (browseFilter !== 'all') evts = evts.filter(e => e.category === browseFilter);
     // ← browseSearch input is never read. Typing in the search box does nothing.

   ROOT CAUSE:
     The HTML has <input id="browseSearch" oninput="renderBrowseEvents()"> but
     the render function never queries that element's value. The search
     input was wired up in HTML but the corresponding JS filter was dropped
     during refactor.

   FIX: Patch renderBrowseEvents to read #browseSearch and apply the filter.
        We override only the filter block — sort/card rendering is untouched.

   TEST STEPS:
     1. Go to Browse Events page.
     2. Type a partial event title in the search box.
     3. Cards should filter in real-time.
     4. Clear the box — all events return.
     5. Combine with category chip — both filters apply simultaneously.
   ============================================================ */
(function patchBrowseSearch() {
  const _origRenderBrowseEvents = renderBrowseEvents;

  window.renderBrowseEvents = function() {
    const el = document.getElementById('browseEvents');
    if (!el) return;

    const searchQ = (document.getElementById('browseSearch')?.value || '').toLowerCase().trim();

    // Temporarily intercept the first filter pass
    // We rebuild the filtered list here, then delegate rendering to eventCard()
    let evts = DB.events.filter(e => e.status === 'approved');

    if (browseFilter !== 'all') {
      evts = evts.filter(e => e.category === browseFilter);
    }

    if (searchQ) {
      evts = evts.filter(e =>
        e.title.toLowerCase().includes(searchQ) ||
        (e.desc || '').toLowerCase().includes(searchQ) ||
        (e.venue || '').toLowerCase().includes(searchQ) ||
        (e.category || '').toLowerCase().includes(searchQ)
      );
    }

    // Pre-compute cache (mirrors PATCH 006 logic from original)
    const eventDataCache = {};
    evts.forEach(e => {
      const cnt = regCount(e.id);
      const fbs = eventFeedbacks(e.id);
      const status = eventStatus(e);
      eventDataCache[e.id] = {
        regCount: cnt,
        isUserRegistered: isReg(e.id),
        feedbackCount: fbs.length,
        avgRating: fbs.length ? fbs.reduce((s, f) => s + f.rating, 0) / fbs.length : 0,
        userFeedback: status === 'past' ? userFeedback(e.id) : null,
        eventStatus: status
      };
    });

    const sort = document.getElementById('browseSort')?.value || 'date';
    if (sort === 'date')    evts.sort((a, b) => a.date.localeCompare(b.date));
    if (sort === 'name')    evts.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'popular') evts.sort((a, b) => eventDataCache[b.id].regCount - eventDataCache[a.id].regCount);
    if (sort === 'rating')  evts.sort((a, b) => eventDataCache[b.id].avgRating - eventDataCache[a.id].avgRating);

    el.innerHTML = evts.length
      ? evts.map(e => eventCard(e, eventDataCache[e.id])).join('')
      : `<div class="empty-state" style="grid-column:1/-1">
           <span class="ico">🔎</span>
           <h4>No events match</h4>
           <p>Try a different filter or search term.</p>
         </div>`;
  };
})();

/* ============================================================
   PATCH #3 — setOrgsPageTab(): IGNORES TAB PARAMETER
   ============================================================
   BROKEN CODE:
   ─────────────────────────────────────────────────────────────
     function setOrgsPageTab(t, el) {
       renderOrgsPage();   // ← `t` is completely ignored!
     }

   ROOT CAUSE:
     During the refactor that removed the Feed pane from the Orgs page,
     the developer deleted the tab-switching logic but left the function
     signature intact. Both tabs now trigger the same renderOrgsPage()
     call, so the tab bar appears to do nothing.
     (renderOrgsPage itself also hides the tab bar via display:none,
     which makes this doubly broken — but the underlying function
     still needs to correctly route.)

   FIX: Restore proper tab routing. Since Feed was intentionally removed,
        both tabs resolve to the Discover view — but `el` active-state
        toggling is restored so clicks feel responsive.

   TEST STEPS:
     1. Go to Organizations page.
     2. Tab bar should be hidden (renderOrgsPage hides it).
     3. If you temporarily re-enable it, clicking each tab should
        toggle the active class without breaking the page.
     4. goDiscoverOrgs() from sidebar should still work correctly.
   ============================================================ */
function setOrgsPageTab(t, el) {
  // Feed tab was intentionally removed in PATCH 007 refactor.
  // Both tabs now resolve to Discover. Preserve active-state
  // toggling so any future tab restoration works cleanly.
  document.querySelectorAll('#orgsBrowseTabs .tab').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');

  // orgsPageTab state kept in sync for any downstream consumers
  orgsPageTab = t || 'discover';

  renderOrgsPage();
}

/* ============================================================
   PATCH #5 — goBrowseEvents(): MISSING FUNCTION DEFINITION
   ============================================================
   BROKEN CODE:
   ─────────────────────────────────────────────────────────────
     <!-- in HTML -->
     <button class="btn btn-ghost" onclick="goBrowseEvents()">Browse Events</button>
     <!-- in dashboard -->
     <button class="btn btn-gold" onclick="goBrowseEvents()">Browse Events →</button>

     // In app.js: function goBrowseEvents is NEVER defined.
     // Every call throws: ReferenceError: goBrowseEvents is not defined

   ROOT CAUSE:
     The function was likely renamed to showPage('browse') inline during
     a refactor pass, but the HTML onclick handlers were never updated.
     The function stub was deleted without a global search-replace.

   FIX: Define the missing function as a simple alias.

   TEST STEPS:
     1. While logged OUT, click "Browse Events" on the hero section.
        → Should navigate to the Browse Events page.
     2. While logged IN as student, click "Browse Events →" on dashboard.
        → Same result.
     3. No console errors should appear.
   ============================================================ */
function goBrowseEvents() {
  showPage('browse');
}

/* ============================================================
   PATCH #6 — saveOrgEdit(): MISSING FUNCTION DEFINITION
   ============================================================
   BROKEN CODE:
   ─────────────────────────────────────────────────────────────
     <!-- in #orgEditModal -->
     <button class="btn btn-primary" onclick="saveOrgEdit()">Save Organization</button>

     // In app.js: saveOrgEdit() is never defined.
     // adminSaveOrg(oid) handles the admin flow,
     // but orgEditModal uses a different (now dead) function name.

   ROOT CAUSE:
     The orgEditModal appears to be legacy UI — it was likely replaced
     by adminOrgEditor() inline panel and orgPageSettingsModal for
     organizers. The modal HTML was left in index.html but its
     backing function was never ported.

   FIX: Define saveOrgEdit() to route correctly based on current user role.
        Admin → adminSaveOrg(); Organizer → saveOrgPageSettings().
        Also define the two missing file-reader helpers the modal needs.

   TEST STEPS:
     1. As admin, if orgEditModal is ever triggered, Save should not throw.
     2. As organizer, same.
     3. Console should show no "saveOrgEdit is not defined" errors.
   ============================================================ */
function saveOrgEdit() {
  // orgEditModal is legacy — route to the correct live handler
  // based on who is currently using it.
  const oid = document.getElementById('orgEditId')?.value;

  if (CU && CU.role === 'admin') {
    // Map legacy field IDs to adminSaveOrg expectations
    // adminSaveOrg reads: aoName, aoCat, aoDesc, aoUser, aoLogoData, aoLogoEmoji, aoCoverData
    // orgEditModal has:   orgEditName, orgEditCat, orgEditDesc, orgEditOrganizer, (logo fields)
    const nameEl = document.getElementById('orgEditName');
    const catEl  = document.getElementById('orgEditCat');
    const descEl = document.getElementById('orgEditDesc');
    const userEl = document.getElementById('orgEditOrganizer');

    // Temporarily alias the legacy IDs to what adminSaveOrg reads
    const _alias = (fromId, toId) => {
      const from = document.getElementById(fromId);
      let proxy = document.getElementById(toId);
      if (!proxy && from) {
        proxy = document.createElement('input');
        proxy.type = 'hidden';
        proxy.id   = toId;
        proxy.value = from.value;
        document.body.appendChild(proxy);
      } else if (proxy && from) {
        proxy.value = from.value;
      }
    };

    _alias('orgEditName',      'aoName');
    _alias('orgEditCat',       'aoCat');
    _alias('orgEditDesc',      'aoDesc');
    _alias('orgEditOrganizer', 'aoUser');

    // Ensure hidden data fields exist
    if (!document.getElementById('aoLogoData'))  {
      const h = document.createElement('input');
      h.type = 'hidden'; h.id = 'aoLogoData'; h.value = '';
      document.body.appendChild(h);
    }
    if (!document.getElementById('aoLogoEmoji')) {
      const emoji = document.getElementById('orgEditEmoji');
      const h = document.createElement('input');
      h.type = 'hidden'; h.id = 'aoLogoEmoji';
      h.value = emoji ? emoji.value : '🏢';
      document.body.appendChild(h);
    }
    if (!document.getElementById('aoCoverData')) {
      const h = document.createElement('input');
      h.type = 'hidden'; h.id = 'aoCoverData'; h.value = '';
      document.body.appendChild(h);
    }

    adminSaveOrg(oid || '');
    closeModal('orgEditModal');

  } else if (CU && CU.role === 'organizer') {
    // Route to organizer settings — requires opsOrgId to be set
    const o = ownedOrg();
    if (!o) return toast('No organization to edit', 'error');

    // Populate opsOrgId so saveOrgPageSettings works
    const opsId = document.getElementById('opsOrgId');
    if (opsId) opsId.value = o.id;

    // Map fields
    ['Name', 'Cat', 'Desc'].forEach(f => {
      const from = document.getElementById('orgEdit' + f);
      const to   = document.getElementById('ops' + f);
      if (from && to) to.value = from.value;
    });

    saveOrgPageSettings();
    closeModal('orgEditModal');
  } else {
    toast('You do not have permission to edit organizations', 'error');
  }
}

/* ============================================================
   PATCH #7 — handleOrgLogo() / handleOrgCover(): MISSING FUNCTIONS
   ============================================================
   BROKEN CODE:
   ─────────────────────────────────────────────────────────────
     <input type="file" id="orgEditLogoFile"  onchange="handleOrgLogo(event)">
     <input type="file" id="orgEditCoverFile" onchange="handleOrgCover(event)">

     // Neither function is defined anywhere in app.js.
     // Selecting a file throws: ReferenceError: handleOrgLogo is not defined

   ROOT CAUSE:
     These handlers were part of the legacy orgEditModal which was never
     fully ported to app.js. The readImg() / readImgTo() helpers exist
     but weren't wired to these specific IDs.

   FIX: Define both handlers using the existing readImgTo pattern.

   TEST STEPS:
     1. Open the orgEditModal (as admin or organizer).
     2. Click the logo file input and select an image.
        → Preview should appear in #orgLogoPreview.
     3. Click the cover file input and select an image.
        → Preview should appear in #orgCoverPreview.
     4. No console errors.
   ============================================================ */
function handleOrgLogo(event) {
  const f = event.target.files && event.target.files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) return toast('Logo too large (max 2MB)', 'error');
  const r = new FileReader();
  r.onload = e => {
    // Store in hidden field if it exists, otherwise create one
    let hidden = document.getElementById('orgEditLogoData');
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id   = 'orgEditLogoData';
      document.body.appendChild(hidden);
    }
    hidden.value = e.target.result;

    // Show preview
    const previewImg = document.getElementById('orgLogoPreviewImg');
    const previewDiv = document.getElementById('orgLogoPreview');
    if (previewImg) previewImg.src = e.target.result;
    if (previewDiv) previewDiv.style.display = 'block';
    toast('Logo attached');
  };
  r.readAsDataURL(f);
}

function handleOrgCover(event) {
  const f = event.target.files && event.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return toast('Cover photo too large (max 5MB)', 'error');
  const r = new FileReader();
  r.onload = e => {
    let hidden = document.getElementById('orgEditCoverData');
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id   = 'orgEditCoverData';
      document.body.appendChild(hidden);
    }
    hidden.value = e.target.result;

    const previewImg = document.getElementById('orgCoverPreviewImg');
    const previewDiv = document.getElementById('orgCoverPreview');
    if (previewImg) previewImg.src = e.target.result;
    if (previewDiv) previewDiv.style.display = 'block';
    toast('Cover photo attached');
  };
  r.readAsDataURL(f);
}

/* ============================================================
   INTEGRITY CHECK — Run on load to catch any remaining issues
   ============================================================ */
(function runIntegrityCheck() {
  const required = [
    'renderOrgsDiscover',
    'renderBrowseEvents',
    'setOrgsPageTab',
    'goBrowseEvents',
    'saveOrgEdit',
    'handleOrgLogo',
    'handleOrgCover',
    'toggleFollow',
    'openOrgProfile',
    'likePost',
    'addComment',
    'submitOrgPost',
    'deleteOrgPost',
    'openCertUpload',
    'markAttendance',
    'adminApprove',
    'adminReject',
  ];

  const missing = required.filter(fn => typeof window[fn] !== 'function');

  if (missing.length) {
    console.error('[CEMS PATCH] ⚠️  Still-missing functions after patch:', missing);
  } else {
    console.log('[CEMS PATCH] ✅ All patched functions verified. Patch applied successfully.');
  }
})();