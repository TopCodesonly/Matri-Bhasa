/* ============================================================
   auth.js — local account "database" + authentication
   ------------------------------------------------------------
   Storage (the personal local database lives in localStorage):
     matriBhasa_users    → { userId: {account record} }
     matriBhasa_session  → { userId, at }   (keeps you logged in)
     matriBhasa_otp      → { code, target, purpose, expires, ... }

   NOTE: A static, offline app cannot actually send an SMS/email
   OTP (that needs a backend + provider secrets), so the code is
   generated locally and shown on screen in "demo mode". The
   verification flow itself is real. Google sign-in is simulated
   locally (real OAuth needs a Google Cloud Client ID + hosted
   origin — see GOOGLE_CLIENT_ID below).
   ============================================================ */

const USERS_KEY = 'matriBhasa_users';
const SESSION_KEY = 'matriBhasa_session';
const OTP_KEY = 'matriBhasa_otp';

/* Drop a real OAuth client id here to enable genuine Google Sign-In
   (also requires serving over http(s) with this origin authorised). */
const GOOGLE_CLIENT_ID = '';

/* ── the "database" ── */
function getUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch (e) { return {}; } }
function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

function normEmail(e) { return (e || '').trim().toLowerCase(); }
function normPhone(p) { return (p || '').replace(/[^\d+]/g, ''); }
function newId() { return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function findByEmail(email) { const e = normEmail(email); return Object.values(getUsers()).find(u => u.email && u.email === e); }
function findByPhone(phone) { const p = normPhone(phone); return Object.values(getUsers()).find(u => u.phone && u.phone === p); }
function findByUsername(name) { const n = (name || '').trim().toLowerCase(); return Object.values(getUsers()).find(u => u.username && u.username.toLowerCase() === n); }

function createUser(rec) {
  const users = getUsers();
  const id = newId();
  users[id] = Object.assign({ id, createdAt: Date.now(), verified: false }, rec);
  saveUsers(users);
  return users[id];
}
function updateUser(id, patch) {
  const users = getUsers();
  if (!users[id]) return null;
  users[id] = Object.assign(users[id], patch);
  saveUsers(users);
  return users[id];
}

/* ── password hashing (Web Crypto, SHA-256) ── */
async function hashPassword(pw) {
  const data = new TextEncoder().encode(pw + '::matribhasa-salt');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── session ── */
function setSession(userId) { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, at: Date.now() })); }
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
function currentUser() { const s = getSession(); return s ? (getUsers()[s.userId] || null) : null; }
function logout() { localStorage.removeItem(SESSION_KEY); location.href = 'login.html'; }

/* ── OTP (generated locally; "delivered" by showing it in demo mode) ── */
function genOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }
function issueOtp(target, purpose, extra) {
  const code = genOtp();
  const rec = Object.assign({ code, target, purpose, expires: Date.now() + 5 * 60 * 1000 }, extra || {});
  localStorage.setItem(OTP_KEY, JSON.stringify(rec));
  return code;            // returned so the UI can display it (no real SMS/email)
}
function readOtp() { try { return JSON.parse(localStorage.getItem(OTP_KEY)); } catch (e) { return null; } }
function verifyOtp(code) {
  const rec = readOtp();
  if (!rec) return { ok: false, reason: 'No code was requested.' };
  if (Date.now() > rec.expires) return { ok: false, reason: 'That code has expired — resend a new one.' };
  if (String(code).trim() !== rec.code) return { ok: false, reason: 'Incorrect code. Try again.' };
  return { ok: true, rec };
}
function clearOtp() { localStorage.removeItem(OTP_KEY); }

/* ── page guard + nav user chip (used on app pages, not on login) ── */
function requireAuth() {
  if (!currentUser()) { location.replace('login.html'); return false; }
  return true;
}
function renderUserChip() {
  const u = currentUser();
  const right = document.querySelector('.nav-right');
  if (!u || !right || document.getElementById('userChip')) return;
  const display = u.name || u.email || u.phone || 'You';
  const short = display.split('@')[0].split(' ')[0];
  const initial = (display.trim()[0] || 'U').toUpperCase();
  const chip = document.createElement('div');
  chip.id = 'userChip';
  chip.className = 'user-chip';
  chip.innerHTML =
    `<div class="user-avatar" title="${display}">${initial}</div>` +
    `<span class="user-name">${short}</span>` +
    `<button class="logout-btn" title="Log out">Log out</button>`;
  chip.querySelector('.logout-btn').onclick = logout;
  right.appendChild(chip);
}
