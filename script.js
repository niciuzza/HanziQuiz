const STORAGE_KEY = 'hsk-vocab-words';
const STATS_KEY = 'hsk-vocab-stats';
const SESSION_KEY = 'hsk-vocab-session';
const THEME_KEY = 'hsk-vocab-theme';
const BUILTIN_LISTS = { HSK1: FULL_HSK1, HSK2: FULL_HSK2, HSK3: FULL_HSK3, HSK4: FULL_HSK4, ES1: FULL_ES1 };
let words = []; // user's own custom words: { c, p, m, tags }
let statsMap = {}; // key (c::m) -> { correct, wrong, dontknow }, covers built-in + custom words
let score = 0, total = 0, streak = 0, lastWord = null;
let activeTags = new Set();
let listSearch = '';
let listFilterTags = new Set();
let overlapOnly = false;
const UNSEEN_BONUS = 8; // weight multiplier for words never asked before (correct+wrong+dontknow === 0)
let roundSize = 'all'; // 25|50|100|150|200|250|'all' — how many unique words make up the current round
let roundKeys = null; // array of statKeys in the current round, or null if not yet rolled
const ROUND_SIZES = [25, 50, 100, 150, 200, 250];
let progressTags = new Set(); // Settings' progress-list filter; empty means "all lists"
let darkMode = false;
let screen = 'home'; // 'home' | 'quiz' | 'results' | 'settings' | 'addWord'
let screenBeforeSettings = 'home';

/* ---------- pinyin syllable splitting ---------- */
const CAP_TONE = /[ĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/;
function fixToneCase(str){
  return str.split('').map((ch, i) => (i > 0 && CAP_TONE.test(ch)) ? ch.toLowerCase() : ch).join('');
}
const TONE_MAP = {
  'ā':'a','á':'a','ǎ':'a','à':'a','ē':'e','é':'e','ě':'e','è':'e',
  'ī':'i','í':'i','ǐ':'i','ì':'i','ō':'o','ó':'o','ǒ':'o','ò':'o',
  'ū':'u','ú':'u','ǔ':'u','ù':'u','ǖ':'v','ǘ':'v','ǚ':'v','ǜ':'v','ü':'v'
};
function detone(s){ return s.split('').map(ch => TONE_MAP[ch.toLowerCase()] || ch.toLowerCase()).join(''); }
const INITIALS = ['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s','y','w'];
const FINALS = new Set(['a','o','e','ai','ei','ao','ou','an','en','ang','eng','ong','er','i','ia','ie','iao','iu','ian','in','iang','ing','iong','u','ua','uo','uai','ui','uan','un','uang','ueng','v','ve','ue']);
const SPECIALS = new Set(['yi','wu','yu','ya','ye','yao','you','yan','yin','yang','ying','yong','wa','wo','wai','wei','wan','wen','wang','weng','yuan','yue','yun','er']);
function isValidSyllable(piece){
  const d = detone(piece);
  if (SPECIALS.has(d) || FINALS.has(d)) return true;
  for (const ini of INITIALS) {
    if (d.startsWith(ini) && FINALS.has(d.slice(ini.length))) return true;
  }
  return false;
}
function greedySyllables(token){
  const parts = token.split("'").filter(x => x.length);
  const out = [];
  parts.forEach(part => {
    let s = part;
    while (s.length > 0) {
      let matched = null;
      for (let len = Math.min(6, s.length); len >= 1; len--) {
        if (isValidSyllable(s.slice(0, len))) { matched = s.slice(0, len); break; }
      }
      if (!matched) matched = s.slice(0, 1);
      out.push(matched);
      s = s.slice(matched.length);
    }
  });
  return out;
}
function spacedPinyin(str){
  const fixed = fixToneCase(str);
  return fixed.split(' ').map(tok => greedySyllables(tok).join(' ')).join(' ');
}

/* ---------- speech ---------- */
function speak(text){
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.85;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---------- theme (manual dark-mode toggle, overrides system preference) ---------- */
function loadTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  darkMode = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme();
}
function applyTheme(){
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  const toggle = document.getElementById('darkModeToggle');
  toggle.classList.toggle('on', darkMode);
  toggle.setAttribute('aria-checked', String(darkMode));
}
function toggleDarkMode(){
  darkMode = !darkMode;
  try { localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light'); } catch (e) {}
  applyTheme();
}

/* ---------- stats (per-word progress, keyed by character+meaning) ---------- */
function statKey(c, m){ return c + '::' + m; }
function getStats(c, m){
  const s = statsMap[statKey(c, m)];
  if (!s) return { correct: 0, wrong: 0, dontknow: 0 };
  return { correct: s.correct || 0, wrong: s.wrong || 0, dontknow: s.dontknow || 0 };
}
function bumpStat(c, m, field){
  const k = statKey(c, m);
  if (!statsMap[k]) statsMap[k] = { correct: 0, wrong: 0, dontknow: 0 };
  if (statsMap[k][field] === undefined) statsMap[k][field] = 0;
  statsMap[k][field]++;
  saveStats();
}
function clearWordStat(c, m, field){
  const k = statKey(c, m);
  if (!statsMap[k]) return;
  statsMap[k][field] = 0;
  saveStats();
}
function loadStats(){
  try {
    const raw = localStorage.getItem(STATS_KEY);
    statsMap = raw ? JSON.parse(raw) : {};
  } catch (e) {
    statsMap = {};
  }
}
function saveStats(){
  try { localStorage.setItem(STATS_KEY, JSON.stringify(statsMap)); } catch (e) {}
}

/* ---------- session (score/streak + which lists/round are active, so a reload resumes the game) ---------- */
function loadSession(){
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    score = s.score || 0;
    total = s.total || 0;
    streak = s.streak || 0;
    if (Array.isArray(s.activeTags) && s.activeTags.length) activeTags = new Set(s.activeTags);
    roundSize = s.roundSize || 'all';
    roundKeys = Array.isArray(s.roundKeys) ? s.roundKeys : null;
  } catch (e) {}
}
function saveSession(){
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ score, total, streak, activeTags: [...activeTags], roundSize, roundKeys }));
  } catch (e) {}
}

