/* Grit Taskboard — app.js  (app shell: auth, boot, ops kanban host)
 * Local-first PWA. Vanilla JS + IndexedDB + Service Worker. NO backend
 * secrets, NO external CDNs.
 *
 * This file is the app shell only — DB bootstrap, local account auth, theme,
 * and screen routing. The actual product surface is app/opsboard.js (the ops
 * kanban board, synced server-side via api/ops-tasks.js / api/grit-events.js
 * through window.SidekickBackend in app/dataClient.js). Everything this file
 * used to carry for the old "Sidekick" freelancer persona (bookings,
 * invoicing, tax, documents, client CRM, portfolio, research, LINE login,
 * team billing, usage insights, notifications) was removed with that persona
 * — see AGENTS.md for the app's current scope (ops kanban with event-driven
 * card automation).
 *
 * VERSION LOCKSTEP: APP_VERSION tracks sw.js SW_VERSION and the ?v= query on
 * the precached app.js / styles.css. Bump all three together on every deploy.
 */
const APP_VERSION = '0.9.38';

// ─── DB ───────────────────────────────────────────────────────────────
// Per-uid keyed stores (guest uid = 'guest'). `opsTasks` (keyPath 'id', NO
// autoIncrement — `id` IS the stable cuid/server identity on both sides, see
// app/opsboard.js's header) is the only data store left; `users` holds local
// account credentials, `settings` holds per-account UI prefs (theme/etc, key
// prefixed `<uid>:`).
let db;
const DB_NAME = 'sidekick-v1', DB_VER = 8;
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('users')) {
        const u = d.createObjectStore('users', {keyPath:'id', autoIncrement:true});
        u.createIndex('username', 'username', {unique:true});
      }
      if (!d.objectStoreNames.contains('opsTasks')) d.createObjectStore('opsTasks', {keyPath:'id'});
      if (!d.objectStoreNames.contains('settings'))  d.createObjectStore('settings',  {keyPath:'key'});
    };
    req.onsuccess = e => {
      db = e.target.result;
      // If another tab opens a newer version, close this connection so its
      // upgrade isn't blocked (and doesn't wedge). No silent hang.
      db.onversionchange = () => { db.close(); location.reload(); };
      res(db);
    };
    req.onerror = () => rej(req.error);
    // Another tab holds an older-version connection open: surface it instead of hanging forever.
    req.onblocked = () => rej(new Error('DB upgrade blocked — close other Grit Taskboard tabs and reload.'));
  });
}
function dbAll(store) {
  return new Promise(res => {
    const tx = db.transaction(store, 'readonly');
    tx.objectStore(store).getAll().onsuccess = e => res(e.target.result);
  });
}
function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function dbAdd(store, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(obj);
    req.onsuccess = () => res(req.result);
    req.onerror = e => { e.preventDefault(); rej(req.error); };
  });
}
function dbDel(store, id) {
  return new Promise(res => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id).onsuccess = () => res();
  });
}
function dbGet(store, key) {
  return new Promise(res => {
    const tx = db.transaction(store, 'readonly');
    tx.objectStore(store).get(key).onsuccess = e => res(e.target.result);
  });
}
function dbGetByUsername(username) {
  return new Promise(res => {
    const tx = db.transaction('users', 'readonly');
    tx.objectStore('users').index('username').get(username).onsuccess = e => res(e.target.result);
  });
}
function cuid() { return crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function nowISO() { return new Date().toISOString(); }

// Every uid-scoped local store. Only 'opsTasks' remains now that the
// freelancer-persona stores are gone — kept as a named list (rather than a
// literal in each call site) since guest existence/wipe both need the exact
// same set.
const UID_SCOPED_STORES = ['opsTasks'];

// ─── AUTH ─────────────────────────────────────────────────────────────
const SESSION_KEY = 'sidekick_uid';
let currentUser = null;
let authMode = 'login';
let isGuest = false;

function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2,'0')).join('');
}
const PBKDF2_ITERS = 100000;
async function hashPassword(password, salt, iters) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', hash:'SHA-256', salt: enc.encode(salt), iterations: iters},
    key, 256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
}
function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('auth-confirm-wrap').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-name-wrap').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-submit').textContent = mode === 'register' ? 'Create account' : 'Log in';
  document.getElementById('auth-pass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  authError('');
}
function authError(msg) {
  const el = document.getElementById('auth-err');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}
