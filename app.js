// app.js — Supabase-backed CEMS / CSU  (fixed + optimized build)
/* ============================================================
   1) SUPABASE CLIENT
   ============================================================ */
const SUPABASE_URL  = 'https://mifliemkipkxniiebdpe.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pZmxpZW1raXBreG5paWViZHBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDA2ODIsImV4cCI6MjA5NDY3NjY4Mn0.y3Yj2HLr6vhXuoZiXyCnrjia1FSJ6GzY1IpZ4uqp9hE';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ============================================================
   2) GLOBAL STATE
   ============================================================ */
const LS_KEY = 'cems_csu_v1';
let DB = {
  users: [], events: [], regs: [], announcements: [], feedbacks: [],
  organizations: [], organizationPosts: [], organizationFollows: [],
  attendance: {}, certificates: {}
};
let CU            = null;
let authMode      = 'login';
let homeFilter    = 'all';
let orgTab        = 'all';
let adminTab      = 'pending';
let editingEventId= null;
let browseFilter  = 'all';
let pendingFbEventId  = null;
let pendingFbRating   = 0;
let orgsPageTab   = 'all';
let viewingOrgId  = null;
let orgMainTab    = 'events';
let feedTab       = 'feed';

// post / upload state
let _pendingPostPhotos   = [];
let _pendingPostVideoData= null;
let _pendingPostOrgId    = null;
let pendingEventPhoto    = null;
let vsCurrentEventId     = null;
let certPendingUserId    = null;
let certPendingEventId   = null;
let pendingCertFile      = null;
let _editPostPhotos      = [];
let _lbUrls              = [];
let _lbIdx               = 0;
let _refreshTimer        = null;  // debounce for refreshAll

const _galleryState = {};

function uid(p = 'id') {
  return p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

/* ============================================================
   3) ROW <-> CACHE MAPPERS
   ============================================================ */
const mapEvent  = r => ({ id: r.id, title: r.title, desc: r.description, category: r.category,
  date: r.date, time: r.time, venue: r.venue, capacity: r.capacity, organizerId: r.organizer_id,
  status: r.status, icon: r.icon, img: r.img, photo: r.photo, featured: !!r.featured });
const unmapEvent = e => ({ id: e.id, title: e.title, description: e.desc || '', category: e.category,
  date: e.date, time: e.time, venue: e.venue, capacity: e.capacity, organizer_id: e.organizerId,
  status: e.status, icon: e.icon || '🎉', img: e.img || '', photo: e.photo || '', featured: !!e.featured });

const mapUser  = r => ({ id: r.id, name: r.name, email: r.email, role: r.role, dept: r.dept, sid: r.sid });
const unmapUser= u => ({ id: u.id, name: u.name, email: u.email, role: u.role, dept: u.dept || '', sid: u.sid || '' });

const mapReg   = r => ({ id: r.id, userId: r.user_id, eventId: r.event_id, date: r.date });
const unmapReg = r => ({ id: r.id, user_id: r.userId, event_id: r.eventId, date: r.date });

const mapFb    = r => ({ id: r.id, eventId: r.event_id, userId: r.user_id, rating: r.rating, comment: r.comment, date: r.date });
const unmapFb  = f => ({ id: f.id, event_id: f.eventId, user_id: f.userId, rating: f.rating, comment: f.comment, date: f.date });

const mapAnn   = r => ({ id: r.id, text: r.text, date: r.created_at });
const unmapAnn = a => ({ id: a.id, text: a.text, created_at: a.date || new Date().toISOString() });

const mapOrg   = r => ({ id: r.id, name: r.name, description: r.description, category: r.category,
  logo: r.logo, coverPhoto: r.cover_photo, organizerId: r.organizer_id,
  socialLinks: r.social_links || { facebook: '', instagram: '' }, createdDate: r.created_date });
const unmapOrg = o => ({ id: o.id, name: o.name, description: o.description || '', category: o.category || 'General',
  logo: o.logo || '🏢', cover_photo: o.coverPhoto || '', organizer_id: o.organizerId,
  social_links: o.socialLinks || { facebook: '', instagram: '' },
  created_date: o.createdDate || new Date().toISOString().slice(0, 10) });

const mapPost  = r => ({ id: r.id, organizationId: r.organization_id, type: r.type, content: r.content,
  mediaUrl: r.media_url, mediaUrls: r.media_urls || [], likes: r.likes || 0,
  likedBy: r.liked_by || [], comments: r.comments || [], createdAt: r.created_at, editedAt: r.edited_at });
const unmapPost= p => ({ id: p.id, organization_id: p.organizationId, type: p.type || 'text',
  content: p.content || '', media_url: p.mediaUrl || '', media_urls: p.mediaUrls || [],
  likes: p.likes || 0, liked_by: p.likedBy || [], comments: p.comments || [],
  created_at: p.createdAt || new Date().toISOString(), edited_at: p.editedAt || null });

const mapFollow = r => ({ userId: r.user_id, organizationId: r.organization_id });

/* ============================================================
   4) LOAD ALL DATA FROM SUPABASE
   ============================================================ */
async function loadDB() {
  try {
    const [u, e, r, f, a, att, cert, o, p, fol] = await Promise.all([
      sb.from('users').select('*'),
      sb.from('events').select('*'),
      sb.from('registrations').select('*'),
      sb.from('feedbacks').select('*'),
      sb.from('announcements').select('*').order('created_at', { ascending: false }),
      sb.from('attendance').select('*'),
      sb.from('certificates').select('*'),
      sb.from('organizations').select('*'),
      sb.from('organization_posts').select('*'),
      sb.from('organization_follows').select('*'),
    ]);
    DB.users               = (u.data   || []).map(mapUser);
    DB.events              = (e.data   || []).map(mapEvent);
    DB.regs                = (r.data   || []).map(mapReg);
    DB.feedbacks           = (f.data   || []).map(mapFb);
    DB.announcements       = (a.data   || []).map(mapAnn);
    DB.organizations       = (o.data   || []).map(mapOrg);
    DB.organizationPosts   = (p.data   || []).map(mapPost);
    DB.organizationFollows = (fol.data || []).map(mapFollow);
    DB.attendance = {};
    (att.data || []).forEach(x => { DB.attendance[x.event_id + '_' + x.user_id] = x.attended; });
    DB.certificates = {};
    (cert.data || []).forEach(x => {
      DB.certificates[x.event_id + '_' + x.user_id] = x.type === 'text'
        ? { type: 'text', content: x.content }
        : { type: 'file', name: x.name, data: x.data, mimeType: x.mime_type };
    });
  } catch (err) {
    console.error('CEMS: loadDB failed', err);
    toast('Failed to load data from server', 'error');
  }
  const savedId = localStorage.getItem('cems_cu');
  if (savedId) CU = DB.users.find(u => u.id === savedId) || null;
  if (CU) document.body.classList.add('logged-in');
}

function saveDB() { /* no-op — cloud backed */ }

/* ============================================================
   5) AUTH
   ============================================================ */
function openLogin(mode = 'login') {
  authMode = mode;
  renderAuthMode();
  document.getElementById('loginModal').classList.add('open');
}
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  renderAuthMode();
}
function renderAuthMode() {
  document.getElementById('authTitle').textContent  = authMode === 'login' ? 'Sign in to CEMS' : 'Create your CEMS account';
  document.getElementById('signupOnly').style.display = authMode === 'signup' ? 'block' : 'none';
  document.getElementById('authSubmitBtn').textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  document.getElementById('switchAuthTxt').textContent = authMode === 'login' ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('switchAuthLink').textContent = authMode === 'login' ? 'Sign up' : 'Sign in';
}

