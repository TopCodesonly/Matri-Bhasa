/* ============================================================
   app.js — shared helpers for every page (nav HUD, speech, toast)
   Loaded after data.js + state.js on each page.
   ============================================================ */

/* ── Speech (Web Speech API) ── */
function speakText(text, btn) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ne-NP'; u.rate = 0.85;
  if (btn) { btn.classList.add('speaking'); u.onend = u.onerror = () => btn.classList.remove('speaking'); }
  speechSynthesis.speak(u);
}

/* ── XP toast (bottom-center) ── */
let _toastTimer;
function showToast(text) {
  const t = document.getElementById('xpToast');
  if (!t) return;
  document.getElementById('xpToastText').textContent = text;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ── Nav chips (streak / XP / level) ── */
function renderHud(state) {
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  const lv = getLevel(state);
  set('streakVal', state.streak);
  set('xpVal', state.xp);
  set('levelVal', lv.level.name);
}

/* ── When a page is opened with ?xp=N (returning from a lesson) ── */
function consumeXpParam() {
  const gained = parseInt(new URLSearchParams(location.search).get('xp'), 10);
  if (gained > 0) {
    setTimeout(() => showToast('+' + gained + ' XP earned!'), 500);
    ['chipStreak', 'chipXp', 'chipLevel'].forEach(id => {
      const e = document.getElementById(id); if (e) e.classList.add('pop');
    });
    history.replaceState(null, '', location.pathname);
  }
}

/* ── Auth gate: every page that loads app.js requires a signed-in user.
   Redirects to login.html if not, otherwise shows the nav user chip. ── */
if (typeof requireAuth === 'function') {
  if (requireAuth()) renderUserChip();
}