// Stable per-device guest identity (label only; all guest data lives under the
// fixed uid 'guest' so leaving and re-entering guest mode restores it).
function guestUsername() {
  let u = localStorage.getItem('sidekick_guest_username');
  if (!u) {
    const n = (parseInt(localStorage.getItem('sidekick_guest_counter') || '0', 10) + 1);
    localStorage.setItem('sidekick_guest_counter', String(n));
    u = 'Guest' + String(n).padStart(6, '0');
    localStorage.setItem('sidekick_guest_username', u);
  }
  return u;
}
// Guest data lives under one fixed uid ('guest') per device, so a shared
// device's second guest sees the first guest's data by default — asking
// "resume or start fresh?" only when there's actually something to choose
// between (a brand-new guest on this device skips straight through, no
// extra tap for the common case).
async function loginGuest() {
  if (await guestDataExists()) {
    document.getElementById('s-auth').classList.remove('active');
    document.getElementById('s-guest-choice').classList.add('active');
    const nameEl = document.getElementById('guest-choice-name');
    if (nameEl) nameEl.textContent = guestUsername();
    return;
  }
  await proceedAsGuest();
}
function cancelGuestChoice() {
  document.getElementById('s-guest-choice').classList.remove('active');
  document.getElementById('s-auth').classList.add('active');
}
async function resumeGuest() { await proceedAsGuest(); }
async function startFreshGuest() {
  if (!confirm('Erase this guest’s data on this device and start fresh?')) return;
  await wipeGuestData();
  await proceedAsGuest();
}
async function proceedAsGuest() {
  isGuest = true;
  currentUser = {id: 0, username: guestUsername()};
  localStorage.setItem(SESSION_KEY, 'guest');
  sessionStorage.setItem('sidekick_post_login_toast', 'Welcome, guest!');
  location.href = './';
}
// Cheap existence check reusing UID_SCOPED_STORES — true the moment any of
// them holds a guest-uid row.
async function guestDataExists() {
  const lists = await Promise.all(UID_SCOPED_STORES.map(s => dbAll(s)));
  return lists.some(rows => rows.some(r => r.uid === 'guest'));
}
// Erases every guest-uid row across every uid-scoped store and guest-prefixed
// settings — then drops the remembered guest username/counter so the next
// guestUsername() call mints a genuinely new label, not the erased one's.
async function wipeGuestData() {
  for (const s of UID_SCOPED_STORES) {
    const rows = (await dbAll(s)).filter(r => r.uid === 'guest');
    for (const row of rows) await dbDel(s, row.id);
  }
  const settingsRows = (await dbAll('settings')).filter(r => r.key.startsWith('guest:'));
  for (const row of settingsRows) await dbDel('settings', row.key);
  localStorage.removeItem('sidekick_guest_username');
}