async function submitAuth() {
  const email = document.getElementById('auEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('auPass').value;
  if (!email || !pass) return toast('Please fill in all fields', 'error');

  if (authMode === 'login') {
    const { data, error } = await sb.from('users').select('*').eq('email', email).eq('password', pass).single();
    if (error || !data) return toast('Wrong email or password', 'error');
    CU = mapUser(data);
    localStorage.setItem('cems_cu', CU.id);
    closeModal('loginModal');
    toast(`Welcome back, ${CU.name}!`);
    document.body.classList.add('logged-in');
    renderNav();
    showPage(CU.role === 'admin' ? 'admin' : CU.role === 'organizer' ? 'organizer' : 'dashboard');
  } else {
    const name = document.getElementById('auFull').value.trim();
    const sid  = document.getElementById('auId').value.trim();
    const dept = document.getElementById('auDept').value;
    if (!name || !sid) return toast('Please complete all fields', 'error');
    const { data: exists } = await sb.from('users').select('id').eq('email', email).maybeSingle();
    if (exists) return toast('Email already registered', 'error');
    const newUser = { id: uid('u'), name, email, password: pass, role: 'student', dept, sid };
    const { error } = await sb.from('users').insert(newUser);
    if (error) return toast('Signup failed: ' + error.message, 'error');
    DB.users.push(mapUser(newUser));
    CU = mapUser(newUser);
    localStorage.setItem('cems_cu', CU.id);
    closeModal('loginModal');
    toast(`Welcome to CEMS, ${name}!`);
    document.body.classList.add('logged-in');
    renderNav();
    showPage('dashboard');
  }
}

function logout() {
  CU = null;
  localStorage.removeItem('cems_cu');
  closeMobileMenu();
  document.body.classList.remove('logged-in');
  renderNav();
  showPage('home');
  toast('Signed out');
}

/* ============================================================
   6) MUTATION FUNCTIONS
   ============================================================ */
async function register(eid) {
  if (!CU) return openLogin();
  if (CU.role !== 'student') return toast('Only students can register for events', 'error');
  const ev = DB.events.find(e => e.id === eid);
  if (!ev) return;
  if (eventStatus(ev) === 'past') return toast('This event has ended', 'error');
  if (isReg(eid)) return toast('Already registered', 'warning');
  if (regCount(eid) >= ev.capacity) return toast('Event is at full capacity', 'error');
  const row = { id: uid('r'), userId: CU.id, eventId: eid, date: new Date().toISOString() };
  const { error } = await sb.from('registrations').insert(unmapReg(row));
  if (error) { console.error('Registration insert error:', error); return toast(error.message, 'error'); }
  DB.regs.push(row);
  toast(`Registered for "${ev.title}"!`);
  debouncedRefresh();
}

async function unregister(eid) {
  if (!CU) return;
  const { error } = await sb.from('registrations').delete().eq('user_id', CU.id).eq('event_id', eid);
  if (error) return toast(error.message, 'error');
  DB.regs = DB.regs.filter(r => !(r.userId === CU.id && r.eventId === eid));
  toast('Registration cancelled');
  debouncedRefresh();
}

async function submitFeedback() {
  if (!pendingFbRating) return toast('Please select a star rating', 'error');
  const c = document.getElementById('fbComment').value.trim();
  if (c.length < 10) return toast('Review must be at least 10 characters', 'error');
  if (userFeedback(pendingFbEventId)) return toast('You already submitted feedback', 'warning');
  const row = { id: uid('f'), eventId: pendingFbEventId, userId: CU.id, rating: pendingFbRating, comment: c, date: new Date().toISOString() };
  const { error } = await sb.from('feedbacks').insert(unmapFb(row));
  if (error) return toast(error.message, 'error');
  DB.feedbacks.push(row);
  closeModal('feedbackModal');
  toast('Thanks for your feedback!');
  
  // PATCH 007 FIX: Only refresh event view if it's currently open
  // Don't do full refresh - feedback only affects event details page
  if (document.getElementById('page-event')?.classList.contains('active')) {
    viewEvent(pendingFbEventId);  // Re-render just the event details
  }
}

async function submitEventForm() {
  const title = document.getElementById('evTitle').value.trim();
  const desc  = document.getElementById('evDesc').value.trim();
  const cat   = document.getElementById('evCat').value;
  const cap   = parseInt(document.getElementById('evCap').value);
  const date  = document.getElementById('evDate').value;
  const time  = document.getElementById('evTime').value;
  const venue = document.getElementById('evVenue').value.trim();
  if (!title || !desc || !date || !time || !venue) return toast('Please fill all fields', 'error');
  if (cap < 1) return toast('Capacity must be at least 1', 'error');
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return toast('Event date cannot be in the past', 'error');

  if (editingEventId) {
    const e = DB.events.find(x => x.id === editingEventId);
    Object.assign(e, { title, desc, category: cat, capacity: cap, date, time, venue, status: 'pending', photo: pendingEventPhoto || null });
    const { error } = await sb.from('events').update(unmapEvent(e)).eq('id', e.id);
    if (error) return toast(error.message, 'error');
    toast('Event updated and resubmitted. It will appear after admin approval.');
  } else {
    const e = { id: uid('e'), title, desc, category: cat, capacity: cap, date, time, venue, organizerId: CU.id, status: 'pending', icon: '🎉', photo: pendingEventPhoto || null, featured: false };
    const { error } = await sb.from('events').insert(unmapEvent(e));
    if (error) return toast(error.message, 'error');
    DB.events.push(e);
    toast('Event submitted! It will appear on the Events page after admin approval.');
  }
  closeModal('eventModal');
  debouncedRefresh();
}

async function deleteEvent(eid) {
  if (!confirm('Delete this event? All registrations will be removed.')) return;
  const { error } = await sb.from('events').delete().eq('id', eid);
  if (error) return toast(error.message, 'error');
  DB.events = DB.events.filter(e => e.id !== eid);
  DB.regs   = DB.regs.filter(r => r.eventId !== eid);
  toast('Event deleted');
  debouncedRefresh();
}

async function markAttendance(eid, userIdArg, val) {
  const key = eid + '_' + userIdArg;
  DB.attendance[key] = val;
  const { error } = await sb.from('attendance').upsert({ event_id: eid, user_id: userIdArg, attended: val });
  if (error) return toast(error.message, 'error');
  renderViewStudents();
  toast(val ? 'Marked as attended' : 'Marked as absent');
}

async function markAllAttendance(eid, val) {
  const regs = DB.regs.filter(r => r.eventId === eid);
  const rows = regs.map(r => ({ event_id: eid, user_id: r.userId, attended: val }));
  regs.forEach(r => { DB.attendance[eid + '_' + r.userId] = val; });
  if (rows.length) {
    const { error } = await sb.from('attendance').upsert(rows);
    if (error) return toast(error.message, 'error');
  }
  renderViewStudents();
  toast(val ? 'All marked as attended' : 'All marked as absent');
}

async function saveCertificate() {
  const t = document.getElementById('certType').value;
  const key = certPendingEventId + '_' + certPendingUserId;
  let row;
  if (t === 'file') {
    if (!pendingCertFile) return toast('Please select a file', 'error');
    DB.certificates[key] = { type: 'file', name: pendingCertFile.name, data: pendingCertFile.data, mimeType: pendingCertFile.mimeType };
    row = { event_id: certPendingEventId, user_id: certPendingUserId, type: 'file', name: pendingCertFile.name, data: pendingCertFile.data, mime_type: pendingCertFile.mimeType, content: '' };
  } else {
    const txt = document.getElementById('certTextInput').value.trim();
    if (!txt) return toast('Please enter certificate text', 'error');
    DB.certificates[key] = { type: 'text', content: txt };
    row = { event_id: certPendingEventId, user_id: certPendingUserId, type: 'text', content: txt, name: '', data: '', mime_type: '' };
  }
  const { error } = await sb.from('certificates').upsert(row);
  if (error) return toast(error.message, 'error');
  closeModal('certUploadModal');
  toast('Certificate saved!');
  renderViewStudents();
}

async function toggleFeatured(eid) {
  const e = DB.events.find(x => x.id === eid);
  if (!e) return;
  e.featured = !e.featured;
  await sb.from('events').update({ featured: e.featured }).eq('id', eid);
  toast(e.featured ? 'Marked as featured' : 'Removed from featured');
  debouncedRefresh();
}

async function setUserRole(uidArg, role) {
  const u = DB.users.find(x => x.id === uidArg);
  if (!u || u.role === 'admin') return;
  u.role = role;
  await sb.from('users').update({ role }).eq('id', uidArg);
  toast(role === 'organizer' ? `${u.name} promoted to organizer` : `${u.name} demoted to student`);
  renderAdminTab();
}

async function adminApprove(eid) {
  const e = DB.events.find(x => x.id === eid);
  if (!e) return;
  e.status = 'approved';
  const { error } = await sb.from('events').update({ status: 'approved' }).eq('id', eid);
  if (error) return toast(error.message, 'error');
  toast('Event approved');
  debouncedRefresh();
  renderAdminDash();
}

async function adminReject(eid) {
  const e = DB.events.find(x => x.id === eid);
  if (!e) return;
  e.status = 'rejected';
  const { error } = await sb.from('events').update({ status: 'rejected' }).eq('id', eid);
  if (error) return toast(error.message, 'error');
  toast('Event rejected', 'warning');
  debouncedRefresh();
  renderAdminDash();
}

async function deleteUser(uidArg) {
  if (!confirm('Remove this user? Their registrations will be deleted.')) return;
  await sb.from('users').delete().eq('id', uidArg);
  DB.users = DB.users.filter(u => u.id !== uidArg);
  DB.regs  = DB.regs.filter(r => r.userId !== uidArg);
  toast('User removed');
  debouncedRefresh();
}

async function submitAnnouncement() {
  const v = document.getElementById('annInput').value.trim();
  if (!v) return toast('Please enter a message', 'error');
  document.getElementById('annText').textContent = v;
  document.getElementById('annBar').classList.remove('hidden');
  const row = { id: uid('a'), text: v, date: new Date().toISOString() };
  await sb.from('announcements').insert(unmapAnn(row));
  DB.announcements.unshift(row);
  closeModal('annModal');
  toast('Announcement published');
}

/* ----- ORGANIZATIONS ----- */
async function toggleFollow(oid) {
  if (!CU) return openLogin();
 
  const exists = (DB.organizationFollows || [])
    .some(f => f.userId === CU.id && f.organizationId === oid);
 
  if (exists) {
    await sb.from('organization_follows')
      .delete()
      .eq('user_id', CU.id)
      .eq('organization_id', oid);
    DB.organizationFollows = DB.organizationFollows
      .filter(f => !(f.userId === CU.id && f.organizationId === oid));
    toast('Unfollowed');
  } else {
    await sb.from('organization_follows')
      .insert({ user_id: CU.id, organization_id: oid });
    DB.organizationFollows.push({ userId: CU.id, organizationId: oid });
    toast('Following!');
  }
 
  // Re-render only the page that is currently visible
  const orgsPage   = document.getElementById('page-orgs');
  const orgProfile = document.getElementById('page-orgprofile');
  const homePage   = document.getElementById('page-home');
 
  if (orgsPage?.classList.contains('active'))   renderOrgsPage();
  if (orgProfile?.classList.contains('active')) renderOrgProfile();
  // On Home: only refresh the sidebar widget — cheaper than full renderHome()
  if (homePage?.classList.contains('active'))   renderFeedSidebar();
}

async function likePost(pid) {
  if (!CU) return openLogin();
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  p.likedBy = p.likedBy || [];
  const i = p.likedBy.indexOf(CU.id);
  if (i >= 0) { p.likedBy.splice(i, 1); p.likes = Math.max(0, (p.likes || 1) - 1); }
  else { p.likedBy.push(CU.id); p.likes = (p.likes || 0) + 1; }
  await sb.from('organization_posts').update({ likes: p.likes, liked_by: p.likedBy }).eq('id', pid);
  refreshPost(pid);
}

async function addComment(pid) {
  if (!CU) return openLogin();
  const inp = document.getElementById('cmt_' + pid);
  if (!inp) return;
  const txt = inp.value.trim();
  if (!txt) return;
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  p.comments = p.comments || [];
  p.comments.push({ id: uid('c'), userId: CU.id, userName: CU.name, text: txt, createdAt: new Date().toISOString() });
  await sb.from('organization_posts').update({ comments: p.comments }).eq('id', pid);
  inp.value = '';
  refreshPost(pid);
}

async function deleteComment(pid, cid) {
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  p.comments = (p.comments || []).filter(c => c.id !== cid);
  await sb.from('organization_posts').update({ comments: p.comments }).eq('id', pid);
  refreshPost(pid);
}

async function submitOrgPost(oid) {
  const ta    = document.getElementById('postTextInput_' + oid);
  const text  = (ta ? ta.value.trim() : '');
  const photos= [..._pendingPostPhotos];
  const video = _pendingPostVideoData;
  if (!text && !photos.length && !video) return toast('Add some content first', 'error');
  const type  = photos.length ? 'photo' : video ? 'video' : 'text';
  const post  = { id: uid('post'), organizationId: oid, type, content: text, mediaUrls: photos,
    mediaUrl: video || '', createdAt: new Date().toISOString(), likes: 0, likedBy: [], comments: [] };
  const { error } = await sb.from('organization_posts').insert(unmapPost(post));
  if (error) return toast(error.message, 'error');
  DB.organizationPosts.push(post);
  _pendingPostPhotos    = [];
  _pendingPostVideoData = null;
  if (ta) ta.value = '';
  // hide composer expanded section
  const expanded = document.getElementById('postComposerExpanded_' + oid);
  if (expanded) expanded.style.display = 'none';
  toast('Post published!');
  renderOrgMyOrgContent();
  
  // PATCH 007 FIX: Only refresh feed posts, not entire home page
  // Avoid full re-render which would re-render composer, sidebar, etc
  if (document.getElementById('page-home')?.classList.contains('active')) {
    renderFeedPosts();  // ✅ Just update feed posts
  }
}

async function deleteOrgPost(pid) {
  if (!confirm('Delete this post?')) return;
  await sb.from('organization_posts').delete().eq('id', pid);
  DB.organizationPosts = DB.organizationPosts.filter(p => p.id !== pid);
  toast('Post deleted');
  if (document.getElementById('page-orgprofile')?.classList.contains('active')) renderOrgProfile();
  else if (document.getElementById('page-home')?.classList.contains('active')) renderFeedPosts();
  else renderOrgMyOrgContent();
}

async function saveEditPost() {
  const modal = document.getElementById('editPostModal');
  if (!modal) return;
  const pid = modal.dataset.pid;
  const p   = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  const text = document.getElementById('editPostText').value.trim();
  if (!text && !_editPostPhotos.length) return toast('Post must have text or at least one image', 'error');
  p.content = text;
  if (_editPostPhotos.length) {
    p.mediaUrls = [..._editPostPhotos]; p.mediaUrl = _editPostPhotos[0]; p.type = 'photo';
  } else { p.mediaUrls = []; p.mediaUrl = ''; p.type = 'text'; }
  p.editedAt = new Date().toISOString();
  p._expanded = false;
  await sb.from('organization_posts').update(unmapPost(p)).eq('id', pid);
  closeModal('editPostModal');
  toast('Post updated!');
  refreshPost(pid);
  if (document.getElementById('page-home')?.classList.contains('active')) renderFeedPosts();
}

async function saveOrgPageSettings() {
  const oid  = document.getElementById('opsOrgId').value;
  const o    = getOrgById(oid);
  if (!o) return;
  const name = document.getElementById('opsName').value.trim();
  if (!name) return toast('Name is required', 'error');
  o.name        = name;
  o.category    = document.getElementById('opsCat').value;
  o.description = document.getElementById('opsDesc').value.trim();
  const logoData  = document.getElementById('opsLogoData').value;
  const logoEmoji = document.getElementById('opsEmoji').value.trim();
  if (logoData) o.logo = logoData;
  else if (logoEmoji) o.logo = logoEmoji;
  const cover = document.getElementById('opsCoverData').value;
  if (cover) o.coverPhoto = cover;
  o.socialLinks = {
    facebook:  document.getElementById('opsFb').value.trim(),
    instagram: document.getElementById('opsIg').value.trim()
  };
  await sb.from('organizations').update(unmapOrg(o)).eq('id', oid);
  closeModal('orgPageSettingsModal');
  toast('Page updated!');
  renderOrgMyOrgContent();
}

async function submitCreateOrg() {
  const name     = document.getElementById('coName').value.trim();
  const cat      = document.getElementById('coCat').value;
  const desc     = document.getElementById('coDesc').value.trim();
  const emoji    = document.getElementById('coEmoji').value.trim();
  const logoData = document.getElementById('coLogoData').value;
  const cover    = document.getElementById('coCoverData').value;
  if (!name) return toast('Please enter an organization name', 'error');
  if (ownedOrg()) return toast('You already have an organization page', 'warning');
  const logo = logoData || emoji || '🏢';
  const o = { id: uid('org'), name, description: desc, category: cat, organizerId: CU.id,
    logo, coverPhoto: cover, createdDate: new Date().toISOString().slice(0, 10),
    socialLinks: { facebook: '', instagram: '' } };
  const { error } = await sb.from('organizations').insert(unmapOrg(o));
  if (error) return toast(error.message, 'error');
  DB.organizations.push(o);
  closeModal('createOrgModal');
  toast('Organization page created!');
  renderOrganizerDash();
  setTimeout(() => {
    const t = document.querySelectorAll('#orgDashTabs .tab')[1];
    if (t) switchOrgMainTab('myorg', t);
  }, 100);
}

async function adminSaveOrg(oid) {
  const name   = document.getElementById('aoName').value.trim();
  const cat    = document.getElementById('aoCat').value;
  const desc   = document.getElementById('aoDesc').value.trim();
  const userId = document.getElementById('aoUser').value;
  const logoData  = document.getElementById('aoLogoData').value;
  const logoEmoji = document.getElementById('aoLogoEmoji').value.trim();
  const cover  = document.getElementById('aoCoverData').value;
  if (!name || !userId) return toast('Name and assigned user are required', 'error');
  const logo = logoData || logoEmoji || '🏢';
  if (oid) {
    const o = getOrgById(oid);
    if (!o) return;
    Object.assign(o, { name, category: cat, description: desc, organizerId: userId, logo, coverPhoto: cover || o.coverPhoto });
    await sb.from('organizations').update(unmapOrg(o)).eq('id', oid);
    toast('Organization updated');
  } else {
    const o = { id: uid('org'), name, description: desc, category: cat, organizerId: userId, logo,
      coverPhoto: cover, createdDate: new Date().toISOString().slice(0, 10),
      socialLinks: { facebook: '', instagram: '' } };
    await sb.from('organizations').insert(unmapOrg(o));
    DB.organizations.push(o);
    toast('Organization created');
  }
  const u = DB.users.find(x => x.id === userId);
  if (u && u.role === 'student') {
    u.role = 'organizer';
    await sb.from('users').update({ role: 'organizer' }).eq('id', userId);
    toast(`${u.name} promoted to organizer`);
  }
  renderAdminTab();
  renderAdminDash();
}

async function adminDeleteOrg(oid) {
  if (!confirm('Delete this organization and all its posts?')) return;
  await sb.from('organizations').delete().eq('id', oid);
  DB.organizations       = DB.organizations.filter(o => o.id !== oid);
  DB.organizationPosts   = DB.organizationPosts.filter(p => p.organizationId !== oid);
  DB.organizationFollows = DB.organizationFollows.filter(f => f.organizationId !== oid);
  toast('Organization deleted');
  renderAdminTab();
  renderAdminDash();
}

/* ============================================================
   7) HELPERS
   ============================================================ */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className   = 'toast-msg ' + type;
  t.textContent = msg;
  const c = document.getElementById('toast');
  if (!c) { console.log('[toast]', msg); return; }
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(120%)'; t.style.transition = 'all .3s'; setTimeout(() => t.remove(), 300); }, 3200);
}
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function eventStatus(ev) {
  if (!ev || !ev.date) return 'upcoming';

  // Slice to YYYY-MM-DD only — handles full ISO timestamps from Supabase
  const datePart = String(ev.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return 'upcoming';

  // Build today at local midnight — no string parsing, no UTC bleed
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Build event date at local midnight using numeric constructor
  // new Date(y, m-1, d) is always LOCAL time — safe for Manila UTC+8
  const [y, m, d] = datePart.split('-').map(Number);
  const eventMidnight = new Date(y, m - 1, d);

  if (eventMidnight < todayMidnight)  return 'past';
  if (eventMidnight.getTime() === todayMidnight.getTime()) return 'ongoing';
  return 'upcoming';
}

function regCount(eid)       { return DB.regs.filter(r => r.eventId === eid).length; }
function isReg(eid)          { return CU && DB.regs.find(r => r.userId === CU.id && r.eventId === eid); }
function eventFeedbacks(eid) { return DB.feedbacks.filter(f => f.eventId === eid); }
function avgRating(eid)      { const fs = eventFeedbacks(eid); if (!fs.length) return 0; return fs.reduce((s, f) => s + f.rating, 0) / fs.length; }
function userFeedback(eid)   { return CU && DB.feedbacks.find(f => f.eventId === eid && f.userId === CU.id); }
function orgPostCount(oid)   { return (DB.organizationPosts || []).filter(p => p.organizationId === oid).length; }
function orgFollowerCount(oid){ return (DB.organizationFollows || []).filter(f => f.organizationId === oid).length; }
function isFollowing(oid)    { return CU && (DB.organizationFollows || []).some(f => f.userId === CU.id && f.organizationId === oid); }
function getOrgById(oid)     { return (DB.organizations || []).find(o => o.id === oid); }
function ownedOrg()          { return CU ? (DB.organizations || []).find(o => o.organizerId === CU.id) : null; }

// FIX: getOrgPhotos was called in renderOrgProfile but never defined
function getOrgPhotos(oid) {
  const posts = (DB.organizationPosts || []).filter(p => p.organizationId === oid);
  const photos = [];
  posts.forEach(p => {
    if (Array.isArray(p.mediaUrls) && p.mediaUrls.length) {
      p.mediaUrls.forEach(url => photos.push({ mediaUrl: url, postId: p.id }));
    } else if (p.type === 'photo' && p.mediaUrl) {
      photos.push({ mediaUrl: p.mediaUrl, postId: p.id });
    }
  });
  return photos;
}

function starsHtml(rating, size) {
  const r = Math.round(rating);
  size = size || 14;
  let h = `<span class="stars" style="font-size:${size}px">`;
  for (let i = 1; i <= 5; i++) h += `<span class="st ${i <= r ? 'on' : ''}">★</span>`;
  h += '</span>';
  return h;
}
function ratingLine(eid) {
  const fs = eventFeedbacks(eid);
  if (!fs.length) return '';
  const avg = avgRating(eid);
  return `<div class="rating-line">${starsHtml(avg, 13)} ${avg.toFixed(1)} (${fs.length} review${fs.length === 1 ? '' : 's'})</div>`;
}
function formatDate(d) {
  const dt = new Date(d + 'T12:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function timeAgo(dateString) {
  if (!dateString) return '';
  const diff = Date.now() - new Date(dateString).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24);
  if (days < 7) return days + 'd ago';
  return formatDate(dateString.slice(0, 10));
}

function orgLogoHtml(o, size = 56) {
  const s = `width:${size}px;height:${size}px;border-radius:14px;background:var(--csu-green-soft);display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size * 0.55)}px;overflow:hidden;border:2px solid #fff;box-shadow:var(--shadow-sm);flex-shrink:0`;
  if (o.logo && o.logo.startsWith('data:')) return `<div style="${s}"><img src="${o.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:12px"></div>`;
  return `<div style="${s}">${escapeHtml(o.logo || '🏢')}</div>`;
}
function orgCoverStyle(o) {
  if (o.coverPhoto) return `background:linear-gradient(rgba(6,61,28,.45),rgba(6,61,28,.65)),url('${o.coverPhoto}') center/cover`;
  return 'background:var(--grad-hero)';
}

function readImgTo(input, targetId) {
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { document.getElementById(targetId).value = r.result; toast('Image attached'); };
  r.readAsDataURL(f);
}
function readImg(input, targetId) { readImgTo(input, targetId); }

// Debounced refresh — prevents multiple rapid re-renders
function debouncedRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => refreshAll(), 80);
}

let _renderInProgress = false;

function refreshAll() {
  if (_renderInProgress) return; // drop overlapping calls
  _renderInProgress = true;
 
  try {
    // Clear any stale discover state — discover lives on Orgs page now
    if (feedTab === 'discover') feedTab = 'feed';
 
    const active = document.querySelector('.page.active');
    if (!active) return;
 
    const id = active.id.replace('page-', '');
 
    // Map page IDs to their render functions — one entry each, no duplicates
    const renderMap = {
      home:       renderHome,
      browse:     renderBrowseEvents,
      dashboard:  renderStudentDash,
      organizer:  renderOrganizerDash,
      admin:      renderAdminDash,
      orgs:       renderOrgsPage,
      orgprofile: renderOrgProfile,
    };
 
    const fn = renderMap[id];
    if (fn) fn();
 
  } finally {
    // Always release the lock — even if a renderer throws
    _renderInProgress = false;
  }
}


/* ============================================================
   8) NAV
   ============================================================ */
function renderNav() {
  const el      = document.getElementById('navActions');
  const existing = document.getElementById('navHamburgerBtn');
  if (existing) existing.remove();
 
  if (!CU) {
    el.innerHTML = `
      <button class="nav-link" onclick="showPage('home')">Home</button>
      <button class="btn btn-ghost" onclick="openLogin('login')">Sign In</button>
      <button class="btn btn-primary" onclick="openLogin('signup')">Sign Up</button>
    `;
    return;
  }
 
  const init      = CU.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  const dashPage  = CU.role === 'admin'     ? 'admin'
                  : CU.role === 'organizer' ? 'organizer'
                  : 'dashboard';
  const dashLabel = CU.role === 'admin'     ? 'Admin'
                  : CU.role === 'organizer' ? 'Organizer'
                  : 'Dashboard';
 
  el.innerHTML = `
    <button class="nav-link" onclick="showPage('home')">Home</button>
    <button class="nav-link" onclick="showPage('browse')">Events</button>
    <button class="nav-link" onclick="showPage('orgs')">Organizations</button>
    <button class="nav-link" onclick="showPage('${dashPage}')">${dashLabel}</button>
    <span class="role-badge ${CU.role}">${CU.role}</span>
    <div class="user-menu-wrap">
      <div class="user-avatar" onclick="toggleUserMenu()">${init}</div>
      <div class="user-dropdown" id="userDrop">
        <div class="user-dropdown-head">
          <div class="user-dropdown-name">${escapeHtml(CU.name)}</div>
          <div class="user-dropdown-email">${escapeHtml(CU.email)}</div>
        </div>
        <div class="user-dropdown-item"
             onclick="showPage('${dashPage}');toggleUserMenu()">
          📊 ${dashLabel}
        </div>
        <div class="user-dropdown-divider"></div>
        <div class="user-dropdown-item"
             onclick="logout()"
             style="color:var(--danger)">🚪 Sign Out</div>
      </div>
    </div>
  `;
 
  // Hamburger injected into <nav> — only for logged-in users
  const nav = document.querySelector('nav');
  const btn = document.createElement('button');
  btn.id        = 'navHamburgerBtn';
  btn.className = 'nav-mobile-toggle';
  btn.setAttribute('aria-label', 'Open menu');
  btn.innerHTML = '☰';
  btn.onclick   = openMobileMenu;
  nav.appendChild(btn);
}
function toggleUserMenu() {
  document.getElementById('userDrop')?.classList.toggle('open');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.user-menu-wrap')) { document.getElementById('userDrop')?.classList.remove('open'); }
  if (!e.target.closest('.nav-search'))     { document.getElementById('searchDrop')?.classList.remove('show'); }
  if (e.target.id === 'mobileMenuOverlay')  { closeMobileMenu(); }
});
document.addEventListener('click', e => { if (e.target.classList.contains('modal')) e.target.classList.remove('open'); });