/* ---------- combined pool: built-in lists + user's custom words ---------- */
function combinedPool(){
  const map = new Map();
  Object.entries(BUILTIN_LISTS).forEach(([tag, list]) => {
    list.forEach(([c, p, m]) => {
      const k = statKey(c, m);
      if (!map.has(k)) map.set(k, { c, p, m, tags: new Set() });
      map.get(k).tags.add(tag);
    });
  });
  words.forEach(w => {
    const k = statKey(w.c, w.m);
    if (!map.has(k)) map.set(k, { c: w.c, p: w.p, m: w.m, tags: new Set() });
    w.tags.forEach(t => map.get(k).tags.add(t));
  });
  return [...map.values()].map(w => {
    const s = getStats(w.c, w.m);
    return { c: w.c, p: w.p, m: w.m, tags: [...w.tags], correct: s.correct, wrong: s.wrong, dontknow: s.dontknow };
  });
}

// a word is "done" for the round once it's been answered correctly at least once;
// wrong/don't-know words keep coming back until then
function doneCount(pool){
  return pool.filter(w => w.correct > 0).length;
}

/* ---------- round: a fixed random subset of the tag-filtered pool, sized by roundSize ---------- */
function rollRound(pool){
  const n = roundSize === 'all' ? pool.length : Math.min(roundSize, pool.length);
  roundKeys = pickRandom(pool, n, null).map(w => statKey(w.c, w.m));
  saveSession();
}
function resolveRoundPool(taggedPool){
  const poolKeys = new Set(taggedPool.map(w => statKey(w.c, w.m)));
  if (!roundKeys || roundKeys.every(k => !poolKeys.has(k))) {
    rollRound(taggedPool);
  }
  let roundSet = new Set(roundKeys);
  let resolved = taggedPool.filter(w => roundSet.has(statKey(w.c, w.m)));
  if (resolved.length < Math.min(4, taggedPool.length)) {
    rollRound(taggedPool);
    roundSet = new Set(roundKeys);
    resolved = taggedPool.filter(w => roundSet.has(statKey(w.c, w.m)));
  }
  return resolved;
}

/* ---------- per-list accent tint (drives question card, level chip, progress bar, buttons) ---------- */
const TINT_VARS = {
  hsk1: { bg: '--accent-bg', solid: '--accent-solid' },
  hsk2: { bg: '--hsk2-bg', solid: '--hsk2-text' },
  hsk3: { bg: '--hsk3-bg', solid: '--hsk3-text' },
  hsk4: { bg: '--hsk4-bg', solid: '--hsk4-text' },
  es: { bg: '--success-bg', solid: '--success-text' },
  other: { bg: '--surface-1', solid: '--accent-solid' },
};
function primaryTag(tags){
  const order = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'ES1'];
  for (const t of order) if (tags.includes(t)) return t;
  return tags[0] || null;
}
function tintOf(tag){
  return TINT_VARS[tag ? tagClass(tag) : 'hsk1'];
}