async function submitAuth() {
  const id0 = document.getElementById('auth-user').value.trim().toLowerCase();
  const password = document.getElementById('auth-pass').value;
  const nameEl = document.getElementById('auth-name');
  const firstName = nameEl ? nameEl.value.trim() : '';
  // Local-only accounts, keyed by email/username string.
  if (!id0 || id0.length < 3) { authError('Enter at least 3 characters.'); return; }
  if (!password || password.length < 8) { authError('Password must be at least 8 characters.'); return; }
  if (authMode === 'register') {
    if (!firstName) { authError('Enter your name.'); return; }
    if (password !== document.getElementById('auth-confirm').value) { authError('Passwords don’t match.'); return; }
    if (await dbGetByUsername(id0)) { authError('An account with that email/username already exists.'); return; }
    const salt = randomSalt();
    const iters = PBKDF2_ITERS;
    const hash = await hashPassword(password, salt, iters);
    const id = await dbAdd('users', {username:id0, salt, hash, iters, firstName, createdAt: nowISO()});
    currentUser = {id, username:id0, firstName};
    isGuest = false;
    localStorage.setItem(SESSION_KEY, String(id));
    sessionStorage.setItem('sidekick_post_login_toast', 'Welcome' + (firstName ? ', ' + firstName : '') + '!');
    location.href = './';
  } else {
    const user = await dbGetByUsername(id0);
    if (!user) { authError('No account found with that email/username.'); return; }
    const hash = await hashPassword(password, user.salt, user.iters || PBKDF2_ITERS);
    if (hash !== user.hash) { authError('Incorrect password.'); return; }
    currentUser = {id: user.id, username: user.username, firstName: user.firstName || ''};
    isGuest = false;
    localStorage.setItem(SESSION_KEY, String(user.id));
    sessionStorage.setItem('sidekick_post_login_toast', 'Welcome back' + (user.firstName ? ', ' + user.firstName : '') + '!');
    location.href = './';
  }
}
// "Continue with Grit BizSuite" — token is a pasted grit_passport JWT (see
// login.html's auth-sso field). No cross-domain cookie-sharing infra exists
// yet for a live token handoff (BACKLOG.md's suite-wide-switcher entry), so
// this mirrors grit-reports' own paste-the-JWT pattern for the same reason.
// On success the account is entirely server-side (api/auth-sso.js) — there
// is no local IndexedDB user row to look up, so the session marker carries
// enough to redisplay identity without another round trip.
async function submitSsoAuth() {
  const tokenEl = document.getElementById('auth-sso-token');
  const token = tokenEl ? tokenEl.value.trim() : '';
  if (!token) { authError('Paste your Grit BizSuite session token.'); return; }
  const r = await SidekickBackend.ssoLogin({ token });
  if (!r.ok) { authError((r.data && r.data.error) || 'Could not sign in with Grit BizSuite.'); return; }
  const { cuid, username, firstName } = r.data.user;
  currentUser = {id: 0, username, firstName: firstName || ''};
  isGuest = false;
  localStorage.setItem(SESSION_KEY, 'sso:' + cuid);
  localStorage.setItem('sidekick_sso_user', JSON.stringify({username, firstName: firstName || ''}));
  sessionStorage.setItem('sidekick_post_login_toast', 'Welcome' + (firstName ? ', ' + firstName : '') + '!');
  location.href = './';
}
async function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('sidekick_sso_user');
  SidekickBackend.logout();
  sessionStorage.setItem('sidekick_post_login_toast', 'Logged out.');
  location.href = 'login.html';
}
async function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw === 'guest') { isGuest = true; currentUser = {id: 0, username: 'Guest'}; return true; }
  if (typeof raw === 'string' && raw.startsWith('sso:')) {
    const stored = JSON.parse(localStorage.getItem('sidekick_sso_user') || 'null');
    currentUser = {id: 0, username: (stored && stored.username) || 'Grit BizSuite', firstName: (stored && stored.firstName) || ''};
    isGuest = false;
    return true;
  }
  const uid = parseInt(raw);
  if (uid) {
    const u = (await dbAll('users')).find(x => x.id === uid);
    if (u) { currentUser = {id: u.id, username: u.username, firstName: u.firstName || ''}; isGuest = false; return true; }
    localStorage.removeItem(SESSION_KEY);
  }
  return false;
}

// ─── STATE ────────────────────────────────────────────────────────────
let settings = {};