/* ============================================================
   9) PAGE ROUTING
   ============================================================ */
function userHasAccess(p) {
  if (!CU) return ['home', 'browse', 'event'].includes(p);
  if (p === 'dashboard')  return CU.role === 'student';
  if (p === 'organizer')  return CU.role === 'organizer';
  if (p === 'admin')      return CU.role === 'admin';
  if (p === 'orgs' || p === 'orgprofile') return !!CU;
  return true;
}

function showPage(p) {
  if (p === 'dashboard' && (!CU || CU.role !== 'student'))   { openLogin(); return; }
  if (p === 'organizer' && (!CU || CU.role !== 'organizer')) { openLogin(); return; }
  if (p === 'admin'     && (!CU || CU.role !== 'admin'))     { openLogin(); return; }
  if ((p === 'orgs' || p === 'orgprofile') && !CU)           { openLogin(); return; }

  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  const pg = document.getElementById('page-' + p);
  if (pg) pg.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  localStorage.setItem('cems_current_page', p);

  // FIX A: Browse page re-fetches from Supabase before rendering
  // so newly approved events appear immediately without waiting for the 30s poll.
  // All other pages render from the existing in-memory DB (unchanged behavior).
  if (p === 'browse') {
    loadDB().then(() => renderBrowseEvents());
    return;
  }

// Cancel any pending debounced refresh — the showPage render covers it
// Cancel any pending debounced refresh before rendering the new page
  // This prevents a race where debouncedRefresh fires mid-render
  clearTimeout(_refreshTimer);

  if (p === 'home')       renderHome();
  if (p === 'dashboard')  renderStudentDash();
  if (p === 'organizer')  renderOrganizerDash();
  if (p === 'admin')      renderAdminDash();
  if (p === 'orgs')       renderOrgsPage();
  if (p === 'orgprofile') renderOrgProfile();
}

/* ============================================================
   10) HOME / FEED
   ============================================================ */
function renderHome() {
  const publicDiv = document.getElementById('home-public');
  const feedDiv   = document.getElementById('home-feed');
  if (!publicDiv || !feedDiv) return;
 
  if (!CU) {
    // ── Logged-out: show public landing, hide feed ──────────────
    publicDiv.style.display = '';
    feedDiv.style.display   = 'none';
    renderFeatured();
    renderHomeEvents();
    renderPastEvents();
    return; // ← explicit early return; no feed code runs
  }
 
  // ── Logged-in: show feed, hide public landing ────────────────
  publicDiv.style.display = 'none';
  feedDiv.style.display   = '';
 
  // Reset stale discover state — discover now lives on Orgs page
  if (feedTab === 'discover') feedTab = 'feed';
 
document.getElementById('feedGreetName').textContent =
    CU.name.split(' ')[0];
 
  renderFeedComposer();
  renderFeedPosts();
  renderFeedSidebar();
  
  // PATCH 002 FIX: Patch AFTER all renders so fresh HTML is patched
  _patchFeedTabBar();
}
function _patchFeedTabBar() {
  const tabBar = document.getElementById('feedTabs');
  if (!tabBar) return;
  
  // PATCH 002 FIX: Re-patch on every render instead of once
  // The guard prevented re-patching new HTML elements
  const tabs = Array.from(tabBar.querySelectorAll('.tab'));
  tabs.forEach(tab => {
    // Check if this tab is the discover/browse tab
    const text = tab.textContent.toLowerCase();
    if (text.includes('discover') || text.includes('browse') || text.includes('organization')) {
      // Remove old handler if any
      tab.onclick = null;
      
      // Attach fresh handler
      tab.onclick = function (e) {
        e.preventDefault();
        // Don't manipulate active states - goDiscoverOrgs handles page transition
        goDiscoverOrgs();
      };
      
      // Update label for clarity
      tab.textContent = '🏢 Browse Organizations';
      tab.title       = 'Go to the Organizations page';
    }
  });
}
 

function renderFeatured() {
  const el   = document.getElementById('featuredStrip');
  if (!el) return;
  const evts = DB.events.filter(e => e.status === 'approved' && e.featured).slice(0, 4);
  if (!evts.length) {
    el.innerHTML = '<div class="featured-empty">No featured events yet.</div>';
    return;
  }
  el.innerHTML = evts.map(e => `
    <div class="featured-card" onclick="viewEvent('${e.id}')">
      <div class="ph">${e.photo ? `<img src="${e.photo}" alt="">` : (e.icon || '🎉')}<span class="star">⭐ Featured</span></div>
      <div class="body"><h4>${escapeHtml(e.title)}</h4><div class="m">📅 ${formatDate(e.date)} · 📍 ${escapeHtml(e.venue)}</div></div>
    </div>`).join('');
}