/* ---------- storage ---------- */
function loadWords(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    words = raw ? JSON.parse(raw) : [];
  } catch (e) {
    words = [];
  }
  words.forEach(w => { if (!w.tags) w.tags = [w.tag || 'untagged']; });
  renderList();
  renderListFilterOptions();
  renderTagOptions();
  renderRoundSizeOptions();
}
function saveWords(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(words)); } catch (e) {}
}

/* ---------- tags ---------- */
function tagClass(tag){
  if (tag === 'HSK1') return 'hsk1';
  if (tag === 'HSK2') return 'hsk2';
  if (tag === 'HSK3') return 'hsk3';
  if (tag === 'HSK4') return 'hsk4';
  if (tag.startsWith('ES')) return 'es';
  return 'other';
}

// renders the deck-chip row on both Home (#tagFilterRow) and Word Decks (#deckTagFilterRow),
// keeping them in sync since they share the same activeTags state
function renderTagOptions(){
  const tags = [...new Set(combinedPool().flatMap(w => w.tags))];
  document.getElementById('tagOptions').innerHTML = tags.map(t => `<option value="${t}">`).join('');
  ['tagFilterRow', 'deckTagFilterRow'].forEach(id => renderTagRow(id, tags));
}
function renderTagRow(containerId, tags){
  const filterRow = document.getElementById(containerId);
  filterRow.innerHTML = '';
  tags.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    const refresh = () => {
      btn.className = activeTags.has(t) ? `active ${cls}` : '';
    };
    btn.onclick = () => {
      if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
      roundKeys = null;
      saveSession();
      renderTagOptions();
      renderRoundSizeOptions();
      updateHomePoolCount();
    };
    refresh();
    filterRow.appendChild(btn);
  });
}

function renderRoundSizeOptions(){
  const taggedPool = combinedPool().filter(w => w.tags.some(t => activeTags.has(t)));
  const options = [...ROUND_SIZES.filter(n => n <= taggedPool.length), 'all'];
  if (roundSize !== 'all' && !options.includes(roundSize)) {
    roundSize = 'all';
    saveSession();
  }
  const row = document.getElementById('roundSizeRow');
  row.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.textContent = opt === 'all' ? 'All' : String(opt);
    const refresh = () => {
      btn.className = roundSize === opt ? 'active' : '';
    };
    btn.onclick = () => {
      roundSize = opt;
      roundKeys = null;
      saveSession();
      renderRoundSizeOptions();
    };
    refresh();
    row.appendChild(btn);
  });
}

function updateHomePoolCount(){
  const taggedPool = combinedPool().filter(w => w.tags.some(t => activeTags.has(t)));
  const poolCountEl = document.getElementById('poolCount');
  const startBtn = document.getElementById('startBtn');
  if (taggedPool.length < 4) {
    poolCountEl.textContent = 'Select word lists with at least 4 words total to play';
    poolCountEl.classList.add('warning');
  } else {
    poolCountEl.textContent = `${taggedPool.length} words available in selected lists`;
    poolCountEl.classList.remove('warning');
  }
  startBtn.disabled = taggedPool.length < 4;
  const tv = tintOf(primaryTag([...activeTags]));
  startBtn.style.background = `var(${tv.solid})`;
  startBtn.style.borderColor = `var(${tv.solid})`;
}

/* ---------- word list (Settings: your own custom words) ---------- */
// if 2+ built-in list tags (HSK1/HSK2/ES1) are selected in the filter row, "overlap" means
// present in every one of those selected lists; otherwise it falls back to present in any 2+
// of all built-in lists
function isOverlap(w){
  const selected = [...listFilterTags].filter(t => BUILTIN_LISTS[t]);
  if (selected.length >= 2) return selected.every(t => w.tags.includes(t));
  return Object.keys(BUILTIN_LISTS).filter(t => w.tags.includes(t)).length >= 2;
}
function countOverlaps(){
  return combinedPool().filter(isOverlap).length;
}

