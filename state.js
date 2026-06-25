/* ============================================================
   state.js — all localStorage state management
   Loaded by both index.html and lesson.html (plain script).
   ============================================================ */

const STORE_BASE = 'matriBhasa_v3';
/* progress is namespaced per logged-in account, so each user has their own
   XP / streak / completed lessons (falls back to 'guest' if not signed in) */
function storeKey() {
  let uid = 'guest';
  try {
    const s = JSON.parse(localStorage.getItem('matriBhasa_session'));
    if (s && s.userId) uid = s.userId;
  } catch (e) {}
  return STORE_BASE + '_' + uid;
}

/* ── Level system: 6 levels by total XP ── */
const LEVELS = [
  { name: 'Seedling', icon: '🌱', xp: 0 },
  { name: 'Sprout',   icon: '🌿', xp: 60 },
  { name: 'Learner',  icon: '📖', xp: 150 },
  { name: 'Speaker',  icon: '🗣️', xp: 300 },
  { name: 'Fluent',   icon: '🌟', xp: 600 },
  { name: 'Master',   icon: '🏆', xp: 1200 },
];

/* ── 8 badges with unlock conditions ── */
const BADGES = [
  { id: 'first-step',   name: 'First step',   icon: '👣', desc: 'Complete 1 lesson',      test: s => lessonsDone(s) >= 1 },
  { id: 'on-fire',      name: 'On fire',      icon: '🔥', desc: 'Reach a 3-day streak',   test: s => s.streak >= 3 },
  { id: 'xp-hunter',    name: 'XP Hunter',    icon: '⚡', desc: 'Earn 100 XP',            test: s => s.xp >= 100 },
  { id: 'dedicated',    name: 'Dedicated',    icon: '📚', desc: 'Complete 3 lessons',     test: s => lessonsDone(s) >= 3 },
  { id: 'perfectionist',name: 'Perfectionist',icon: '⭐', desc: '3 stars on any lesson',  test: s => Object.values(s.completed).some(r => r.stars >= 3) },
  { id: 'star-learner', name: 'Star learner', icon: '🌠', desc: 'Earn 500 XP',            test: s => s.xp >= 500 },
  { id: 'week-warrior', name: 'Week warrior', icon: '🗓️', desc: 'Reach a 7-day streak',   test: s => s.streak >= 7 },
  { id: 'champion',     name: 'Champion',     icon: '🏆', desc: 'Complete all 12 lessons',test: s => lessonsDone(s) >= 12 },
];

function lessonsDone(s) { return Object.keys(s.completed || {}).length; }

/* ── Date helpers ── */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function thisWeekMonday() {
  const d = new Date();
  const offset = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

/* ── Load / save ── */
function loadState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(storeKey())); } catch (e) { s = null; }
  s = Object.assign({
    xp: 0,
    streak: 0,
    lastActive: null,
    completed: {},          // { lessonId: { stars, bestXp, attempts } }
    weeklyXp: 0,
    weekStart: thisWeekMonday(),
  }, s || {});
  // roll the weekly counter over when a new week begins
  if (s.weekStart !== thisWeekMonday()) {
    s.weekStart = thisWeekMonday();
    s.weeklyXp = 0;
  }
  return s;
}

function saveState(s) {
  localStorage.setItem(storeKey(), JSON.stringify(s));
}

/* ── Streak: increment if yesterday, reset if gap > 1 day, no-op if already today ── */
function bumpStreak(s) {
  const today = todayStr();
  if (s.lastActive === today) return s;        // already counted today
  if (s.lastActive === yesterdayStr()) s.streak += 1;
  else s.streak = 1;                            // first day, or streak broken
  s.lastActive = today;
  saveState(s);
  return s;
}

/* ── XP ── */
function awardXp(s, amount) {
  s.xp += amount;
  s.weeklyXp += amount;
  saveState(s);
  return s;
}

/* ── Lesson records ── */
function recordLesson(s, lessonId, stars, xp) {
  const prev = s.completed[lessonId] || { stars: 0, bestXp: 0, attempts: 0 };
  s.completed[lessonId] = {
    stars: Math.max(prev.stars, stars),
    bestXp: Math.max(prev.bestXp, xp),
    attempts: prev.attempts + 1,
  };
  saveState(s);
  return s;
}

function lessonRecord(s, lessonId) {
  return s.completed[lessonId] || null;
}

/* ── Unlock gate: a lesson is available once total XP meets its tier requirement ── */
function isUnlocked(s, lesson) {
  return s.xp >= lesson.reqXp;
}

/* ── Level lookup + progress toward next level ── */
function getLevel(s) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (s.xp >= LEVELS[i].xp) idx = i;
  }
  const level = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const floor = level.xp;
  const ceil = next ? next.xp : level.xp;
  const span = next ? ceil - floor : 0;
  const intoLevel = s.xp - floor;
  const pct = next ? Math.min(100, Math.round(intoLevel / span * 100)) : 100;
  return { index: idx, level, next, floor, ceil, span, intoLevel, pct };
}

/* ── Badges with earned flag ── */
function earnedBadges(s) {
  return BADGES.map(b => ({ ...b, earned: b.test(s) }));
}