function renderHomeEvents() {
  const el = document.getElementById('homeEvents');
  if (!el) return;

  // Clear first — prevents stale content from previous render
  el.innerHTML = '';

  // STRICT filter: upcoming = today OR future only (ongoing included)
  const evts = DB.events
    .filter(e => {
      if (e.status !== 'approved') return false;
      const s = eventStatus(e);
      return s === 'upcoming' || s === 'ongoing';
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  el.innerHTML = evts.length
    ? evts.map(e => eventCard(e)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><span class="ico">📭</span><h4>No upcoming events</h4><p>Check back soon.</p></div>';

  const ctaEl = document.getElementById('homeSignInCta');
  if (ctaEl) ctaEl.style.display = 'block';
}

function renderPastEvents() {
  const el = document.getElementById('pastEvents');
  if (!el) return;

  // Clear first — prevents stale content from previous render
  el.innerHTML = '';

  // STRICT filter: past = only events where date < today, nothing else
  const evts = DB.events
    .filter(e => {
      if (e.status !== 'approved') return false;
      return eventStatus(e) === 'past';
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  el.innerHTML = evts.length
    ? evts.map(e => eventCard(e)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><span class="ico">📜</span><h4>No past events</h4></div>';
}

function renderFeedComposer() {
  const wrap = document.getElementById('feedComposer');
  if (!wrap) return;
  const o = ownedOrg();
  if (!CU || CU.role === 'student' || !o) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const init = CU.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  wrap.innerHTML = `<div class="fb-composer">
    <div class="fb-composer-row">
      <div class="fb-composer-avatar">${init}</div>
      <div class="fb-composer-input" style="cursor:text;user-select:none" onclick="openOrgPostModal('${o.id}')">
        What's happening at ${escapeHtml(o.name)}?
      </div>
    </div>
    <div class="fb-composer-btns">
      <button class="fb-composer-btn" onclick="openOrgPostModal('${o.id}')">📸 Photo/Video</button>
      <button class="fb-composer-btn" onclick="openOrgPostModal('${o.id}')">📝 Post Update</button>
    </div>
  </div>`;
}

function setFeedTab(t, el) {
  if (t === 'discover') {
    // Navigate away — do not render inline
    goDiscoverOrgs();
    return;
  }
 
  feedTab = t;
  window._feedDiscoverQuery = '';
 
  document.querySelectorAll('#feedTabs .tab').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');
 
  renderFeedPosts();
}

function renderFeedPosts() {
  const wrap = document.getElementById('feedPostsWrap');
  if (!wrap) return;
 
  // Safety: reset stale discover state before any render
  if (feedTab === 'discover') feedTab = 'feed';
 
  // Clear before write — prevents any innerHTML += accumulation
  wrap.innerHTML = '';
 
  const posts = (DB.organizationPosts || [])
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 30);
 
  if (!posts.length) {
    wrap.innerHTML = `
      <div class="empty-state"
           style="background:#fff;border:1px solid var(--border);
                  border-radius:16px;padding:48px 24px">
        <span class="ico">📭</span>
        <h4>No posts yet</h4>
        <p>Organizations haven't posted anything yet.</p>
      </div>`;
    return;
  }
 
  const getIsOwner = p => {
    const o = getOrgById(p.organizationId);
    return CU && o && o.organizerId === CU.id;
  };
 
  // Single assignment — no duplication possible
  wrap.innerHTML = posts.map(p => renderFbPostHtml(p, getIsOwner(p))).join('');
}

function renderFeedSidebar() {
 
  // ── Upcoming events widget ───────────────────────────────────
  const evEl = document.getElementById('feedUpcomingEvents');
  if (evEl) {
    const upcoming = DB.events
      .filter(e => e.status === 'approved' && eventStatus(e) !== 'past')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4);
 
    if (!upcoming.length) {
      evEl.innerHTML = `
        <div style="padding:16px;color:var(--text-muted);font-size:13px">
          No upcoming events.
        </div>`;
    } else {
      evEl.innerHTML =
        upcoming.map(e => `
          <div onclick="viewEvent('${e.id}')" class="sidebar-event-row">
            <div class="sidebar-event-icon">${e.icon || '🎉'}</div>
            <div style="min-width:0">
              <div style="font-weight:600;font-size:13px;color:var(--csu-green-dark);
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${escapeHtml(e.title)}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                📅 ${formatDate(e.date)}
              </div>
            </div>
          </div>`).join('') +
        `<div style="padding:10px 18px">
           <button class="btn btn-outline btn-sm"
                   onclick="showPage('browse')"
                   style="width:100%;justify-content:center">
             View All Events →
           </button>
         </div>`;
    }
  }
 
  // ── Suggested organizations widget ──────────────────────────
  const orgEl = document.getElementById('feedSuggestedOrgs');
  if (orgEl) {
    const orgs = (DB.organizations || []).slice(0, 5);
 
    if (!orgs.length) {
      orgEl.innerHTML = `
        <div style="color:var(--text-muted);font-size:13px">
          No organizations yet.
        </div>`;
    } else {
      orgEl.innerHTML =
        orgs.map(o => {
          const following = isFollowing(o.id);
          const isOwn     = CU && CU.id === o.organizerId;
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;
                        border-bottom:1px solid var(--border)">
              <div onclick="openOrgProfile('${o.id}')"
                   style="cursor:pointer;flex-shrink:0">
                ${orgLogoHtml(o, 38)}
              </div>
              <div onclick="openOrgProfile('${o.id}')"
                   style="flex:1;min-width:0;cursor:pointer">
                <div style="font-weight:600;font-size:13px;color:var(--csu-green-dark);
                             overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${escapeHtml(o.name)}
                </div>
                <div style="font-size:11px;color:var(--text-muted)">
                  ${orgFollowerCount(o.id)} followers
                </div>
              </div>
              ${isOwn
                ? `<span style="font-size:10px;color:var(--csu-green-dark);
                               font-weight:700">Your Org</span>`
                : `<button class="btn btn-sm ${following ? 'btn-outline' : 'btn-primary'}"
                           style="font-size:11px;padding:4px 10px"
                           onclick="toggleFollow('${o.id}')">
                     ${following ? '✓' : '+'}
                   </button>`
              }
            </div>`;
        }).join('') +
        /* ← navigates to Orgs page (Discover pane) */
        `<div style="margin-top:10px">
           <button class="btn btn-outline btn-sm"
                   onclick="goDiscoverOrgs()"
                   style="width:100%;justify-content:center">
             All Organizations →
           </button>
         </div>`;
    }
  }
}

/* ============================================================
   11) BROWSE EVENTS
   ============================================================ */
function goDiscoverOrgs() {
  orgsPageTab = 'discover';
  showPage('orgs');
}
function setBrowseFilter(c, el) {
  browseFilter = c;
  document.querySelectorAll('#browseFilters .filter-chip').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');
  renderBrowseEvents();
}

/* ============================================================
   11) BROWSE EVENTS  (refactored — splits Upcoming vs Past)
   ============================================================ */

// Reusable sort helper — called once per render, not scattered inline
function _sortEvents(evts, sort, cache) {
  switch (sort) {
    case 'popular': return evts.slice().sort((a, b) => cache[b.id].regCount - cache[a.id].regCount);
    case 'rating':  return evts.slice().sort((a, b) => cache[b.id].avgRating - cache[a.id].avgRating);
    case 'name':    return evts.slice().sort((a, b) => a.title.localeCompare(b.title));
    default:        return evts.slice().sort((a, b) => a.date.localeCompare(b.date)); // date asc
  }
}

function renderBrowseEvents() {
  const upcomingEl = document.getElementById('browseUpcoming');
  const pastEl     = document.getElementById('browsePast');
  const upHead     = document.getElementById('browseUpcomingHead');
  const pastHead   = document.getElementById('browsePastHead');
  const upCount    = document.getElementById('browseUpcomingCount');
  const pastCount  = document.getElementById('browsePastCount');
  if (!upcomingEl || !pastEl) return;

  // ── 1. Filter by category ──────────────────────────────────
  let evts = DB.events.filter(e => e.status === 'approved');
  if (browseFilter !== 'all') evts = evts.filter(e => e.category === browseFilter);

  // ── 2. Filter by search (was dead before — now active) ─────
  const q = (document.getElementById('browseSearch')?.value || '').toLowerCase().trim();
  if (q) {
    evts = evts.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.desc  || '').toLowerCase().includes(q) ||
      (e.venue || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q)
    );
  }

  // ── 3. Pre-compute cache once (reuses existing helpers) ────
  const cache = {};
  evts.forEach(e => {
    const fbs    = eventFeedbacks(e.id);   // existing helper — untouched
    const status = eventStatus(e);          // existing helper — untouched
    cache[e.id] = {
      regCount:         regCount(e.id),     // existing helper — untouched
      isUserRegistered: isReg(e.id),        // existing helper — untouched
      feedbackCount:    fbs.length,
      avgRating:        fbs.length ? fbs.reduce((s, f) => s + f.rating, 0) / fbs.length : 0,
      userFeedback:     status === 'past' ? userFeedback(e.id) : null,
      eventStatus:      status
    };
  });

  // ── 4. Split into Upcoming/Ongoing vs Past ─────────────────
  //    ongoing events surface ABOVE upcoming (they're "now")
  const upcoming = evts.filter(e => cache[e.id].eventStatus !== 'past');
  const past     = evts.filter(e => cache[e.id].eventStatus === 'past');

  // ── 5. Apply sort ──────────────────────────────────────────
  const sort = document.getElementById('browseSort')?.value || 'date';

  // Upcoming: sort asc by date (nearest first); ongoing always < upcoming
  let sortedUpcoming = _sortEvents(upcoming, sort, cache);
  if (sort === 'date') {
    // Priority: ongoing first, then upcoming by nearest date
    sortedUpcoming = [
      ...upcoming.filter(e => cache[e.id].eventStatus === 'ongoing')
                 .sort((a, b) => a.date.localeCompare(b.date)),
      ...upcoming.filter(e => cache[e.id].eventStatus === 'upcoming')
                 .sort((a, b) => a.date.localeCompare(b.date))
    ];
  }

  // Past: always sort desc by date (most recently ended first)
  const sortedPast = sort === 'date'
    ? past.slice().sort((a, b) => b.date.localeCompare(a.date))
    : _sortEvents(past, sort, cache);

  // ── 6. Render — reuses existing eventCard() unchanged ──────
  const emptyUpcoming = `
    <div class="empty-state" style="grid-column:1/-1">
      <span class="ico">📭</span>
      <h4>No upcoming events</h4>
      <p>${q ? 'Try a different search term or category.' : 'Check back soon.'}</p>
    </div>`;

  const emptyPast = `
    <div class="empty-state" style="grid-column:1/-1">
      <span class="ico">📜</span>
      <h4>No past events</h4>
    </div>`;

 upcomingEl.innerHTML = sortedUpcoming.length
    ? sortedUpcoming.map(e => eventCardRow(e, cache[e.id])).join('')
    : emptyUpcoming;

  pastEl.innerHTML = sortedPast.length
    ? sortedPast.map(e => eventCardRow(e, cache[e.id])).join('')
    : emptyPast;

  // ── 7. Update section counts + visibility ─────────────────
  if (upCount)  upCount.textContent  = sortedUpcoming.length ? `(${sortedUpcoming.length})` : '';
  if (pastCount) pastCount.textContent = sortedPast.length ? `(${sortedPast.length})` : '';

 // Respect whichever tab is currently active
  const activeTab  = document.querySelector('.ecr-section-tab.active');
  const showingPast = activeTab && activeTab.textContent.includes('Past');

  if (showingPast) {
    if (upHead)     upHead.style.display     = 'none';
    if (upcomingEl) upcomingEl.style.display = 'none';
    if (pastHead)   pastHead.style.display   = (sortedPast.length || q) ? 'flex' : 'none';
    if (pastEl)     pastEl.style.display     = (sortedPast.length || q) ? 'flex' : 'none';
  } else {
    if (upHead)     upHead.style.display     = 'flex';
    if (upcomingEl) upcomingEl.style.display = 'flex';
    if (pastHead)   pastHead.style.display   = 'none';
    if (pastEl)     pastEl.style.display     = 'none';
  }
}
/* ============================================================
   BROWSE PAGE — horizontal card variant (browse page only)
   eventCard() is untouched — used on home/dashboard
   ============================================================ */
function _daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d     = new Date(dateStr + 'T12:00');
  const diff  = Math.round((d - today) / 86400000);
  return diff;
}

function _timeBadge(e, status) {
  if (status === 'ongoing') {
    return `<span class="ec-time-badge ec-badge-ongoing">🟢 Today</span>`;
  }
  if (status === 'past') {
    return `<span class="ec-time-badge ec-badge-past">🕐 Ended</span>`;
  }
  const days = _daysUntil(e.date);
  if (days === 0)  return `<span class="ec-time-badge ec-badge-soon">📅 Today</span>`;
  if (days === 1)  return `<span class="ec-time-badge ec-badge-soon">📅 Tomorrow</span>`;
  if (days <= 7)   return `<span class="ec-time-badge ec-badge-week">📅 In ${days} days</span>`;
  if (days <= 30)  return `<span class="ec-time-badge ec-badge-month">📅 In ${Math.ceil(days/7)} weeks</span>`;
  return `<span class="ec-time-badge ec-badge-far">📅 ${formatDate(e.date)}</span>`;
}

function eventCardRow(e, _cache) {
  const cache     = _cache || {};
  const cnt       = cache.regCount      !== undefined ? cache.regCount      : regCount(e.id);
  const status    = cache.eventStatus   !== undefined ? cache.eventStatus   : eventStatus(e);
  const ufb       = cache.userFeedback  !== undefined ? cache.userFeedback  : (status === 'past' ? userFeedback(e.id) : null);
  const isUserReg = cache.isUserRegistered !== undefined ? cache.isUserRegistered : isReg(e.id);
  const avgRat    = cache.avgRating     !== undefined ? cache.avgRating     : (() => {
    const fbs = eventFeedbacks(e.id);
    return fbs.length ? fbs.reduce((s,f) => s + f.rating, 0) / fbs.length : 0;
  })();

  // Image: photo if set, else gradient + emoji
  const imgHtml = e.photo
    ? `<img src="${e.photo}" alt="${escapeHtml(e.title)}" class="ecr-img">`
    : `<div class="ecr-img ecr-img-placeholder" data-icon="${e.icon || '🎉'}">${e.icon || '🎉'}</div>`;

  // Action button (right side)
  let actionBtn;
  if (status === 'past') {
    if (CU && CU.role === 'student' && isUserReg) {
      actionBtn = ufb
        ? `<button class="btn btn-outline btn-sm ecr-btn" disabled>Rated ${ufb.rating}★</button>`
        : `<button class="btn btn-gold btn-sm ecr-btn" onclick="event.stopPropagation();openFeedback('${e.id}')">⭐ Feedback</button>`;
    } else {
      actionBtn = `<button class="btn btn-outline btn-sm ecr-btn" onclick="event.stopPropagation();viewEvent('${e.id}')">View Details</button>`;
    }
  } else if (isUserReg) {
    actionBtn = `<button class="btn btn-outline btn-sm ecr-btn" onclick="event.stopPropagation();unregister('${e.id}')">Unregister</button>`;
  } else {
    actionBtn = `<button class="btn btn-primary btn-sm ecr-btn" onclick="event.stopPropagation();register('${e.id}')">Register</button>`;
  }

  // Rating display (only if there are reviews)
  const ratingHtml = (cache.feedbackCount > 0 && avgRat > 0)
    ? `<span class="ecr-rating">${starsHtml(avgRat, 12)} ${avgRat.toFixed(1)}</span>`
    : '';

  return `
  <div class="ecr-card" onclick="viewEvent('${e.id}')">
    <div class="ecr-image-wrap">
      ${imgHtml}
    </div>
    <div class="ecr-body">
      <div class="ecr-top">
        ${_timeBadge(e, status)}
        ${ratingHtml}
      </div>
      <div class="ecr-title">${escapeHtml(e.title)}</div>
      <div class="ecr-meta">
        <span class="ecr-cat-pill">${escapeHtml(e.category)}</span>
        <span class="ecr-meta-item">📍 ${escapeHtml(e.venue)}</span>
        <span class="ecr-meta-item">👥 ${cnt} going</span>
      </div>
      <div class="ecr-date">📅 ${formatDate(e.date)} · ${e.time}</div>
    </div>
    <div class="ecr-action" onclick="event.stopPropagation()">
      ${actionBtn}
    </div>
  </div>`;
}

function eventCard(e, _cache) {
  // PATCH 006 FIX: Use pre-computed cache if available
  const cache = _cache || {};
  
  const cnt  = cache.regCount !== undefined ? cache.regCount : regCount(e.id);
  const pct  = Math.min(100, Math.round(cnt / e.capacity * 100));
  const status = cache.eventStatus !== undefined ? cache.eventStatus : eventStatus(e);
  const ufb  = cache.userFeedback !== undefined ? cache.userFeedback : (status === 'past' ? userFeedback(e.id) : null);
  const isUserReg = cache.isUserRegistered !== undefined ? cache.isUserRegistered : isReg(e.id);
  
  let pastBtn = '<button class="btn btn-outline btn-sm" disabled>Ended</button>';
  if (status === 'past' && CU && CU.role === 'student' && isUserReg) {
    pastBtn = ufb
      ? `<button class="btn btn-outline btn-sm" disabled>You rated ${ufb.rating}★</button>`
      : `<button class="btn btn-gold btn-sm" onclick="event.stopPropagation();openFeedback('${e.id}')">⭐ Leave Feedback</button>`;
  }
  
  // Use cached rating data
  const avgRating = cache.avgRating !== undefined ? cache.avgRating : (() => {
    const fbs = eventFeedbacks(e.id);
    return fbs.length ? fbs.reduce((s, f) => s + f.rating, 0) / fbs.length : 0;
  })();
  
  return `<div class="event-card" onclick="viewEvent('${e.id}')">
    <div class="event-img ${e.img || ''} ${e.photo ? 'has-photo' : ''}">${e.photo ? `<img src="${e.photo}" alt="${escapeHtml(e.title)}">` : (e.icon || '🎉')}
      <span class="event-cat-badge">${e.category}</span>
      <span class="event-status-badge evt-status-${status}">${status}</span>
    </div>
    <div class="event-body">
      <div class="event-title">${escapeHtml(e.title)}</div>
      <div class="event-desc">${escapeHtml(e.desc)}</div>
      ${cache.feedbackCount !== undefined && cache.feedbackCount > 0 ? ratingLine(e.id) : ''}
      <div class="event-meta">
        <div class="event-meta-row"><span class="ico">📅</span>${formatDate(e.date)} · ${e.time}</div>
        <div class="event-meta-row"><span class="ico">📍</span>${escapeHtml(e.venue)}</div>
        <div class="event-meta-row"><span class="ico">👥</span>${cnt} / ${e.capacity} registered</div>
      </div>
      <div class="event-progress"><div class="event-progress-bar" style="width:${pct}%"></div></div>
      <div class="event-actions">
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();viewEvent('${e.id}')">Details</button>
        ${status === 'past' ? pastBtn
          : isUserReg
            ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();unregister('${e.id}')">Unregister</button>`
            : `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();register('${e.id}')">Register</button>`}
      </div>
    </div>
  </div>`;
}

function viewEvent(eid) {
  const e = DB.events.find(x => x.id === eid);
  if (!e) return;
  const org    = DB.users.find(u => u.id === e.organizerId);
  const cnt    = regCount(eid);
  const pct    = Math.min(100, Math.round(cnt / e.capacity * 100));
  const status = eventStatus(e);
  const fbs    = eventFeedbacks(eid);
  const avg    = avgRating(eid);
  const ufb    = userFeedback(eid);
  const showFbSummary = CU && (CU.role === 'admin' || CU.id === e.organizerId);
  let actionBtn;
  if (status === 'past') {
    if (CU && CU.role === 'student' && isReg(eid)) {
      actionBtn = ufb
        ? `<button class="btn btn-outline" disabled>You rated ${ufb.rating}★</button>`
        : `<button class="btn btn-gold" onclick="openFeedback('${eid}')">⭐ Leave Feedback</button>`;
    } else { actionBtn = '<button class="btn btn-outline" disabled>Event Ended</button>'; }
  } else {
    actionBtn = isReg(eid)
      ? `<button class="btn btn-outline" onclick="unregister('${eid}');viewEvent('${eid}')">Unregister</button>`
      : `<button class="btn btn-primary" onclick="register('${eid}');viewEvent('${eid}')">🎟️ Register Now</button>`;
  }
  document.getElementById('eventDetailsBody').innerHTML = `
    <div class="panel">
      <div class="event-img ${e.img || ''} ${e.photo ? 'has-photo' : ''}" style="height:280px;border-radius:16px 16px 0 0;font-size:96px">
        ${e.photo ? `<img src="${e.photo}" alt="${escapeHtml(e.title)}">` : (e.icon || '🎉')}
        <span class="event-cat-badge">${e.category}</span>
        <span class="event-status-badge evt-status-${status}">${status}</span>
      </div>
      <div class="panel-body">
        <h1 class="serif" style="font-size:clamp(24px,4vw,36px);color:var(--csu-green-dark);margin-bottom:12px">${escapeHtml(e.title)}</h1>
        ${fbs.length ? `<div class="rating-line" style="font-size:14px;margin-bottom:14px">${starsHtml(avg, 16)} <strong style="color:var(--csu-green-dark)">${avg.toFixed(1)}</strong> · ${fbs.length} review${fbs.length === 1 ? '' : 's'}</div>` : ''}
        <p style="color:var(--text-muted);font-size:16px;line-height:1.7;margin-bottom:24px">${escapeHtml(e.desc)}</p>
        <div class="event-details-grid">
          <div><div class="detail-label">📅 Date & Time</div><div class="detail-val">${formatDate(e.date)}<br>${e.time}</div></div>
          <div><div class="detail-label">📍 Venue</div><div class="detail-val">${escapeHtml(e.venue)}</div></div>
          <div><div class="detail-label">👥 Capacity</div><div class="detail-val">${cnt} / ${e.capacity}</div><div class="event-progress" style="margin-top:6px"><div class="event-progress-bar" style="width:${pct}%"></div></div></div>
          <div><div class="detail-label">🛡️ Organizer</div><div class="detail-val">${escapeHtml(org ? org.name : 'CSU')}</div></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
          ${actionBtn}
          <button class="btn btn-outline" onclick="shareEvent('${eid}')">🔗 Share</button>
        </div>
        ${showFbSummary ? renderFeedbackSection(eid) : ''}
      </div>
    </div>`;
  showPage('event');
}

function renderFeedbackSection(eid) {
  const fbs = eventFeedbacks(eid).slice().sort((a, b) => b.date.localeCompare(a.date));
  const avg = avgRating(eid);
  let body = '';
  if (!fbs.length) { body = '<div class="empty-state"><span class="ico">💬</span><h4>No feedback yet</h4></div>'; }
  else {
    body = fbs.slice(0, 8).map(f => {
      const u = DB.users.find(x => x.id === f.userId);
      return `<div class="fb-item">
        <div class="fb-head"><strong>${escapeHtml(u ? u.name : 'Student')}</strong> ${starsHtml(f.rating, 14)} <span class="date">${formatDate(f.date.slice(0, 10))}</span></div>
        <div class="fb-comment">${escapeHtml(f.comment)}</div></div>`;
    }).join('');
  }
  return `<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">
    <h3 class="serif" style="font-size:22px;color:var(--csu-green-dark);margin-bottom:8px">Feedback Summary</h3>
    <div class="rating-line" style="font-size:14px;margin-bottom:16px">${starsHtml(avg, 16)} <strong style="color:var(--csu-green-dark)">${avg.toFixed(1)}</strong> avg · ${fbs.length} response${fbs.length === 1 ? '' : 's'}</div>
    ${body}
  </div>`;
}

function openFeedback(eid) {
  if (!CU) return openLogin();
  if (CU.role !== 'student') return toast('Only students can leave feedback', 'error');
  const ev = DB.events.find(e => e.id === eid);
  if (!ev) return;
  if (eventStatus(ev) !== 'past') return toast('Feedback opens after the event has ended', 'warning');
  if (!isReg(eid)) return toast('Only registered participants can leave feedback', 'error');
  if (userFeedback(eid)) return toast('You already submitted feedback', 'warning');
  pendingFbEventId = eid; pendingFbRating = 0;
  document.getElementById('fbEventTitle').textContent = ev.title;
  document.getElementById('fbComment').value = '';
  renderFbStarPicker();
  document.getElementById('feedbackModal').classList.add('open');
}
function renderFbStarPicker() {
  const el = document.getElementById('fbStarPicker');
  let h = '';
  for (let i = 1; i <= 5; i++) h += `<span class="st input ${i <= pendingFbRating ? 'on' : ''}" onclick="setFbRating(${i})">★</span>`;
  el.innerHTML = h;
}
function setFbRating(n) { pendingFbRating = n; renderFbStarPicker(); }

function viewEventFeedback(eid) {
  const e   = DB.events.find(x => x.id === eid);
  if (!e) return;
  const fbs = eventFeedbacks(eid).slice().sort((a, b) => b.date.localeCompare(a.date));
  const avg = avgRating(eid);
  document.getElementById('vfbTitle').textContent = 'Feedback — ' + e.title;
  let body = `<div class="rating-line" style="font-size:15px;margin-bottom:18px">${starsHtml(avg, 18)} <strong style="color:var(--csu-green-dark)">${avg.toFixed(1)}</strong> avg · ${fbs.length} response${fbs.length === 1 ? '' : 's'}</div>`;
  if (!fbs.length) body += '<div class="empty-state"><span class="ico">💬</span><h4>No feedback yet</h4></div>';
  else body += fbs.map(f => {
    const u = DB.users.find(x => x.id === f.userId);
    return `<div class="fb-item">
      <div class="fb-head"><strong>${escapeHtml(u ? u.name : 'Student')}</strong> ${starsHtml(f.rating, 14)} <span class="date">${formatDate(f.date.slice(0, 10))}</span></div>
      <div class="fb-comment">${escapeHtml(f.comment)}</div></div>`;
  }).join('');
  document.getElementById('vfbBody').innerHTML = body;
  document.getElementById('viewFeedbackModal').classList.add('open');
}

function shareEvent(eid) {
  const e = DB.events.find(x => x.id === eid);
  if (!e) return;
  if (navigator.share) { navigator.share({ title: e.title, text: e.desc }).catch(() => {}); }
  else { navigator.clipboard.writeText(e.title + ' — ' + e.desc).then(() => toast('Event copied to clipboard')); }
}

/* ============================================================
   12) STUDENT DASHBOARD
   ============================================================ */
function renderStudentDash() {
  if (!CU) return;
  document.getElementById('dashName').textContent = CU.name.split(' ')[0];
  const myRegs   = DB.regs.filter(r => r.userId === CU.id);
  const myEvents = myRegs.map(r => DB.events.find(e => e.id === r.eventId)).filter(Boolean);
  const upcoming = myEvents.filter(e => eventStatus(e) !== 'past').sort((a, b) => a.date.localeCompare(b.date));
  const attended = myEvents.filter(e => DB.attendance && DB.attendance[e.id + '_' + CU.id] === true);
  const certsCount = myRegs.filter(r => DB.certificates && !!DB.certificates[r.eventId + '_' + CU.id]).length;

  document.getElementById('ds1').textContent = myRegs.length;
  document.getElementById('ds2').textContent = upcoming.length;
  document.getElementById('ds3').textContent = attended.length;
  document.getElementById('ds4').textContent = certsCount;

  if (upcoming.length) {
    const e = upcoming[0];
    document.getElementById('upcomingBody').innerHTML = `
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div style="width:90px;height:90px;border-radius:14px;background:var(--grad-hero);color:var(--csu-gold);display:flex;align-items:center;justify-content:center;font-size:42px;flex-shrink:0">${e.icon || '🎉'}</div>
        <div style="flex:1;min-width:200px">
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:var(--csu-green-dark);margin-bottom:6px">${escapeHtml(e.title)}</div>
          <div style="color:var(--text-muted);font-size:14px">📅 ${formatDate(e.date)} · ${e.time}<br>📍 ${escapeHtml(e.venue)}</div>
        </div>
        <button class="btn btn-primary" onclick="viewEvent('${e.id}')">View Details</button>
      </div>`;
  } else {
    document.getElementById('upcomingBody').innerHTML = '<div class="empty-state"><span class="ico">📭</span><h4>No upcoming events</h4><p>Browse events and register for one!</p></div>';
  }

  if (myRegs.length) {
    document.getElementById('myRegsTbl').innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Event</th><th>Category</th><th>Date</th><th>Status</th><th>Attendance</th><th>Certificate</th><th>Action</th></tr></thead><tbody>
      ${myRegs.map(r => {
        const e = DB.events.find(x => x.id === r.eventId);
        if (!e) return '';
        const s = eventStatus(e);
        const attKey  = e.id + '_' + CU.id;
        const attended= DB.attendance && DB.attendance[attKey];
        let attBadge  = '<span style="color:var(--text-muted);font-size:12px">—</span>';
        if (attended === true)  attBadge = '<span class="att-badge att-yes">✅ Attended</span>';
        if (attended === false) attBadge = '<span class="att-badge att-no">❌ Absent</span>';
        const cert = DB.certificates && DB.certificates[attKey];
        let certBtn = '<span style="color:var(--text-muted);font-size:12px">—</span>';
        if (cert) {
          certBtn = cert.type === 'text'
            ? `<button class="btn btn-outline btn-sm" onclick="showTextCert('${e.id}','${CU.id}')">📜 View</button>`
            : `<a href="${cert.data}" download="${cert.name}" class="btn btn-outline btn-sm">📎 Download</a>`;
        }
        return `<tr>
          <td><strong>${escapeHtml(e.title)}</strong></td>
          <td>${e.category}</td>
          <td>${formatDate(e.date)}</td>
          <td><span class="status-pill ${s === 'past' ? 's-rejected' : s === 'ongoing' ? 's-active' : 's-approved'}">${s}</span></td>
          <td>${attBadge}</td><td>${certBtn}</td>
          <td><div class="tbl-actions">
            <button class="btn btn-outline btn-sm" onclick="viewEvent('${e.id}')">View</button>
            ${s !== 'past' ? `<button class="btn btn-outline btn-sm" onclick="unregister('${e.id}');renderStudentDash()">Cancel</button>` : ''}
          </div></td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
  } else {
    document.getElementById('myRegsTbl').innerHTML = '<div class="empty-state"><span class="ico">🎟️</span><h4>No registrations yet</h4><p>Start exploring events to join!</p></div>';
  }
}

/* ============================================================
   13) ORGANIZER DASHBOARD
   ============================================================ */
function renderOrganizerDash() {
  if (!CU) return;
  document.getElementById('orgName').textContent = CU.name;
  const o = ownedOrg();
  const createBtn = document.getElementById('createOrgPageBtn');
  if (createBtn) createBtn.style.display = o ? 'none' : 'flex';

  const mine       = DB.events.filter(e => e.organizerId === CU.id);
  const totalRegs  = mine.reduce((s, e) => s + regCount(e.id), 0);
  const mineIds    = new Set(mine.map(e => e.id));
  const myFbs      = (DB.feedbacks || []).filter(f => mineIds.has(f.eventId));
  const avgSat     = myFbs.length ? myFbs.reduce((s, f) => s + f.rating, 0) / myFbs.length : 0;
  const posPercent = myFbs.length ? Math.round(myFbs.filter(f => f.rating >= 4).length / myFbs.length * 100) : 0;

  document.getElementById('os1').textContent = mine.length;
  document.getElementById('os2').textContent = totalRegs;
  if (myFbs.length) {
    document.getElementById('os3').textContent    = '⭐ ' + avgSat.toFixed(1) + ' / 5.0';
    document.getElementById('os3sub').textContent = `(from ${myFbs.length} review${myFbs.length === 1 ? '' : 's'} · ${posPercent}% positive)`;
  } else {
    document.getElementById('os3').textContent    = '⭐ No reviews yet';
    document.getElementById('os3sub').textContent = '';
  }
  document.getElementById('os4').textContent = mine.filter(e => e.status === 'pending').length;
  renderOrgEventsTbl();
}

function switchOrgTab(t, el) {
  orgTab = t;
  document.querySelectorAll('#page-organizer .panel-head .tab').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  renderOrgEventsTbl();
}

function renderOrgEventsTbl() {
  let evts = DB.events.filter(e => e.organizerId === CU.id);
  if (orgTab !== 'all') evts = evts.filter(e => e.status === orgTab);
evts = evts.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!evts.length) {
    document.getElementById('orgEventsTbl').innerHTML = '<div class="empty-state"><span class="ico">📅</span><h4>No events yet</h4><p>Click "Create New Event" to get started.</p></div>';
    return;
  }
  document.getElementById('orgEventsTbl').innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Event</th><th>Date</th><th>Venue</th><th>Registrations</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${evts.map(e => `<tr>
      <td><strong>${escapeHtml(e.title)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${e.category}</span></td>
      <td>${formatDate(e.date)}</td>
      <td>${escapeHtml(e.venue)}</td>
      <td>${regCount(e.id)} / ${e.capacity}</td>
      <td><span class="status-pill s-${e.status}">${e.status}</span></td>
      <td><div class="tbl-actions">
        <button class="btn btn-outline btn-sm" onclick="viewEvent('${e.id}')">View</button>
        <button class="btn btn-outline btn-sm" onclick="editEvent('${e.id}')">Edit</button>
        <button class="btn btn-outline btn-sm" onclick="viewEventFeedback('${e.id}')">⭐ Feedback (${eventFeedbacks(e.id).length})</button>
        <button class="btn btn-primary btn-sm" onclick="openViewStudents('${e.id}')">👥 Students</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEvent('${e.id}')">Delete</button>
      </div></td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function openCreateEvent() {
  editingEventId = null; pendingEventPhoto = null;
  document.getElementById('evModalTitle').textContent  = 'Create New Event';
  document.getElementById('evSubmitBtn').textContent   = 'Create Event';
  ['evTitle', 'evDesc', 'evVenue', 'evDate', 'evTime'].forEach(i => { if (document.getElementById(i)) document.getElementById(i).value = ''; });
  document.getElementById('evCap').value = 100;
  clearEventImage();
  document.getElementById('eventModal').classList.add('open');
}

function editEvent(eid) {
  const e = DB.events.find(x => x.id === eid);
  if (!e) return;
  editingEventId = eid;
  document.getElementById('evModalTitle').textContent = 'Edit Event';
  document.getElementById('evSubmitBtn').textContent  = 'Save Changes';
  document.getElementById('evTitle').value    = e.title;
  document.getElementById('evDesc').value     = e.desc;
  document.getElementById('evCat').value      = e.category;
  document.getElementById('evCap').value      = e.capacity;
  document.getElementById('evDate').value     = e.date;
  document.getElementById('evTime').value     = e.time;
  document.getElementById('evVenue').value    = e.venue;
  pendingEventPhoto = e.photo || null;
  if (pendingEventPhoto) {
    document.getElementById('evImagePreviewImg').src = pendingEventPhoto;
    document.getElementById('evImagePreview').style.display = 'block';
  } else { clearEventImage(); }
  document.getElementById('eventModal').classList.add('open');
}

function handleEventImage(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) return toast('Image too large (max 2MB)', 'error');
  const r = new FileReader();
  r.onload = e => {
    pendingEventPhoto = e.target.result;
    document.getElementById('evImagePreviewImg').src = pendingEventPhoto;
    document.getElementById('evImagePreview').style.display = 'block';
  };
  r.readAsDataURL(f);
}
function clearEventImage() {
  pendingEventPhoto = null;
  const el = document.getElementById('evImage'); if (el) el.value = '';
  const p  = document.getElementById('evImagePreview'); if (p) p.style.display = 'none';
}

/* ============================================================
   14) VIEW STUDENTS
   ============================================================ */
function openViewStudents(eid) {
  vsCurrentEventId = eid;
  renderViewStudents();
  document.getElementById('viewStudentsModal').classList.add('open');
}

function renderViewStudents() {
  const eid = vsCurrentEventId;
  const e   = DB.events.find(x => x.id === eid);
  if (!e) return;
  if (!DB.attendance)  DB.attendance  = {};
  if (!DB.certificates) DB.certificates = {};
  document.getElementById('vsModalTitle').textContent = '👥 Participants — ' + escapeHtml(e.title);
  const regs = DB.regs.filter(r => r.eventId === eid);
  if (!regs.length) {
    document.getElementById('vsModalBody').innerHTML = '<div class="empty-state"><span class="ico">🎟️</span><h4>No registrations yet</h4></div>';
    return;
  }
  const rows = regs.map(r => {
    const u = DB.users.find(x => x.id === r.userId);
    if (!u) return '';
    const attKey  = eid + '_' + u.id;
    const attended= DB.attendance[attKey];
    const cert    = DB.certificates[attKey];
    const attBtns = `
      <button class="btn btn-sm ${attended === true ? 'btn-primary' : 'btn-outline'}" onclick="markAttendance('${eid}','${u.id}',true)">✅ Attended</button>
      <button class="btn btn-sm ${attended === false ? 'btn-danger' : 'btn-outline'}" onclick="markAttendance('${eid}','${u.id}',false)">❌ Absent</button>`;
    let certBadge = '';
    if (cert) certBadge = cert.type === 'text'
      ? '<span class="cert-badge">📜 Text Cert</span>'
      : '<span class="cert-badge">📎 File Cert</span>';
    const certBtn = `<button class="btn btn-outline btn-sm" onclick="openCertUpload('${eid}','${u.id}')">📜 ${cert ? 'Edit' : 'Add'} Cert</button>`;
    return `<tr>
      <td><strong>${escapeHtml(u.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(u.sid || '')} · ${escapeHtml(u.dept || '')}</span></td>
      <td>${escapeHtml(u.email)}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap">${attBtns}</div></td>
      <td><div style="display:flex;align-items:center;gap:6px">${certBadge}${certBtn}</div></td>
    </tr>`;
  }).join('');

  document.getElementById('vsModalBody').innerHTML = `
    <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div style="font-size:13px;color:var(--text-muted)">${regs.length} participant${regs.length === 1 ? '' : 's'} registered</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="markAllAttendance('${eid}',true)">✅ Mark All Attended</button>
        <button class="btn btn-outline btn-sm" onclick="markAllAttendance('${eid}',false)">❌ Mark All Absent</button>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table class="tbl"><thead><tr><th>Student</th><th>Email</th><th>Attendance</th><th>Certificate</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
}

function openCertUpload(eid, userId) {
  certPendingEventId = eid; certPendingUserId = userId; pendingCertFile = null;
  const e  = DB.events.find(x => x.id === eid);
  const u  = DB.users.find(x => x.id === userId);
  if (!DB.certificates) DB.certificates = {};
  const existingCert = DB.certificates[eid + '_' + userId];
  document.getElementById('certUploadTarget').textContent = 'For: ' + (u ? u.name : 'Student') + ' · ' + (e ? e.title : 'Event');
  document.getElementById('certFileInput').value = '';
  document.getElementById('certFilePreview').style.display = 'none';
  document.getElementById('certTextInput').value = existingCert && existingCert.type === 'text' ? existingCert.content : '';
  document.getElementById('certType').value = existingCert ? (existingCert.type === 'text' ? 'text' : 'file') : 'file';
  toggleCertType();
  document.getElementById('certUploadModal').classList.add('open');
}
function toggleCertType() {
  const t = document.getElementById('certType').value;
  document.getElementById('certFileSection').style.display = t === 'file' ? 'block' : 'none';
  document.getElementById('certTextSection').style.display = t === 'text' ? 'block' : 'none';
}
function handleCertFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return toast('File too large (max 5MB)', 'error');
  const r = new FileReader();
  r.onload = e => {
    pendingCertFile = { name: f.name, data: e.target.result, mimeType: f.type };
    const prev = document.getElementById('certFilePreview');
    prev.textContent = '📎 ' + f.name; prev.style.display = 'block';
  };
  r.readAsDataURL(f);
}
function showTextCert(eid, userId) {
  if (!DB.certificates) return;
  const cert = DB.certificates[eid + '_' + userId];
  if (!cert || cert.type !== 'text') return;
  const u    = DB.users.find(x => x.id === userId);
  const certText = cert.content.replace(/\[Student Name\]/g, u ? u.name : 'Student');
  const ev   = DB.events.find(x => x.id === eid);
  const w    = window.open('', '_blank', 'width=600,height=500');
  w.document.write(`<!DOCTYPE html><html><head><title>Certificate</title><style>
    body{font-family:'Georgia',serif;padding:40px;background:#fffdf5;color:#1a2a1f;text-align:center}
    h1{color:#0a5d2a;font-size:28px;margin-bottom:10px}
    .border{border:6px double #f5c518;padding:40px;border-radius:12px;max-width:520px;margin:0 auto}
    p{font-size:16px;line-height:1.8;white-space:pre-wrap}
  </style></head><body><div class="border"><h1>🎓 Certificate</h1><hr style="border:1px solid #f5c518;margin:16px 0">
    <p>${escapeHtml(certText).replace(/\n/g, '<br>')}</p>
    <div style="margin-top:24px;font-size:12px;color:#7d8b80">Issued for: ${ev ? escapeHtml(ev.title) : ''}</div>
  </div></body></html>`);
  w.document.close();
}

/* ============================================================
   15) ADMIN DASHBOARD
   ============================================================ */
function renderAdminDash() {
  document.getElementById('as1').textContent = DB.events.length;
  document.getElementById('as2').textContent = DB.events.filter(e => e.status === 'pending').length;
  document.getElementById('as3').textContent = DB.users.length;
  document.getElementById('as4').textContent = (DB.organizations || []).length;
  renderAdminTab();
}

function switchAdminTab(t, el) {
  adminTab = t;
  document.querySelectorAll('#page-admin .tabs .tab').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  renderAdminTab();
}

function renderAdminTab() {
  const c = document.getElementById('adminTabContent');
  if (adminTab === 'pending' || adminTab === 'all') {
    let evts = adminTab === 'pending'
      ? DB.events.filter(e => e.status === 'pending')
      : DB.events.filter(e => e.status === 'approved' || e.status === 'rejected');
evts = evts.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!evts.length) { c.innerHTML = '<div class="empty-state"><span class="ico">✅</span><h4>Nothing here</h4></div>'; return; }
    c.innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Event</th><th>Organizer</th><th>Date</th><th>Status</th><th>Featured</th><th>Actions</th></tr></thead><tbody>
      ${evts.map(e => {
        const o = DB.users.find(u => u.id === e.organizerId);
        return `<tr>
          <td><strong>${escapeHtml(e.title)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${e.category} · ${e.venue}</span></td>
          <td>${escapeHtml(o ? o.name : '—')}</td>
          <td>${formatDate(e.date)}</td>
          <td><span class="status-pill s-${e.status}">${e.status}</span></td>
          <td>${e.featured ? '<span style="color:var(--csu-gold-dark);font-weight:700">⭐ Yes</span>' : '<span style="color:var(--text-muted)">No</span>'}</td>
          <td><div class="tbl-actions">
            <button class="btn btn-outline btn-sm" onclick="viewEvent('${e.id}')">View</button>
            <button class="btn btn-outline btn-sm" onclick="toggleFeatured('${e.id}')">${e.featured ? 'Unfeature' : '⭐ Feature'}</button>
            ${e.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="adminApprove('${e.id}')">Approve</button><button class="btn btn-danger btn-sm" onclick="adminReject('${e.id}')">Reject</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="deleteEvent('${e.id}')">Delete</button>
          </div></td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
  } else if (adminTab === 'users') {
    c.innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Actions</th></tr></thead><tbody>
      ${DB.users.map(u => {
        if (u.role === 'admin') return `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${escapeHtml(u.email)}</td><td><span class="role-badge admin">admin</span></td><td>${escapeHtml(u.dept || '')}</td><td><em style="color:var(--text-muted)">protected</em></td></tr>`;
        const promoteBtn = u.role === 'student'
          ? `<button class="btn btn-primary btn-sm" onclick="setUserRole('${u.id}','organizer')">🛡️ Make Organizer</button>`
          : `<button class="btn btn-outline btn-sm" onclick="setUserRole('${u.id}','student')">↩ Demote</button>`;
        return `<tr>
          <td><strong>${escapeHtml(u.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(u.sid || '')}</span></td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="role-badge ${u.role}">${u.role}</span></td>
          <td>${escapeHtml(u.dept || '')}</td>
          <td><div class="tbl-actions">${promoteBtn}<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">Remove</button></div></td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
  } else if (adminTab === 'regs') {
    const approvedEvts = DB.events.filter(e => e.status === 'approved');
    if (!approvedEvts.length) { c.innerHTML = '<div class="empty-state"><span class="ico">📊</span><h4>No approved events</h4></div>'; return; }
    const rows = approvedEvts.map(e => { const cnt = regCount(e.id); const pct = Math.round(cnt / e.capacity * 100); return { e, cnt, pct }; });
    c.innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Event</th><th>Date</th><th>Registered</th><th>Capacity</th><th>Fill Rate</th><th>Action</th></tr></thead><tbody>
      ${rows.map(({ e, cnt, pct }) => `<tr>
        <td><strong>${escapeHtml(e.title)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${e.category}</span></td>
        <td>${formatDate(e.date)}</td><td>${cnt}</td><td>${e.capacity}</td>
        <td><div style="display:flex;align-items:center;gap:10px"><span style="font-weight:700;min-width:42px">${pct}%</span><div class="event-progress" style="flex:1;min-width:80px"><div class="event-progress-bar" style="width:${Math.min(100,pct)}%"></div></div></div></td>
        <td><button class="btn btn-outline btn-sm" onclick="viewRegistrants('${e.id}')">View Students</button></td>
      </tr>`).join('')}
    </tbody></table></div>
    <div id="regDetailWrap" style="margin-top:24px"></div>`;
  } else if (adminTab === 'orgs') {
    renderAdminOrgsTab();
  } else if (adminTab === 'feedback') {
    const approvedEvts = DB.events.filter(e => e.status === 'approved');
    if (!approvedEvts.length) { c.innerHTML = '<div class="empty-state"><span class="ico">⭐</span><h4>No approved events</h4></div>'; return; }
    const rows = approvedEvts.map(e => ({ e, fbs: eventFeedbacks(e.id), avg: avgRating(e.id) })).sort((a, b) => b.fbs.length - a.fbs.length);
    c.innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Event</th><th>Date</th><th>Avg Rating</th><th>Responses</th><th>Action</th></tr></thead><tbody>
      ${rows.map(({ e, fbs, avg }) => `<tr>
        <td><strong>${escapeHtml(e.title)}</strong></td>
        <td>${formatDate(e.date)}</td>
        <td>${fbs.length ? `${starsHtml(avg, 13)} <strong>${avg.toFixed(1)}</strong>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${fbs.length}</td>
        <td><button class="btn btn-outline btn-sm" onclick="viewEventFeedback('${e.id}')">View Feedback</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }
}

function viewRegistrants(eid) {
  const e    = DB.events.find(x => x.id === eid);
  if (!e) return;
  const regs = DB.regs.filter(r => r.eventId === eid).map(r => DB.users.find(u => u.id === r.userId)).filter(Boolean);
  const w    = document.getElementById('regDetailWrap');
  if (!regs.length) {
    w.innerHTML = `<div class="panel"><div class="panel-head"><div class="panel-title">Registrants — ${escapeHtml(e.title)}</div></div><div class="panel-body"><div class="empty-state"><span class="ico">🎟️</span><h4>No registrations yet</h4></div></div></div>`;
    return;
  }
  w.innerHTML = `<div class="panel"><div class="panel-head"><div class="panel-title">Registrants — ${escapeHtml(e.title)} (${regs.length})</div></div><div class="panel-body tight">
    <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Student ID</th><th>Department</th></tr></thead><tbody>
    ${regs.map(u => `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.sid || '')}</td><td>${escapeHtml(u.dept || '')}</td></tr>`).join('')}
    </tbody></table></div></div></div>`;
  w.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   16) ORGANIZATIONS PAGE
   ============================================================ */
/* ============================================================
   16) ORGANIZATIONS PAGE
   ============================================================ */
function setOrgsPageTab(t, el) {
  renderOrgsPage();
}
function renderOrgsPage() {
  // Hide the Feed pane (visible by default in HTML — no style attr)
  const feedPane = document.getElementById('orgsFeedPane');
  if (feedPane) feedPane.style.display = 'none';
 
  // Show the Discover pane (hidden by default in HTML via style="display:none")
  const discoverPane = document.getElementById('orgsDiscoverPane');
  if (discoverPane) discoverPane.style.display = 'block';
 
  // Hide the tab bar (no longer needed — only one view exists)
  const tabBar = document.getElementById('orgsBrowseTabs');
  if (tabBar) tabBar.style.display = 'none';
 
  // Render org cards into #orgsGrid
  renderOrgsDiscover();
}

function renderOrgsFeed() {
  // Intentional no-op. Feed removed from Orgs page.
}

function renderOrgsDiscover() {
  const grid = document.getElementById('orgsGrid');
  if (!grid) return;

  // FIX B: Was broken — had literal placeholder "...rest of card HTML..."
  // which rendered as visible text and broke the org card layout.
  // Replaced with complete card HTML reusing existing helpers:
  // orgLogoHtml(), orgCoverStyle(), orgFollowerCount(), isFollowing(),
  // orgPostCount(), openOrgProfile(), toggleFollow() — all untouched.

  const q    = (document.getElementById('orgSearchInput')?.value || '').toLowerCase().trim();
  let   list = (DB.organizations || []);
  if (q) {
    list = list.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.description || '').toLowerCase().includes(q) ||
      (o.category    || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="ico">🏢</span>
        <h4>No organizations found</h4>
        <p>${q ? 'Try a different search term.' : 'No organizations yet.'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(o => {
    const following = isFollowing(o.id);
    const isOwn     = CU && CU.id === o.organizerId;
    return `
      <div class="panel org-discover-card" style="padding:0;overflow:hidden;cursor:pointer">
        <div style="height:110px;border-radius:12px 12px 0 0;${orgCoverStyle(o)}"
             onclick="openOrgProfile('${o.id}')"></div>
        <div style="padding:16px 18px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
            <div onclick="openOrgProfile('${o.id}')" style="flex-shrink:0">
              ${orgLogoHtml(o, 48)}
            </div>
            <div style="flex:1;min-width:0;cursor:pointer" onclick="openOrgProfile('${o.id}')">
              <div style="font-weight:700;font-size:15px;color:var(--csu-green-dark);
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${escapeHtml(o.name)}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                ${escapeHtml(o.category || 'General')}
              </div>
            </div>
          </div>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.5;
                    margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;
                    -webkit-box-orient:vertical;overflow:hidden">
            ${escapeHtml(o.description || 'No description yet.')}
          </p>
          <div style="display:flex;align-items:center;justify-content:space-between;
                      flex-wrap:wrap;gap:8px">
            <div style="font-size:12px;color:var(--text-muted)">
              👥 ${orgFollowerCount(o.id)} followers &nbsp;·&nbsp; 📝 ${orgPostCount(o.id)} posts
            </div>
            ${isOwn
              ? `<span style="font-size:11px;color:var(--csu-green-dark);font-weight:700;
                              background:var(--csu-green-soft);padding:4px 10px;
                              border-radius:6px">Your Org</span>`
              : CU
                ? `<button class="btn btn-sm ${following ? 'btn-outline' : 'btn-primary'}"
                           onclick="event.stopPropagation();toggleFollow('${o.id}')">
                     ${following ? '✓ Following' : '+ Follow'}
                   </button>`
                : `<button class="btn btn-sm btn-primary"
                           onclick="event.stopPropagation();openLogin('login')">
                     Follow
                   </button>`
            }
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ============================================================
   17) ORG PROFILE PAGE
   ============================================================ */
function openOrgProfile(oid) { viewingOrgId = oid; showPage('orgprofile'); }

function renderOrgProfile() {
  const o    = getOrgById(viewingOrgId);
  const body = document.getElementById('orgProfileBody');
  if (!o) {
    body.innerHTML = '<div class="container" style="padding:60px 0"><div class="empty-state"><span class="ico">🏢</span><h4>Organization not found</h4><button class="btn btn-primary" onclick="showPage(\'orgs\')">← Back</button></div></div>';
    return;
  }

  const isOwner   = CU && CU.id === o.organizerId;
  const owner     = DB.users.find(u => u.id === o.organizerId);
  const posts     = (DB.organizationPosts || [])
    .filter(p => p.organizationId === o.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const photos    = getOrgPhotos(o.id);
  const following = isFollowing(o.id);

  // Reusable photo URL array — built once, referenced safely in lightbox calls
  const photoUrls = JSON.stringify(photos.map(x => x.mediaUrl));

  body.innerHTML = `
    <!-- ① COVER BANNER -->
<div id="orgProfileCover" style="height:280px;${orgCoverStyle(o)};display:flex;align-items:flex-end;padding:0">
      <div class="container" style="padding-bottom:28px;color:#fff">
        <button class="btn btn-outline"
                style="background:rgba(255,255,255,.95);color:var(--text);margin-bottom:16px"
                onclick="showPage('orgs')">← All Organizations</button>
      </div>
    </div>

<div class="container" id="orgProfileContent" style="padding-top:0;margin-top:-50px;position:relative">

      <!-- ② HEADER CARD (logo + name + follow btn) — unchanged -->
      <div class="panel">
        <div class="panel-body" style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          ${orgLogoHtml(o, 96)}
          <div style="flex:1;min-width:220px">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <h2 class="serif" style="font-size:clamp(20px,3vw,28px)">${escapeHtml(o.name)}</h2>
              <span class="role-badge organizer">${escapeHtml(o.category || 'General')}</span>
            </div>
            <p style="color:var(--text-muted);margin-top:8px;max-width:680px">${escapeHtml(o.description || '')}</p>
            <div style="display:flex;gap:16px;margin-top:12px;font-size:13px;color:var(--text-soft);font-weight:600;flex-wrap:wrap">
              <span>👥 ${orgFollowerCount(o.id)} followers</span>
              <span>📝 ${posts.length} posts</span>
              ${owner ? `<span>🛡️ ${escapeHtml(owner.name)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${isOwner
              ? `<button class="btn btn-outline"
                         onclick="showPage('organizer');setTimeout(()=>switchOrgMainTab('myorg',document.querySelectorAll('#orgDashTabs .tab')[1]),100)">
                   ⚙️ Manage Page
                 </button>`
              : ''}
            ${!isOwner && CU
              ? `<button class="btn ${following ? 'btn-outline' : 'btn-primary'}"
                         onclick="toggleFollow('${o.id}')">
                   ${following ? '✓ Following' : '+ Follow'}
                 </button>`
              : ''}
            ${!CU
              ? `<button class="btn btn-primary" onclick="openLogin('login')">Sign in to follow</button>`
              : ''}
          </div>
        </div>
      </div>

      <!-- ③ ABOUT — full width, above photos and posts -->
      ${o.description || (o.socialLinks && (o.socialLinks.facebook || o.socialLinks.instagram)) ? `
      <div class="panel" style="margin-top:18px">
        <div class="panel-head"><div class="panel-title">About</div></div>
        <div class="panel-body">
          ${o.description
            ? `<p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:${(o.socialLinks?.facebook || o.socialLinks?.instagram) ? '14px' : '0'}">
                 ${escapeHtml(o.description)}
               </p>`
            : ''}
          ${o.socialLinks && (o.socialLinks.facebook || o.socialLinks.instagram)
            ? `<div style="display:flex;gap:16px;flex-wrap:wrap">
                 ${o.socialLinks.facebook
                   ? `<a href="${o.socialLinks.facebook}" target="_blank" rel="noopener"
                         style="color:var(--csu-green-dark);font-weight:600;font-size:13px">
                        📘 Facebook
                      </a>`
                   : ''}
                 ${o.socialLinks.instagram
                   ? `<a href="${o.socialLinks.instagram}" target="_blank" rel="noopener"
                         style="color:var(--csu-green-dark);font-weight:600;font-size:13px">
                        📸 Instagram
                      </a>`
                   : ''}
               </div>`
            : ''}
        </div>
      </div>` : ''}

      <!-- ④ PHOTO GALLERY — full width, below About, above posts -->
      ${photos.length ? `
      <div class="panel" style="margin-top:18px">
        <div class="panel-head" onclick="toggleOrgGallery('${o.id}')" style="cursor:pointer">
          <div class="panel-title">📸 Photo Gallery (${photos.length})</div>
          <span id="galleryChevron_${o.id}"
                style="font-size:18px;color:var(--text-muted);transition:transform .25s;display:inline-block">▼</span>
        </div>
        <div id="galleryBody_${o.id}" style="display:none">
          <div class="panel-body">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px">
              ${photos.slice(0, 9).map((p, i) => `
                <img src="${p.mediaUrl}"
                     style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer"
                     onclick="openLightbox(${photoUrls},${i})"
                     loading="lazy">
              `).join('')}
            </div>
            ${photos.length > 9
              ? `<button class="btn btn-outline btn-sm"
                         style="width:100%;justify-content:center;margin-top:10px"
                         onclick="openLightbox(${photoUrls},0)">
                   View All ${photos.length} Photos
                 </button>`
              : ''}
          </div>
        </div>
      </div>` : ''}

      <!-- ⑤ POSTS FEED — always last -->
      <div class="panel" style="margin-top:18px;margin-bottom:40px">
        <div class="panel-head"><div class="panel-title">Posts</div></div>
        <div class="panel-body">
          ${posts.length
            ? posts.map(p => renderFbPostHtml(p, isOwner)).join('')
            : '<div class="empty-state"><span class="ico">📝</span><h4>No posts yet</h4></div>'}
        </div>
      </div>

    </div>`;
}

function toggleOrgGallery(oid) {
  const galleryBody = document.getElementById('galleryBody_' + oid);
  const chevron     = document.getElementById('galleryChevron_' + oid);
  if (!galleryBody) return;
  const isOpen = _galleryState[oid] || false;
  if (isOpen) {
    galleryBody.style.display   = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    _galleryState[oid] = false;
  } else {
    galleryBody.style.display   = 'block';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    _galleryState[oid] = true;
  }
}

/* ============================================================
   18) ORGANIZER DASHBOARD — MY ORG SECTION
   ============================================================ */
function switchOrgMainTab(t, el) {
  orgMainTab = t;
  document.querySelectorAll('#orgDashTabs .tab').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('orgDashEventsSection').style.display  = t === 'events' ? 'block' : 'none';
  document.getElementById('orgDashMyOrgSection').style.display   = t === 'myorg'  ? 'block' : 'none';
  if (t === 'myorg') renderOrgMyOrgContent();
}

function renderOrgMyOrgContent() {
  const wrap = document.getElementById('orgMyOrgContent');
  const o    = ownedOrg();
  if (!o) {
    wrap.innerHTML = `<div class="panel-body" style="padding:40px;text-align:center">
      <div style="font-size:56px;margin-bottom:16px">🏢</div>
      <h3 style="font-family:'Playfair Display',serif;color:var(--csu-green-dark);margin-bottom:10px">No Organization Page Yet</h3>
      <p style="color:var(--text-muted);margin-bottom:20px">Create your organization's page to share posts, photos, and updates.</p>
      <button class="btn btn-primary" onclick="openCreateOrgModal()">🏢 Create Organization Page</button>
    </div>`;
    return;
  }
  _pendingPostOrgId = o.id;
  const posts = (DB.organizationPosts || []).filter(p => p.organizationId === o.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const init = CU.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  wrap.innerHTML = `
<div style="position:relative;z-index:1;height:200px;overflow:hidden;${orgCoverStyle(o)};display:flex;align-items:flex-end">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,rgba(6,61,28,.5))"></div>
    </div>
<div style="display:flex;align-items:flex-end;justify-content:space-between;padding:0 24px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:12px;position:relative;z-index:2;">
      <div style="display:flex;align-items:flex-end;gap:16px">
        <div style="width:96px;height:96px;border-radius:50%;border:4px solid #fff;background:var(--csu-green-soft);display:flex;align-items:center;justify-content:center;font-size:44px;margin-top:-48px;box-shadow:0 4px 16px rgba(0,0,0,.15);overflow:hidden;flex-shrink:0">
          ${o.logo && o.logo.startsWith('data:') ? `<img src="${o.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(o.logo || '🏢')}
        </div>
        <div>
          <h2 style="font-family:'Playfair Display',serif;font-size:24px;color:var(--csu-green-dark)">${escapeHtml(o.name)}</h2>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">
            <span class="role-badge organizer" style="margin-right:8px">${escapeHtml(o.category || 'General')}</span>
            👥 ${orgFollowerCount(o.id)} followers · 📝 ${posts.length} posts
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;padding-bottom:4px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="openOrgProfile('${o.id}')">👁️ View Public Page</button>
        <button class="btn btn-primary btn-sm" onclick="openOrgPageSettings('${o.id}')">⚙️ Edit Page</button>
      </div>
    </div>
    <div class="org-dash-main-grid" style="padding:20px 24px">
      <div>
        <div class="fb-composer">
          <div class="fb-composer-row">
            <div class="fb-composer-avatar">${init}</div>
            <div class="fb-composer-input" onclick="focusPostComposer('${o.id}')" style="display:flex;align-items:center;color:var(--text-muted);user-select:none;cursor:text">What's on your mind?</div>
          </div>
          <div id="postComposerExpanded_${o.id}" style="display:none">
            <textarea id="postTextInput_${o.id}" style="width:100%;min-height:80px;resize:none;border:1.5px solid var(--border);border-radius:10px;padding:12px;font-size:14px;margin-bottom:10px;display:block;font-family:inherit;outline:none;transition:border-color .2s" placeholder="Write something to share…" onfocus="this.style.borderColor='var(--csu-green)'" onblur="this.style.borderColor='var(--border)'"></textarea>
            <div id="postPhotosPreview_${o.id}" class="post-photo-thumbs"></div>
            <div id="postVideoPreviewWrap_${o.id}" style="display:none;margin-top:8px"></div>
          </div>
          <div class="fb-composer-btns">
            <button class="fb-composer-btn" onclick="triggerPhotoUpload('${o.id}')">📷 Photo</button>
            <button class="fb-composer-btn" onclick="triggerVideoUpload('${o.id}')">🎥 Video</button>
            <button class="fb-composer-btn" onclick="focusPostComposer('${o.id}')">📝 Text</button>
            <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="submitOrgPost('${o.id}')">Post</button>
          </div>
          <input type="file" id="photoUploadInput_${o.id}" accept="image/*" multiple style="display:none" onchange="handleMultiPhoto(event,'${o.id}')">
          <input type="file" id="videoUploadInput_${o.id}" accept="video/*" style="display:none" onchange="handleVideoUpload(event,'${o.id}')">
        </div>
        <div id="orgDashPostsFeed_${o.id}">
          ${posts.length ? posts.map(p => renderFbPostHtml(p, true)).join('') : '<div class="empty-state"><span class="ico">📝</span><h4>No posts yet</h4><p>Use the composer above to publish your first post.</p></div>'}
        </div>
      </div>
      <div>
        <div class="panel" style="margin-bottom:18px">
          <div class="panel-head"><div class="panel-title">About</div></div>
          <div class="panel-body">
            <p style="font-size:13px;color:var(--text-muted);line-height:1.6">${escapeHtml(o.description || 'No description yet. Click "Edit Page" to add one.')}</p>
            ${o.socialLinks?.facebook || o.socialLinks?.instagram ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
              ${o.socialLinks.facebook ? `<a href="${o.socialLinks.facebook}" target="_blank" rel="noopener" style="color:var(--csu-green-dark);font-weight:600;font-size:13px">📘 Facebook</a>` : ''}
              ${o.socialLinks.instagram ? `<a href="${o.socialLinks.instagram}" target="_blank" rel="noopener" style="color:var(--csu-green-dark);font-weight:600;font-size:13px">📸 Instagram</a>` : ''}
            </div>` : ''}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Photos</div></div>
          <div class="panel-body">
            ${(() => {
              const allPhotos = getOrgPhotos(o.id);
              return allPhotos.length
                ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
                     ${allPhotos.slice(0, 9).map(({ mediaUrl }) => `<img src="${mediaUrl}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" onclick="openLightbox(${JSON.stringify(allPhotos.map(x => x.mediaUrl))},${allPhotos.findIndex(x => x.mediaUrl === mediaUrl)})">`).join('')}
                   </div>`
                : '<p style="color:var(--text-muted);font-size:13px">No photos yet.</p>';
            })()}
          </div>
        </div>
      </div>
    </div>`;
}

function openOrgPostModal(oid) {
  showPage('organizer');
  setTimeout(() => {
    const tab = document.querySelectorAll('#orgDashTabs .tab')[1];
    if (tab) switchOrgMainTab('myorg', tab);
    setTimeout(() => {
      const ta = document.getElementById('postTextInput_' + oid);
      const expanded = document.getElementById('postComposerExpanded_' + oid);
      if (ta) ta.focus();
      if (expanded) expanded.style.display = 'block';
    }, 200);
  }, 100);
}

function focusPostComposer(oid) {
  const expanded = document.getElementById('postComposerExpanded_' + oid);
  if (expanded) expanded.style.display = 'block';
  const ta = document.getElementById('postTextInput_' + oid);
  if (ta) ta.focus();
}

function triggerPhotoUpload(oid) { focusPostComposer(oid); document.getElementById('photoUploadInput_' + oid)?.click(); }
function triggerVideoUpload(oid) { focusPostComposer(oid); document.getElementById('videoUploadInput_' + oid)?.click(); }

function handleMultiPhoto(ev, oid) {
  const files     = Array.from(ev.target.files || []);
  if (!files.length) return;
  const remaining = 5 - _pendingPostPhotos.length;
  if (remaining <= 0) return toast('Max 5 photos per post', 'warning');
  const toLoad = files.slice(0, remaining);
  let loaded = 0;
  toLoad.forEach(f => {
    if (f.size > 5 * 1024 * 1024) { toast('One image is too large (max 5MB)', 'warning'); loaded++; if (loaded === toLoad.length) renderPhotoThumbs(oid); return; }
    const r = new FileReader();
    r.onload = e => { _pendingPostPhotos.push(e.target.result); loaded++; if (loaded === toLoad.length) renderPhotoThumbs(oid); };
    r.readAsDataURL(f);
  });
}
function renderPhotoThumbs(oid) {
  const wrap = document.getElementById('postPhotosPreview_' + oid);
  if (!wrap) return;
  wrap.innerHTML = _pendingPostPhotos.map((u, i) => `<div class="post-photo-thumb"><img src="${u}"><button class="post-photo-thumb-del" onclick="removePostPhoto(${i},'${oid}')">×</button></div>`).join('');
}
function removePostPhoto(idx, oid) { _pendingPostPhotos.splice(idx, 1); renderPhotoThumbs(oid); }

function handleVideoUpload(ev, oid) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 50 * 1024 * 1024) return toast('Video too large (max 50MB)', 'error');
  const r = new FileReader();
  r.onload = e => {
    _pendingPostVideoData = e.target.result;
    const wrap = document.getElementById('postVideoPreviewWrap_' + oid);
    if (wrap) {
      wrap.style.display = 'block';
      wrap.innerHTML = `<video src="${_pendingPostVideoData}" controls style="width:100%;max-height:200px;border-radius:8px"></video>
        <button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="removePostVideo('${oid}')">Remove Video</button>`;
    }
  };
  r.readAsDataURL(f);
}
function removePostVideo(oid) {
  _pendingPostVideoData = null;
  const wrap = document.getElementById('postVideoPreviewWrap_' + oid);
  if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  const inp = document.getElementById('videoUploadInput_' + oid);
  if (inp) inp.value = '';
}

function openOrgPageSettings(oid) {
  const o = getOrgById(oid);
  if (!o) return;
  document.getElementById('opsOrgId').value = oid;
  document.getElementById('opsName').value  = o.name || '';
  document.getElementById('opsCat').value   = o.category || 'Academic';
  document.getElementById('opsDesc').value  = o.description || '';
  document.getElementById('opsFb').value    = o.socialLinks?.facebook || '';
  document.getElementById('opsIg').value    = o.socialLinks?.instagram || '';
  document.getElementById('opsEmoji').value = o.logo && !o.logo.startsWith('data:') ? o.logo : '';
  document.getElementById('opsLogoData').value  = o.logo && o.logo.startsWith('data:') ? o.logo : '';
  document.getElementById('opsCoverData').value = o.coverPhoto || '';
  document.getElementById('opsLogoFile').value  = '';
  document.getElementById('opsCoverFile').value = '';
  document.getElementById('opsLogoPreview').style.display  = 'none';
  document.getElementById('opsCoverPreview').style.display = 'none';
  if (o.logo && o.logo.startsWith('data:')) {
    document.getElementById('opsLogoPreviewImg').src = o.logo;
    document.getElementById('opsLogoPreview').style.display = 'block';
  }
  if (o.coverPhoto) {
    document.getElementById('opsCoverPreviewImg').src = o.coverPhoto;
    document.getElementById('opsCoverPreview').style.display = 'block';
  }
  document.getElementById('orgPageSettingsModal').classList.add('open');
}

// File readers for settings modal
document.addEventListener('change', function (ev) {
  const handlers = {
    opsLogoFile: ['opsLogoData', 'opsLogoPreviewImg', 'opsLogoPreview'],
    opsCoverFile: ['opsCoverData', 'opsCoverPreviewImg', 'opsCoverPreview'],
    coCoverFile: ['coCoverData', 'coCoverPreviewImg', 'coCoverPreview'],
  };
  const h = handlers[ev.target.id];
  if (!h) return;
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    document.getElementById(h[0]).value = e.target.result;
    document.getElementById(h[1]).src   = e.target.result;
    document.getElementById(h[2]).style.display = 'block';
  };
  r.readAsDataURL(f);
});

function openCreateOrgModal() {
  if (CU && CU.role !== 'admin' && ownedOrg()) return toast('You already manage an organization.', 'error');
  document.getElementById('createOrgModal').classList.add('open');
}

/* ============================================================
   19) ADMIN ORGS TAB
   ============================================================ */
function renderAdminOrgsTab() {
  const c    = document.getElementById('adminTabContent');
  const orgs = DB.organizations || [];
  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:6px 4px;flex-wrap:wrap;gap:10px">
      <div style="font-weight:700;font-size:15px">All Organizations (${orgs.length})</div>
      <button class="btn btn-primary btn-sm" onclick="openAdminCreateOrg()">+ Create Organization</button>
    </div>
    ${orgs.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Organization</th><th>Category</th><th>Manager</th><th>Posts</th><th>Followers</th><th>Actions</th></tr></thead><tbody>
      ${orgs.map(o => {
        const u = DB.users.find(x => x.id === o.organizerId);
        return `<tr>
          <td><div style="display:flex;gap:10px;align-items:center">${orgLogoHtml(o, 36)}<div><strong>${escapeHtml(o.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml((o.description || '').slice(0, 60))}</span></div></div></td>
          <td>${escapeHtml(o.category || '—')}</td>
          <td>${u ? escapeHtml(u.name) : '<em>unassigned</em>'}</td>
          <td>${orgPostCount(o.id)}</td>
          <td>${orgFollowerCount(o.id)}</td>
          <td><div class="tbl-actions">
            <button class="btn btn-outline btn-sm" onclick="openOrgProfile('${o.id}')">View</button>
            <button class="btn btn-outline btn-sm" onclick="adminEditOrg('${o.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="adminDeleteOrg('${o.id}')">Delete</button>
          </div></td>
        </tr>`;
      }).join('')}
    </tbody></table></div>` : '<div class="empty-state"><span class="ico">🏢</span><h4>No organizations yet</h4></div>'}
    <div id="adminOrgEditor"></div>`;
}

function openAdminCreateOrg() { adminOrgEditor(null); }
function adminEditOrg(oid)    { adminOrgEditor(oid); }

function adminOrgEditor(oid) {
  const o = oid ? getOrgById(oid) : { id: '', name: '', description: '', logo: '🏢', coverPhoto: '', organizerId: '', category: 'Academic', socialLinks: { facebook: '', instagram: '' } };
  const candidates = DB.users.filter(u => u.role !== 'admin');
  const w = document.getElementById('adminOrgEditor');
  w.innerHTML = `<div class="panel" style="margin-top:18px">
    <div class="panel-head"><div class="panel-title">${oid ? 'Edit' : 'Create'} Organization</div></div>
    <div class="panel-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;flex-wrap:wrap">
        <div><label style="font-size:12px;font-weight:600;color:var(--text-muted)">Name</label><input id="aoName" class="filter-select" style="width:100%;background:#fff" value="${escapeHtml(o.name)}"></div>
        <div><label style="font-size:12px;font-weight:600;color:var(--text-muted)">Category</label>
          <select id="aoCat" class="filter-select" style="width:100%;background:#fff">
            ${['Academic','Cultural','Sports','Seminar','Workshop','Community','General'].map(c => `<option ${o.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="margin-top:10px"><label style="font-size:12px;font-weight:600;color:var(--text-muted)">Description</label><textarea id="aoDesc" class="filter-select" style="width:100%;background:#fff;min-height:70px;resize:vertical">${escapeHtml(o.description || '')}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;flex-wrap:wrap">
        <div><label style="font-size:12px;font-weight:600;color:var(--text-muted)">Assign Organizer</label>
          <select id="aoUser" class="filter-select" style="width:100%;background:#fff">
            <option value="">— Select user —</option>
            ${candidates.map(u => `<option value="${u.id}" ${o.organizerId === u.id ? 'selected' : ''}>${escapeHtml(u.name)} · ${u.role} · ${escapeHtml(u.email)}</option>`).join('')}
          </select>
        </div>
        <div><label style="font-size:12px;font-weight:600;color:var(--text-muted)">Logo emoji</label>
          <input id="aoLogoEmoji" class="filter-select" style="width:100%;background:#fff" value="${o.logo && !o.logo.startsWith('data:') ? escapeHtml(o.logo) : ''}" placeholder="e.g. 🎭">
          <input type="file" accept="image/*" onchange="readImg(this,'aoLogoData')" style="margin-top:6px">
          <input type="hidden" id="aoLogoData" value="${o.logo && o.logo.startsWith('data:') ? o.logo : ''}">
        </div>
      </div>
      <div style="margin-top:10px"><label style="font-size:12px;font-weight:600;color:var(--text-muted)">Cover photo</label>
        <input type="file" accept="image/*" onchange="readImg(this,'aoCoverData')">
        <input type="hidden" id="aoCoverData" value="${o.coverPhoto || ''}">
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="adminSaveOrg('${oid || ''}')">${oid ? 'Save Changes' : 'Create Organization'}</button>
        <button class="btn btn-outline" onclick="document.getElementById('adminOrgEditor').innerHTML=''">Cancel</button>
      </div>
    </div>
  </div>`;
  w.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/* ============================================================
   20) POST RENDERING
   ============================================================ */
function toggleSeeMore(pid) {
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  p._expanded = !p._expanded;
  const el  = document.getElementById('post_text_' + pid);
  const btn = document.getElementById('post_seemore_' + pid);
  if (!el || !btn) return;
  if (p._expanded) { el.textContent = p.content; btn.textContent = ' See less'; }
  else             { el.textContent = p.content.slice(0, 100) + '…'; btn.textContent = ' See more'; }
}
function renderMediaGrid4Plus(urls, imgClickHandler) {
  const visible = urls.slice(0, 4);
  const extra   = urls.length - 4;

  // PATCH 008: Fixed grid using explicit pixel row heights.
  // Root fix: replaced height:100% (which collapses in auto-row grids)
  // with explicit aspect-ratio on a properly sized grid.
  // The grid uses two equal columns, two explicit rows of 200px each.
  // img[0] spans both rows (400px tall total), imgs[1-3] each get one row (200px).

  const ROW_H = '200px'; // single row height — thumbnail row

  const img0 = `<img 
    src="${escapeHtml(visible[0])}" 
    style="grid-column:1/2;grid-row:1/3;width:100%;height:400px;object-fit:cover;cursor:pointer;display:block;min-width:0" 
    ${imgClickHandler(0)} 
    loading="lazy" 
    alt="">`;

  const img1 = `<img 
    src="${escapeHtml(visible[1])}" 
    style="grid-column:2/3;grid-row:1/2;width:100%;height:${ROW_H};object-fit:cover;cursor:pointer;display:block;min-width:0" 
    ${imgClickHandler(1)} 
    loading="lazy" 
    alt="">`;

  // img[2] and img[3]/overlay share row 2 col 2 — stacked vertically
  // We use a nested column for the right side to fit 2 images
  const rightCol = (() => {
    if (visible.length === 3) {
      // Only 3 images loaded into 4-slot: show img[2] in right-bottom
      return `<img 
        src="${escapeHtml(visible[2])}" 
        style="grid-column:2/3;grid-row:2/3;width:100%;height:${ROW_H};object-fit:cover;cursor:pointer;display:block;min-width:0" 
        ${imgClickHandler(2)} 
        loading="lazy" 
        alt="">`;
    }
    // 4 images: split right column into top (img1) and bottom-split (img2+img3/overlay)
    const img2 = `<img 
      src="${escapeHtml(visible[2])}" 
      style="width:100%;height:100%;object-fit:cover;cursor:pointer;display:block;min-width:0" 
      ${imgClickHandler(2)} 
      loading="lazy" 
      alt="">`;

    const img3 = extra > 0
      ? `<div style="position:relative;width:100%;height:100%;overflow:hidden;cursor:pointer;display:block" ${imgClickHandler(3)}>
           <img src="${escapeHtml(visible[3])}" style="width:100%;height:100%;object-fit:cover;display:block;filter:brightness(.45)" loading="lazy" alt="">
           <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.6)">+${extra + 1}</div>
         </div>`
      : `<img 
           src="${escapeHtml(visible[3])}" 
           style="width:100%;height:100%;object-fit:cover;cursor:pointer;display:block;min-width:0" 
           ${imgClickHandler(3)} 
           loading="lazy" 
           alt="">`;

    // Right-bottom cell: 2 items side by side in a sub-grid
    return `<div style="grid-column:2/3;grid-row:2/3;display:grid;grid-template-columns:1fr 1fr;gap:3px;height:${ROW_H};min-width:0">
      ${img2}
      ${img3}
    </div>`;
  })();

  return `<div class="fb-post-media" style="overflow:hidden;width:100%;max-width:100%">
    <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:${ROW_H} ${ROW_H};gap:3px;width:100%;overflow:hidden">
      ${img0}
      ${img1}
      ${rightCol}
    </div>
  </div>`;
}

function renderFbPostHtml(p, isOwner) {
  const o = getOrgById(p.organizationId);
  const liked    = CU && (p.likedBy || []).includes(CU.id);
  const comments = p.comments || [];
  const showAll  = p._showAllComments || false;
  const displayComments = showAll ? comments : comments.slice(-3);

  // Build media grid
  let media = '';
const urls = (() => {
  if (Array.isArray(p.mediaUrls) && p.mediaUrls.length) return p.mediaUrls.filter(u => u);
  if (p.type === 'photo' && p.mediaUrl) return [p.mediaUrl];
  return [];
})();  
  // PATCH 003 FIX: Store URLs in safe way instead of embedding JSON in HTML
  // Use a unique ID to reference URLs from global store
  const urlsStoreId = 'post_urls_' + p.id;
  window._postMediaUrls = window._postMediaUrls || {};
  window._postMediaUrls[urlsStoreId] = urls;
  
  // Helper to generate safe onclick that retrieves URLs from store
  const imgClickHandler = (idx) => `onclick="openLightboxSafe('${urlsStoreId}',${idx})"`;
  
  if (p.type === 'video' && p.mediaUrl) {
    media = `<div class="fb-post-media"><video src="${escapeHtml(p.mediaUrl)}" controls style="width:100%;max-height:420px;display:block;background:#000"></video></div>`;
  } else if (urls.length === 1) {
    media = `<div class="fb-post-media"><img src="${escapeHtml(urls[0])}" style="width:100%;max-height:520px;object-fit:cover;display:block;cursor:pointer" ${imgClickHandler(0)} loading="lazy"></div>`;
  } else if (urls.length === 2) {
    media = `<div class="fb-post-media"><div style="display:grid;grid-template-columns:1fr 1fr;gap:3px">
      ${urls.map((u, i) => `<img src="${escapeHtml(u)}" style="width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;display:block" ${imgClickHandler(i)} loading="lazy">`).join('')}
    </div></div>`;
  } else if (urls.length === 3) {
    media = `<div class="fb-post-media"><div style="display:grid;grid-template-columns:1fr 1fr;gap:3px">
      <img src="${escapeHtml(urls[0])}" style="width:100%;min-height:200px;object-fit:cover;cursor:pointer;grid-row:span 2;display:block" ${imgClickHandler(0)} loading="lazy">
      <img src="${escapeHtml(urls[1])}" style="width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;display:block" ${imgClickHandler(1)} loading="lazy">
      <img src="${escapeHtml(urls[2])}" style="width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;display:block" ${imgClickHandler(2)} loading="lazy">
    </div></div>`;
} else if (urls.length >= 4) {
  media = renderMediaGrid4Plus(urls, (idx) => `onclick="openLightboxSafe('${urlsStoreId}',${idx})"`);
}

  const avatarHtml = o
    ? (o.logo && o.logo.startsWith('data:')
        ? `<div class="fb-post-org-avatar"><img src="${o.logo}" style="width:100%;height:100%;object-fit:cover"></div>`
        : `<div class="fb-post-org-avatar">${escapeHtml(o.logo || '🏢')}</div>`)
    : '<div class="fb-post-org-avatar">🏢</div>';

  const commentsHtml = displayComments.map(c => {
    const canDel = isOwner || (CU && CU.id === c.userId);
    return `<div class="fb-comment-item">
      <div class="fb-comment-avatar">${(c.userName || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}</div>
      <div class="fb-comment-bubble">
        <div class="fb-comment-author">${escapeHtml(c.userName || 'User')}</div>
        <div class="fb-comment-text">${escapeHtml(c.text)}</div>
        <div class="fb-comment-meta">${timeAgo(c.createdAt)}${canDel ? ` · <span style="color:var(--danger);cursor:pointer;font-weight:600" onclick="deleteComment('${p.id}','${c.id}')">Delete</span>` : ''}</div>
      </div>
    </div>`;
  }).join('');

  const commentInput = CU ? `<div class="fb-comment-input-row">
    <div class="fb-comment-avatar">${CU.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}</div>
    <input id="cmt_${p.id}" class="fb-comment-input" placeholder="Write a comment…" onkeydown="if(event.key==='Enter')addComment('${p.id}')">
    <button class="btn btn-primary btn-sm" onclick="addComment('${p.id}')">Post</button>
  </div>` : '';

  const likeCount    = p.likes || 0;
  const commentCount = comments.length;
  const MAX_LEN      = 200;
  const needsTruncate= p.content && p.content.length > MAX_LEN;
  const isExpanded   = p._expanded || false;
  let postTextHtml = '';
  if (p.content) {
    const displayText = needsTruncate && !isExpanded ? p.content.slice(0, MAX_LEN) + '…' : p.content;
    postTextHtml = `<div class="fb-post-text"><span id="post_text_${p.id}">${escapeHtml(displayText)}</span>${needsTruncate ? `<span id="post_seemore_${p.id}" onclick="toggleSeeMore('${p.id}')" style="color:var(--csu-green-dark);font-weight:600;cursor:pointer;font-size:13px;white-space:nowrap"> ${isExpanded ? 'See less' : 'See more'}</span>` : ''}</div>`;
  }

  const ownerBtns = isOwner ? `<div style="display:flex;gap:6px;flex-shrink:0">
    <button class="btn btn-outline btn-sm" onclick="openEditPost('${p.id}')" style="padding:5px 10px;font-size:12px">✏️</button>
    <button class="btn btn-danger btn-sm" onclick="deleteOrgPost('${p.id}')" style="padding:5px 10px;font-size:12px">🗑️</button>
  </div>` : '';

  const editedBadge = p.editedAt ? ` · <span style="font-size:11px;color:var(--text-soft);font-style:italic">Edited</span>` : '';

  return `<div class="fb-post" id="post_${p.id}">
    <div class="fb-post-header">
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div class="fb-post-orgname" onclick="openOrgProfile('${p.organizationId}')" style="cursor:pointer">${escapeHtml(o ? o.name : 'Organization')}</div>
        <div class="fb-post-time">${timeAgo(p.createdAt)}${editedBadge}</div>
      </div>
      ${ownerBtns}
    </div>
    ${postTextHtml}
    ${media}
    ${(likeCount || commentCount) ? `<div class="fb-post-reactions">
      <span class="fb-reaction-count">${likeCount ? '❤️ ' + likeCount : ''}</span>
      <span class="fb-reaction-count" style="cursor:pointer" onclick="toggleComments('${p.id}')">${commentCount ? '💬 ' + commentCount + ' comment' + (commentCount === 1 ? '' : 's') : ''}</span>
    </div>` : ''}
    <div class="fb-post-actions">
      <button class="fb-action-btn ${liked ? 'liked' : ''}" onclick="likePost('${p.id}')">${liked ? '❤️' : '🤍'} Like</button>
      <button class="fb-action-btn" onclick="toggleComments('${p.id}')">💬 Comment</button>
      <button class="fb-action-btn" onclick="sharePost('${p.id}')">↗ Share</button>
    </div>
    <div id="comments_${p.id}" style="display:none" class="fb-comments-wrap">
      ${comments.length > 3 && !showAll ? `<div style="font-size:13px;color:var(--csu-green-dark);font-weight:600;cursor:pointer;margin-bottom:8px" onclick="showAllComments('${p.id}')">View all ${comments.length} comments</div>` : ''}
      ${commentsHtml}${commentInput}
    </div>
  </div>`;
}


function toggleComments(pid) {
  const el = document.getElementById('comments_' + pid);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function showAllComments(pid) {
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  p._showAllComments = true;
  refreshPost(pid);
}
function refreshPost(pid) {
  const p  = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  const el = document.getElementById('post_' + pid);
  if (!el) return;
  const o = getOrgById(p.organizationId);
  const isOwner = CU && o && o.organizerId === CU.id;
  const newEl = document.createElement('div');
  newEl.innerHTML = renderFbPostHtml(p, isOwner);
  el.replaceWith(newEl.firstChild);
  // Re-open comments if they were open
  const cd = document.getElementById('comments_' + pid);
  if (cd) cd.style.display = 'block';
}

function sharePost(pid) {
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  const o    = getOrgById(p.organizationId);
  const text = (o ? o.name + ': ' : '') + p.content;
  if (navigator.share) { navigator.share({ title: o ? o.name : 'Post', text }).catch(() => {}); }
  else { navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!')); }
}

function openEditPost(pid) {
  if (!CU) return;
  const p = DB.organizationPosts.find(x => x.id === pid);
  if (!p) return;
  const o = getOrgById(p.organizationId);
  if (!o || o.organizerId !== CU.id) return toast("You can only edit your organization's posts", 'error');
  _editPostPhotos = Array.isArray(p.mediaUrls) && p.mediaUrls.length ? [...p.mediaUrls] : (p.mediaUrl ? [p.mediaUrl] : []);

  let modal = document.getElementById('editPostModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id        = 'editPostModal';
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-card" style="max-width:560px">
      <div class="modal-head"><div class="modal-title">✏️ Edit Post</div><span class="modal-close" onclick="closeModal('editPostModal')">×</span></div>
      <div class="modal-body">
        <div class="field"><label>Post Text</label><textarea id="editPostText" class="field" style="width:100%;min-height:100px;resize:vertical;border:1.5px solid var(--border);border-radius:9px;padding:11px 14px;font-family:inherit;font-size:14px;outline:none" placeholder="What's on your mind?"></textarea></div>
        <div class="field" style="margin-top:4px">
          <label>Images</label>
          <div id="editPostPhotoThumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>
          <label style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1.5px dashed var(--border2);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-muted);font-weight:600">
            📸 Add Photos
            <input type="file" accept="image/*" multiple style="display:none" onchange="handleEditPostPhotos(event)">
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-outline" onclick="closeModal('editPostModal')">Cancel</button>
        <button class="btn btn-primary" onclick="saveEditPost()">Save Changes</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('editPostText').value = p.content || '';
  modal.dataset.pid = pid;
  renderEditPostThumbs();
  modal.classList.add('open');
}

function renderEditPostThumbs() {
  const wrap = document.getElementById('editPostPhotoThumbs');
  if (!wrap) return;
  if (!_editPostPhotos.length) { wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No images</span>'; return; }
  wrap.innerHTML = _editPostPhotos.map((src, i) => `
    <div style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
      <img src="${src}" style="width:100%;height:100%;object-fit:cover">
      <button onclick="removeEditPostPhoto(${i})" style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;border:none;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center">×</button>
    </div>`).join('');
}
function removeEditPostPhoto(idx) { _editPostPhotos.splice(idx, 1); renderEditPostThumbs(); }
function handleEditPostPhotos(ev) {
  const files     = Array.from(ev.target.files || []);
  const remaining = 5 - _editPostPhotos.length;
  if (remaining <= 0) return toast('Max 5 photos per post', 'warning');
  let loaded = 0; const toLoad = files.slice(0, remaining);
  toLoad.forEach(f => {
    if (f.size > 5 * 1024 * 1024) { toast('Image too large (max 5MB)', 'warning'); loaded++; if (loaded === toLoad.length) renderEditPostThumbs(); return; }
    const r = new FileReader();
    r.onload = e => { _editPostPhotos.push(e.target.result); loaded++; if (loaded === toLoad.length) renderEditPostThumbs(); };
    r.readAsDataURL(f);
  });
  ev.target.value = '';
}

/* ============================================================
   21) LIGHTBOX  (single clean definition — no duplicates)
   ============================================================ */
   // PATCH 003 FIX: Safe wrapper to retrieve URLs from global store
function openLightboxSafe(storeId, idx) {
  const urls = window._postMediaUrls && window._postMediaUrls[storeId];
  if (!urls || !Array.isArray(urls) || !urls.length) {
    console.error('Lightbox: URLs not found for', storeId);
    return;
  }
  openLightbox(urls, idx);
}
function openLightbox(urls, idx) {
  if (typeof urls === 'string') { try { urls = JSON.parse(urls); } catch (e) { urls = [urls]; } }
  if (!Array.isArray(urls) || !urls.length) return;
  idx = Math.max(0, Math.min(idx, urls.length - 1));
  _lbUrls = urls; _lbIdx = idx;

  const old = document.getElementById('photoLightbox');
  if (old) old.remove();

  const lb = document.createElement('div');
  lb.id = 'photoLightbox';
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:16px;animation:lbFadeIn .18s ease';

  lb.innerHTML = `
    <button id="lbClose" onclick="closeLightbox()" title="Close (ESC)">×</button>
    <img id="lbImg" src="" alt="" draggable="false">
    <div id="lbRow">
      <button class="lb-nav" id="lbPrev" onclick="lbNav(-1)" title="Previous">‹</button>
      <span id="lbCount"></span>
      <button class="lb-nav" id="lbNext" onclick="lbNav(1)" title="Next">›</button>
    </div>`;

  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.body.appendChild(lb);
  document.body.style.overflow = 'hidden';

  window._lbKeyHandler = e => {
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
  };
  document.addEventListener('keydown', window._lbKeyHandler);

  let _tsX = null;
  lb.addEventListener('touchstart', e => { _tsX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend',   e => {
    if (_tsX === null) return;
    const dx = e.changedTouches[0].clientX - _tsX;
    if (Math.abs(dx) > 50) lbNav(dx < 0 ? 1 : -1);
    _tsX = null;
  }, { passive: true });

  lbShow();
}

function closeLightbox() {
  document.getElementById('photoLightbox')?.remove();
  document.body.style.overflow = '';
  if (window._lbKeyHandler) { document.removeEventListener('keydown', window._lbKeyHandler); window._lbKeyHandler = null; }
}

function lbShow() {
  const img  = document.getElementById('lbImg');
  const cnt  = document.getElementById('lbCount');
  const prev = document.getElementById('lbPrev');
  const next = document.getElementById('lbNext');
  if (!img) return;
  img.style.opacity = '0';
  setTimeout(() => {
    img.src    = _lbUrls[_lbIdx];
    img.onload = () => { img.style.opacity = '1'; };
    if (img.complete) img.style.opacity = '1';
  }, 80);
  if (cnt)  cnt.textContent = _lbUrls.length > 1 ? `${_lbIdx + 1} / ${_lbUrls.length}` : '';
  if (prev) prev.disabled = _lbUrls.length <= 1;
  if (next) next.disabled = _lbUrls.length <= 1;
}

function lbNav(dir) { _lbIdx = (_lbIdx + dir + _lbUrls.length) % _lbUrls.length; lbShow(); }

/* ============================================================
   22) GLOBAL SEARCH
   ============================================================ */
function globalSearch(q) {
  const drop = document.getElementById('searchDrop');
  q = (q || '').toLowerCase().trim();
  if (!q) { drop.classList.remove('show'); return; }
  const evts = DB.events.filter(e => e.status === 'approved' && (e.title.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))).slice(0, 4);
  const orgs = CU ? (DB.organizations || []).filter(o => o.name.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q) || (o.category || '').toLowerCase().includes(q)).slice(0, 3) : [];
  const results = [
    ...evts.map(e => ({ type: 'event', id: e.id, icon: e.icon || '🎉', title: e.title, meta: e.category + ' · ' + formatDate(e.date) })),
    ...orgs.map(o => ({ type: 'org', id: o.id, icon: (o.logo && !o.logo.startsWith('data:')) ? o.logo : '🏢', title: o.name, meta: 'Organization · ' + orgFollowerCount(o.id) + ' followers' }))
  ];
  if (!results.length) {
    drop.innerHTML = '<div class="search-result-item"><div class="search-result-info"><div class="search-result-meta">No results found</div></div></div>';
    drop.classList.add('show');
    return;
  }
  drop.innerHTML = results.map(r => {
    const action = r.type === 'event' ? `viewEvent('${r.id}');` : `openOrgProfile('${r.id}');`;
    return `<div class="search-result-item" onclick="${action}document.getElementById('globalSearchInput').value='';document.getElementById('searchDrop').classList.remove('show');">
      <div class="search-result-thumb">${r.icon}</div>
      <div class="search-result-info">
        <div class="search-result-title">${escapeHtml(r.title)}</div>
        <div class="search-result-meta">${r.meta}</div>
      </div>
      <span style="font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;text-transform:uppercase;background:${r.type === 'event' ? 'var(--csu-green-soft)' : 'var(--csu-gold-soft)'};color:${r.type === 'event' ? 'var(--csu-green-dark)' : 'var(--csu-gold-dark)'}">${r.type === 'event' ? 'Event' : 'Org'}</span>
    </div>`;
  }).join('');
  drop.classList.add('show');
}

/* ============================================================
   23) ANNOUNCEMENT
   ============================================================ */
function openAnnouncement() {
  document.getElementById('annInput').value = '';
  document.getElementById('annModal').classList.add('open');
}

/* ============================================================
   24) MOBILE MENU
   ============================================================ */
function openMobileMenu() {
  if (!CU) return;
  const overlay = document.getElementById('mobileMenuOverlay');
  const menu    = document.getElementById('mobileMenu');
  if (!overlay || !menu) return;
  const init = CU.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('mobileUserAvatar').textContent = init;
  document.getElementById('mobileUserName').textContent   = CU.name;
  document.getElementById('mobileUserEmail').textContent  = CU.email;
  document.getElementById('mobileUserRole').textContent   = CU.role === 'admin' ? 'Admin' : CU.role === 'organizer' ? 'Organizer' : 'Student';
  overlay.classList.add('open');
  menu.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu() {
  document.getElementById('mobileMenuOverlay')?.classList.remove('open');
  document.getElementById('mobileMenu')?.classList.remove('open');
  document.body.style.overflow = '';
}
function goToDashboard() {
  if (!CU) return;
  closeMobileMenu();
  if (CU.role === 'admin') showPage('admin');
  else if (CU.role === 'organizer') showPage('organizer');
  else showPage('dashboard');
}
function ecrScrollTo(headId, tabEl) {
  document.querySelectorAll('.ecr-section-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');

  const upcomingHead = document.getElementById('browseUpcomingHead');
  const upcomingList = document.getElementById('browseUpcoming');
  const pastHead     = document.getElementById('browsePastHead');
  const pastList     = document.getElementById('browsePast');

  if (headId === 'browseUpcomingHead') {
    if (upcomingHead) upcomingHead.style.display = 'flex';
    if (upcomingList) upcomingList.style.display = 'flex';
    if (pastHead)     pastHead.style.display     = 'none';
    if (pastList)     pastList.style.display     = 'none';
  } else {
    if (upcomingHead) upcomingHead.style.display = 'none';
    if (upcomingList) upcomingList.style.display = 'none';
    if (pastHead)     pastHead.style.display     = 'flex';
    if (pastList)     pastList.style.display     = 'flex';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function goBrowseEvents() { showPage('browse'); }

/* ============================================================
   25) BOOT
   ============================================================ */
(async function boot() {
  await loadDB();
  renderNav();
  const lastPage = localStorage.getItem('cems_current_page');
  if (CU) {
    if (lastPage && userHasAccess(lastPage) && lastPage !== 'orgprofile') showPage(lastPage);
    else showPage(CU.role === 'admin' ? 'admin' : CU.role === 'organizer' ? 'organizer' : 'dashboard');
  } else {
    showPage('home');
  }

  // Polling: only when tab is visible and no modal is open
setInterval(async () => {
    if (!document.hidden && !document.querySelector('.modal.open')) {
      await loadDB();   // fully awaited before render
      // Small yield to ensure DB object is fully settled before render
      setTimeout(() => refreshAll(), 0);
    }
  }, 30000);
})();