function renderListFilterOptions(){
  const tags = [...new Set(combinedPool().flatMap(w => w.tags))];
  const filterRow = document.getElementById('listFilterRow');
  filterRow.innerHTML = '';
  // drop selected tags that no longer exist (e.g. after deleting the last custom word with that tag)
  listFilterTags.forEach(t => { if (!tags.includes(t)) listFilterTags.delete(t); });
  tags.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    const refresh = () => {
      btn.className = listFilterTags.has(t) ? `active ${cls}` : '';
    };
    btn.onclick = () => {
      if (listFilterTags.has(t)) listFilterTags.delete(t); else listFilterTags.add(t);
      refresh();
      renderList();
    };
    refresh();
    filterRow.appendChild(btn);
  });
}

function renderList(){
  document.getElementById('overlapCount').textContent = `(${countOverlaps()})`;
  const query = listSearch.trim();
  const hasQuery = query.length > 0;
  const hasFilter = listFilterTags.size > 0;
  const expanded = hasQuery || hasFilter || overlapOnly;
  const q = detone(query); // lowercases + strips tone marks; a no-op for Chinese characters
  // with no search text, tag filter, or overlap toggle, show only your own custom words;
  // any of those look across the built-in lists too
  const source = expanded
    ? combinedPool()
    : words.map(w => { const s = getStats(w.c, w.m); return { c: w.c, p: w.p, m: w.m, tags: w.tags, correct: s.correct, wrong: s.wrong }; });
  const filtered = source.filter(w => {
    if (overlapOnly && !isOverlap(w)) return false;
    if (listFilterTags.size && !w.tags.some(t => listFilterTags.has(t))) return false;
    if (!hasQuery) return true;
    return w.c.includes(query) || detone(w.p).includes(q) || w.m.toLowerCase().includes(q);
  });
  document.getElementById('countLabel').textContent = expanded
    ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} across all lists`
    : `${filtered.length} of ${words.length} ${words.length === 1 ? 'word' : 'words'} shown`;
  const box = document.getElementById('wordList');
  box.innerHTML = '';
  if (!expanded && words.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No custom words yet — add your own below, or pick a built-in list on the Home screen.</div>';
    return;
  }
  if (filtered.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No words match your search/filter.</div>';
    return;
  }
  [...filtered].reverse().forEach(w => {
    const idx = words.findIndex(w2 => w2.c === w.c && w2.m === w.m);
    const seen = w.correct + w.wrong;
    const acc = seen > 0 ? Math.round(100 * w.correct / seen) : null;
    const badges = w.tags.map(t => `<span class="badge ${tagClass(t)}">${t}</span>`).join(' ');
    const row = document.createElement('div');
    row.className = 'word-row';
    row.innerHTML = `
      <span class="char">${w.c}</span>
      <span class="pinyin">${spacedPinyin(w.p)}</span>
      <span class="meaning">${w.m}</span>
      <span class="row-meta">
        <span class="tags">${badges}</span>
        <span class="acc">${acc !== null ? acc + '%' : 'new'}</span>
        ${idx !== -1 ? `<button class="del-btn" data-idx="${idx}" aria-label="Delete">✕</button>` : '<span class="del-btn-spacer"></span>'}
      </span>
    `;
    box.appendChild(row);
  });
  box.querySelectorAll('.del-btn').forEach(b => {
    b.onclick = () => {
      words.splice(parseInt(b.dataset.idx), 1);
      saveWords();
      renderList();
      renderListFilterOptions();
      renderTagOptions();
      renderRoundSizeOptions();
    };
  });
}

/* ---------- progress: words ever answered wrong / marked "I don't know", across all lists ---------- */
function buildWordRow(w, clearField){
  const seen = w.correct + w.wrong;
  const acc = seen > 0 ? Math.round(100 * w.correct / seen) : null;
  const badges = w.tags.map(t => `<span class="badge ${tagClass(t)}">${t}</span>`).join(' ');
  const row = document.createElement('div');
  row.className = 'word-row';
  row.innerHTML = `
    <span class="char">${w.c}</span>
    <span class="pinyin">${spacedPinyin(w.p)}</span>
    <span class="meaning">${w.m}</span>
    <span class="row-meta">
      <span class="tags">${badges}</span>
      <span class="acc">${acc !== null ? acc + '%' : 'new'}</span>
    </span>
    ${clearField ? '<button class="del-btn" aria-label="Clear">✕</button>' : ''}
  `;
  if (clearField) {
    row.querySelector('.del-btn').onclick = () => {
      clearWordStat(w.c, w.m, clearField);
      renderProgress();
    };
  }
  return row;
}

function renderProgressTagOptions(){
  const tags = [...new Set(combinedPool().flatMap(w => w.tags))];
  // drop selected tags that no longer exist (e.g. after deleting the last custom word with that tag)
  progressTags.forEach(t => { if (!tags.includes(t)) progressTags.delete(t); });
  const row = document.getElementById('progressFilterRow');
  row.innerHTML = '';
  tags.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    const refresh = () => {
      btn.className = progressTags.has(t) ? `active ${cls}` : '';
    };
    btn.onclick = () => {
      if (progressTags.has(t)) progressTags.delete(t); else progressTags.add(t);
      refresh();
      renderProgress();
    };
    refresh();
    row.appendChild(btn);
  });
}

function progressPool(){
  return combinedPool().filter(w => progressTags.size === 0 || w.tags.some(t => progressTags.has(t)));
}

function renderProgress(){
  renderProgressTagOptions();
  const pool = progressPool();
  const wrongWords = pool.filter(w => w.wrong > 0).sort((a, b) => b.wrong - a.wrong);
  const dontKnowWords = pool.filter(w => w.dontknow > 0).sort((a, b) => b.dontknow - a.dontknow);

  const wrongBox = document.getElementById('wrongList');
  wrongBox.innerHTML = '';
  if (wrongWords.length === 0) {
    wrongBox.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No wrong answers yet — nice!</div>';
  } else {
    wrongWords.forEach(w => wrongBox.appendChild(buildWordRow(w, 'wrong')));
  }

  const dkBox = document.getElementById('dontKnowList');
  dkBox.innerHTML = '';
  if (dontKnowWords.length === 0) {
    dkBox.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">Nothing marked "I don\'t know" yet.</div>';
  } else {
    dontKnowWords.forEach(w => dkBox.appendChild(buildWordRow(w, 'dontknow')));
  }

  document.getElementById('resetProgressBtn').textContent = progressTags.size === 0
    ? 'Reset all progress'
    : `Reset progress for ${[...progressTags].join(', ')}`;
}

document.getElementById('resetProgressBtn').onclick = () => {
  const scopeLabel = progressTags.size === 0 ? 'all lists' : [...progressTags].join(', ');
  const ok = confirm(`Reset quiz progress for ${scopeLabel}? This clears correct/wrong/"don't know" history for those words. This can't be undone.`);
  if (!ok) return;
  progressPool().forEach(w => { delete statsMap[statKey(w.c, w.m)]; });
  saveStats();
  renderProgress();
};