// HTML/attr escaping (shared by opsboard.js's card renderer)
function htmlEsc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function attrEsc(s) { return htmlEsc(s).replace(/"/g,'&quot;'); }

// ─── THEME ────────────────────────────────────────────────────────────
const THEME_KEY = 'sidekick_ui_theme';
function applyTheme() {
  const stored = localStorage.getItem(THEME_KEY) || 'light';
  if (stored === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = (stored === 'dark') ? 'dark' : 'light';
}
async function onThemeChange(v) {
  localStorage.setItem(THEME_KEY, (v === 'dark' || v === 'auto') ? v : 'light');
  applyTheme();
}
// Segmented Light/Dark/Auto control (More > Preferences) calls this instead
// of a <select> onchange; it just toggles which button carries `.on` and
// then defers to the same onThemeChange(v) the rest of the app already uses.
function setThemeSeg(v) {
  onThemeChange(v);
  syncThemeSeg();
}
function syncThemeSeg() {
  const wrap = document.getElementById('set-theme');
  if (!wrap) return;
  const current = localStorage.getItem(THEME_KEY) || 'light';
  wrap.querySelectorAll('[data-theme-opt]').forEach(btn => {
    btn.classList.toggle('on', btn.getAttribute('data-theme-opt') === current);
  });
}

// ─── BOOT ─────────────────────────────────────────────────────────────
function showPostLoginToast() {
  const msg = sessionStorage.getItem('sidekick_post_login_toast');
  if (msg) { sessionStorage.removeItem('sidekick_post_login_toast'); toast(msg); }
}
// login.html entry — already-authed devices skip to the app.
async function bootLogin() {
  applyTheme();
  await openDB();
  if (await restoreSession()) { location.replace('./'); return; }
  showPostLoginToast();
}
// index.html entry — no session → bounce to login.
async function bootApp() {
  applyTheme();
  { const v = document.getElementById('app-version'); if (v) v.textContent = APP_VERSION; }
  await openDB();
  if (!(await restoreSession())) { location.replace('login.html'); return; }
  await enterApp();
  showPostLoginToast();
}
function boot() {
  const page = document.body.dataset.page;
  const run = page === 'login' ? bootLogin : bootApp;
  Promise.resolve().then(run).catch(err => {
    console.error('boot failed', err);
    const msg = (err && err.message ? String(err.message) : 'storage error').replace(/[<>]/g, '');
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="padding:24px;max-width:34rem;margin:0 auto;font:15px/1.5 system-ui;color:#29201A">' +
      '<b>Couldn’t start Grit Taskboard.</b><br>' + msg +
      '<br><br>Close any other Grit Taskboard tabs and reload.</div>');
  });
}

async function enterApp() {
  document.body.classList.add('authed');
  settings = {};
  const sAll = await dbAll('settings');
  const prefix = isGuest ? 'guest:' : (currentUser.id + ':');
  sAll.forEach(s => { if (s.key.startsWith(prefix)) settings[s.key.slice(prefix.length)] = s.value; });

  applyUser();
  syncThemeSeg();
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('app-version', APP_VERSION);

  switchScreen('opsboard');
}

async function saveSetting(key, val) {
  const uid = isGuest ? 'guest' : currentUser.id;
  settings[key] = val;
  await dbPut('settings', {key: uid + ':' + key, value: val});
}

function displayName() {
  if (isGuest) return 'Guest';
  return (currentUser && currentUser.firstName) ? currentUser.firstName : (currentUser ? currentUser.username : '');
}
function applyUser() {
  const name = displayName();
  const initial = (name || '?').charAt(0).toUpperCase();
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('acct-avatar', initial);
  setTxt('acct-name', name + (isGuest ? ' · guest' : ''));
  setTxt('acct-sub', isGuest ? 'Temporary guest — data on this device only' : 'Local account');
  const logoutBtn = document.querySelector('.btn-logout');
  if (logoutBtn) logoutBtn.textContent = isGuest ? 'Exit guest' : 'Log out';
  // Guest has no stored name to edit (displayName() is fixed, not a
  // users-store field) — hide the affordance rather than open a modal that
  // has nothing real to save.
  const chevron = document.getElementById('acct-edit-chevron');
  if (chevron) chevron.style.display = isGuest ? 'none' : '';
}

function openAccountNameModal() {
  if (isGuest || !currentUser) return;
  document.getElementById('acct-name-input').value = currentUser.firstName || '';
  document.getElementById('modal-account-name').classList.add('open');
}
function closeAccountNameModal() { document.getElementById('modal-account-name').classList.remove('open'); }
async function saveAccountName() {
  const input = document.getElementById('acct-name-input');
  const name = input.value.trim();
  if (!name) { input.closest('.field')?.classList.add('field-invalid'); toast('Enter your name'); return; }
  input.closest('.field')?.classList.remove('field-invalid');
  // Fetch the full stored row rather than mutating a slim in-memory copy —
  // dbPut() is a keyPath put() that replaces the entire record.
  const row = await dbGet('users', currentUser.id);
  if (row) { row.firstName = name; await dbPut('users', row); }
  currentUser.firstName = name;
  closeAccountNameModal();
  applyUser();
  toast('Saved');
}

// ─── SCREEN ROUTING ───────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  document.getElementById('s-'+name)?.classList.add('active');
  const navBtn = document.getElementById('nav-'+name);
  if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current','page'); }
  if (name === 'opsboard' && typeof renderOpsBoard === 'function') renderOpsBoard();
  window.scrollTo(0, 0);
}

// ─── UTILS ────────────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2500);
}

// ─── PWA: service worker (registered relatively) ──────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW register failed', err));
  });
}

// submit auth with Enter (login.html)
['auth-user','auth-pass','auth-confirm'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
});

// ─── START ────────────────────────────────────────────────────────────
boot();