document.getElementById('searchWord').oninput = (e) => {
  listSearch = e.target.value;
  renderList();
};

document.getElementById('overlapOnly').onchange = (e) => {
  overlapOnly = e.target.checked;
  renderList();
};

/* ---------- add word ---------- */
function renderAddWordLevelOptions(){
  const row = document.getElementById('addWordLevelRow');
  row.innerHTML = '';
  const current = document.getElementById('inTag').value.trim();
  ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'ES1'].forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    btn.className = current === t ? `active ${cls}` : '';
    btn.onclick = () => {
      document.getElementById('inTag').value = t;
      renderAddWordLevelOptions();
    };
    row.appendChild(btn);
  });
}
document.getElementById('inTag').addEventListener('input', renderAddWordLevelOptions);

function resetAddWordForm(){
  document.getElementById('inChar').value = '';
  document.getElementById('inPinyin').value = '';
  document.getElementById('inMeaning').value = '';
  document.getElementById('inTag').value = '';
  document.getElementById('addMsg').textContent = '';
  renderAddWordLevelOptions();
}

document.getElementById('addBtn').onclick = () => {
  const c = document.getElementById('inChar').value.trim();
  const p = document.getElementById('inPinyin').value.trim();
  const m = document.getElementById('inMeaning').value.trim();
  const tag = document.getElementById('inTag').value.trim() || 'untagged';
  const msg = document.getElementById('addMsg');
  if (!c || !p || !m) {
    msg.textContent = 'Fill in all fields first.';
    return;
  }
  const existing = words.find(w => w.c === c && w.m === m);
  if (existing) {
    if (!existing.tags.includes(tag)) existing.tags.push(tag);
  } else {
    words.push({ c, p, m, tags: [tag] });
  }
  saveWords();
  resetAddWordForm();
  renderList();
  renderListFilterOptions();
  renderTagOptions();
  renderRoundSizeOptions();
  showScreen('wordDecks');
};

document.getElementById('cancelAddWordBtn').onclick = () => {
  resetAddWordForm();
  showScreen('wordDecks');
};

/* ---------- quiz logic ---------- */
function pickRandom(arr, n, exclude){
  const pool = arr.filter(x => x !== exclude);
  const res = [];
  while (res.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    res.push(pool.splice(i, 1)[0]);
  }
  return res;
}

function weightedPick(pool, excludeKey){
  const weights = pool.map(w => {
    const base = 1 + (w.wrong + w.dontknow) * 2.5 - w.correct * 0.4;
    const clamped = Math.max(0.3, base);
    const unseenBonus = (w.correct + w.wrong + w.dontknow === 0) ? UNSEEN_BONUS : 1;
    const jitter = 0.6 + Math.random() * 0.8;
    let val = clamped * unseenBonus * jitter;
    if (excludeKey && statKey(w.c, w.m) === excludeKey) val *= 0.15;
    return val;
  });
  const totalW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalW;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function newQuestion(){
  const taggedPool = combinedPool().filter(w => w.tags.some(t => activeTags.has(t)));
  if (taggedPool.length < 4) {
    // shouldn't normally reach the quiz screen in this state (Home disables Start), but bail out safely
    showScreen('home');
    return;
  }
  const pool = resolveRoundPool(taggedPool);
  const done = doneCount(pool);
  document.getElementById('quizPositionText').textContent = `${done} / ${pool.length}`;
  document.getElementById('quizProgressFill').style.width = pool.length ? `${(done / pool.length) * 100}%` : '0%';
  document.getElementById('scoreOut').textContent = score;

  // once a word is answered correctly it's "done" and stops appearing as a question this round;
  // wrong/don't-know words keep coming back until they're answered correctly
  if (done === pool.length) {
    showScreen('results');
    return;
  }

  const feedback = document.getElementById('feedback');
  feedback.textContent = '';
  feedback.className = 'feedback';
  const dontKnowBtn = document.getElementById('dontKnowBtn');
  dontKnowBtn.disabled = false;

  const candidates = pool.filter(w => w.correct === 0);
  const word = weightedPick(candidates, lastWord);
  lastWord = statKey(word.c, word.m);
  document.getElementById('qMain').textContent = word.c;

  document.getElementById('qTags').innerHTML = word.tags
    .map(t => `<span class="badge ${tagClass(t)}">${t}</span>`).join('');

  const opts = document.getElementById('options');
  opts.innerHTML = '';

  const numChoices = Math.min(6, pool.length);
  const distractors = pickRandom(pool, numChoices - 1, word);
  const choiceWords = [...distractors, word].sort(() => Math.random() - 0.5);

  let answered = false;
  function finishQuestion(outcome, clickedCell){ // outcome: 'correct' | 'wrong' | 'dontknow'
    if (answered) return;
    answered = true;
    total++;
    if (outcome === 'correct') {
      score++; streak++; bumpStat(word.c, word.m, 'correct');
      clickedCell.classList.add('correct');
      feedback.textContent = `✓ Correct — ${word.c} (${spacedPinyin(word.p)}) = ${word.m}`;
      feedback.className = 'feedback correct';
    } else {
      streak = 0;
      bumpStat(word.c, word.m, outcome);
      if (clickedCell) clickedCell.classList.add('wrong');
      feedback.textContent = `✗ ${word.c} (${spacedPinyin(word.p)}) = ${word.m}`;
      feedback.className = 'feedback wrong';
    }
    opts.querySelectorAll('.option-main').forEach((cell, i2) => {
      cell.onclick = null;
      cell.classList.add('answered');
      if (choiceWords[i2] === word && outcome !== 'correct') cell.classList.add('correct');
      if (!cell.classList.contains('correct') && !cell.classList.contains('wrong')) cell.classList.add('faded');
    });
    dontKnowBtn.disabled = true;
    document.getElementById('scoreOut').textContent = score;
    saveSession();
    setTimeout(() => { if (screen === 'quiz') newQuestion(); }, 1300);
  }

  choiceWords.forEach(cw => {
    const cell = document.createElement('div');
    cell.className = 'option-main';
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.innerHTML = `
      <span class="option-top">
        <span class="option-pinyin">${spacedPinyin(cw.p)}</span>
        <button class="speak-btn" type="button" aria-label="play audio">🔊</button>
      </span>
      <span class="option-meaning">${cw.m}</span>
    `;
    cell.querySelector('.speak-btn').onclick = (e) => { e.stopPropagation(); speak(cw.c); };
    cell.onclick = () => finishQuestion(cw === word ? 'correct' : 'wrong', cell);
    cell.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && cell.onclick) { e.preventDefault(); cell.onclick(); } };
    opts.appendChild(cell);
  });

  dontKnowBtn.onclick = () => finishQuestion('dontknow', null);
}

function renderResults(){
  const taggedPool = combinedPool().filter(w => w.tags.some(t => activeTags.has(t)));
  const pool = resolveRoundPool(taggedPool);
  const missed = pool.filter(w => w.wrong > 0 || w.dontknow > 0);

  const tv = tintOf(primaryTag([...activeTags]));
  document.getElementById('scoreCircle').style.background = `var(${tv.bg})`;
  const resultScore = document.getElementById('resultScore');
  resultScore.style.color = `var(${tv.solid})`;
  resultScore.textContent = score;
  document.getElementById('resultTotal').textContent = '/' + total;

  document.getElementById('missedTitle').textContent = `Missed this round (${missed.length})`;
  const box = document.getElementById('missedList');
  box.innerHTML = '';
  if (missed.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No missed words this round — nice!</div>';
  } else {
    missed.forEach(w => box.appendChild(buildWordRow(w)));
  }

  const playAgainBtn = document.getElementById('playAgainBtn');
  playAgainBtn.style.background = `var(${tv.solid})`;
  playAgainBtn.style.borderColor = `var(${tv.solid})`;
}

document.getElementById('playAgainBtn').onclick = () => {
  const taggedPool = combinedPool().filter(w => w.tags.some(t => activeTags.has(t)));
  const pool = resolveRoundPool(taggedPool);
  pool.forEach(w => { delete statsMap[statKey(w.c, w.m)]; });
  saveStats();
  score = 0; total = 0; streak = 0;
  saveSession();
  showScreen('quiz');
};
document.getElementById('newRoundBtn').onclick = () => {
  roundKeys = null;
  saveSession();
  showScreen('home');
};

document.getElementById('startBtn').onclick = () => showScreen('quiz');

/* ---------- navigation ---------- */
const SCREENS = ['home', 'quiz', 'results', 'settings', 'wordDecks', 'myProgress', 'addWord'];
function showScreen(name){
  SCREENS.forEach(s => document.getElementById(s + 'Screen').classList.toggle('hidden', s !== name));
  screen = name;
  if (name === 'home') updateHomePoolCount();
  if (name === 'quiz') newQuestion();
  if (name === 'results') renderResults();
  if (name === 'wordDecks') { renderTagOptions(); renderRoundSizeOptions(); renderListFilterOptions(); renderList(); }
  if (name === 'myProgress') renderProgress();
  if (name === 'addWord') renderAddWordLevelOptions();
}

document.getElementById('homeSettingsBtn').onclick = () => { screenBeforeSettings = 'home'; showScreen('settings'); };
document.getElementById('quizSettingsBtn').onclick = () => { screenBeforeSettings = 'quiz'; showScreen('settings'); };
document.getElementById('quizExitBtn').onclick = () => showScreen('home');
document.getElementById('settingsBackBtn').onclick = () => showScreen(screenBeforeSettings);
document.getElementById('openWordDecksBtn').onclick = () => showScreen('wordDecks');
document.getElementById('wordDecksBackBtn').onclick = () => showScreen('settings');
document.getElementById('openMyProgressBtn').onclick = () => showScreen('myProgress');
document.getElementById('myProgressBackBtn').onclick = () => showScreen('settings');
document.getElementById('openAddWordBtn').onclick = () => showScreen('addWord');
document.getElementById('addWordBackBtn').onclick = () => showScreen('wordDecks');
document.getElementById('darkModeToggle').onclick = toggleDarkMode;

/* ---------- init ---------- */
loadTheme();
loadStats();
activeTags = new Set(Object.keys(BUILTIN_LISTS));
loadSession(); // may override score/total/streak/activeTags/roundSize/roundKeys with a resumed session
loadWords();
showScreen('home');
