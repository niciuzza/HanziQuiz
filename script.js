const STORAGE_KEY = 'hsk-vocab-words';
const STATS_KEY = 'hsk-vocab-stats';
const SESSION_KEY = 'hsk-vocab-session';
const THEME_KEY = 'hsk-vocab-theme';
const AUTOPLAY_SOUND_KEY = 'hsk-vocab-autoplay-sound';
const HARD_MODE_KEY = 'hsk-vocab-hard-mode';
const BUILTIN_LISTS = { HSK1: FULL_HSK1, HSK2: FULL_HSK2, HSK3: FULL_HSK3, HSK4: FULL_HSK4, ES1: FULL_ES1 };
let words = []; // user's own custom words: { c, p, m, tags }
let statsMap = {}; // key (c::m) -> { correct, wrong, dontknow }, covers built-in + custom words
let score = 0, total = 0, streak = 0, lastWord = null;
let activeTags = new Set();
let activeTopics = new Set(); // Home's optional topic filter — union within topics, intersected with activeTags
let detailWord = null; // word shown on the Word Detail screen
let listSearch = '';
let listFilterTags = new Set();
let listFilterTopics = new Set(); // Word Decks' own topic filter — independent of Home's activeTopics
let overlapOnly = false;
const UNSEEN_BONUS = 8; // weight multiplier for words never asked before (correct+wrong+dontknow === 0)
let roundSize = 'all'; // 25|50|100|150|200|250|'all' — how many unique words make up the current round
let roundKeys = null; // array of statKeys in the current round, or null if not yet rolled
const ROUND_SIZES = [25, 50, 100, 150, 200, 250];
let progressTags = new Set(); // Settings' progress-list filter; empty means "all lists"
let darkMode = false;
let autoPlaySound = true;
let hardMode = false; // when on, a character with 2+ genuinely distinct senses (see clusterSenses)
                       // requires selecting all of them + Submit, instead of tap-one-to-answer
let screen = 'home'; // 'home' | 'quiz' | 'results' | 'settings' | 'addWord'
let screenBeforeSettings = 'home';

// topic/POS taxonomy for distractor grouping — a word's tags (HSK1/ES1/custom list)
// are about which *list* it's in; topic/pos are orthogonal to that, and optional.
const TOPICS = ['Greetings & Phrases', 'Family & People', 'Food & Drink', 'Colors', 'Numbers & Quantities', 'Time & Calendar', 'Travel & Transport', 'Places', 'Body & Health', 'Clothing & Appearance', 'School & Study', 'Work & Money', 'Nature & Weather', 'Household Objects', 'Emotions & Personality', 'Other'];
const POS_LIST = ['Noun', 'Verb', 'Adjective', 'Pronoun', 'Number/Measure word', 'Time word', 'Function word'];
let newWordTopic = '';
let newWordPos = '';

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

/* ---------- whether the answer card auto-plays the word's pronunciation ---------- */
function loadAutoPlaySound(){
  const saved = localStorage.getItem(AUTOPLAY_SOUND_KEY);
  autoPlaySound = saved === null ? true : saved === 'true';
  applyAutoPlaySound();
}
function applyAutoPlaySound(){
  const toggle = document.getElementById('autoPlaySoundToggle');
  toggle.classList.toggle('on', autoPlaySound);
  toggle.setAttribute('aria-checked', String(autoPlaySound));
}
function toggleAutoPlaySound(){
  autoPlaySound = !autoPlaySound;
  try { localStorage.setItem(AUTOPLAY_SOUND_KEY, String(autoPlaySound)); } catch (e) {}
  applyAutoPlaySound();
}

/* ---------- hard mode: multi-meaning characters require selecting every sense ---------- */
function loadHardMode(){
  const saved = localStorage.getItem(HARD_MODE_KEY);
  hardMode = saved === 'true';
  applyHardMode();
}
function applyHardMode(){
  const toggle = document.getElementById('hardModeToggle');
  toggle.classList.toggle('on', hardMode);
  toggle.setAttribute('aria-checked', String(hardMode));
}
function toggleHardMode(){
  hardMode = !hardMode;
  try { localStorage.setItem(HARD_MODE_KEY, String(hardMode)); } catch (e) {}
  applyHardMode();
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
    if (Array.isArray(s.activeTopics)) activeTopics = new Set(s.activeTopics);
    roundSize = s.roundSize || 'all';
    roundKeys = Array.isArray(s.roundKeys) ? s.roundKeys : null;
  } catch (e) {}
}
function saveSession(){
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ score, total, streak, activeTags: [...activeTags], activeTopics: [...activeTopics], roundSize, roundKeys }));
  } catch (e) {}
}

/* ---------- combined pool: built-in lists + user's custom words ---------- */
function combinedPool(){
  const map = new Map();
  Object.entries(BUILTIN_LISTS).forEach(([tag, list]) => {
    list.forEach(([c, p, m, pos, topic, chapter]) => {
      const k = statKey(c, m);
      if (!map.has(k)) map.set(k, { c, p, m, tags: new Set(), pos: pos || null, topic: topic || null, chapter: chapter || null });
      // a word can be shared across lists (e.g. also in HSK1); whichever list is merged first
      // wins pos/topic, but chapter is ES1-book-specific, so always backfill it once known,
      // regardless of merge order
      if (!map.get(k).chapter && chapter) map.get(k).chapter = chapter;
      map.get(k).tags.add(tag);
    });
  });
  words.forEach(w => {
    const k = statKey(w.c, w.m);
    if (!map.has(k)) map.set(k, { c: w.c, p: w.p, m: w.m, tags: new Set(), pos: w.pos || null, topic: w.topic || null, chapter: w.chapter || null });
    w.tags.forEach(t => map.get(k).tags.add(t));
  });
  return [...map.values()].map(w => {
    const s = getStats(w.c, w.m);
    return { c: w.c, p: w.p, m: w.m, tags: [...w.tags], pos: w.pos, topic: w.topic, chapter: w.chapter, correct: s.correct, wrong: s.wrong, dontknow: s.dontknow };
  });
}

// combinedPool() narrowed to the Home screen's active filters: word must be in one of the
// selected lists (activeTags), AND — if any topics are selected — match at least one of them
// (topics union together, but that union is intersected with the list selection)
function filteredPool(){
  return combinedPool().filter(w => w.tags.some(t => activeTags.has(t))
    && (activeTopics.size === 0 || (w.topic && activeTopics.has(w.topic))));
}

// a word is "done" for the round once it's been answered correctly at least once;
// wrong/don't-know words keep coming back until then
function doneCount(pool){
  return pool.filter(w => w.correct > 0).length;
}

/* ---------- round: a fixed random subset of the tag-filtered pool, sized by roundSize ---------- */
// rolling a round means a fresh round is starting, so score/total/streak reset here too —
// otherwise they'd keep accumulating across every round ever played instead of reflecting
// just the round currently on screen (per-word correct/wrong history lives in statsMap
// forever regardless, independent of this per-round tally).
function rollRound(pool){
  const n = roundSize === 'all' ? pool.length : Math.min(roundSize, pool.length);
  roundKeys = pickRandom(pool, n, null).map(w => statKey(w.c, w.m));
  score = 0; total = 0; streak = 0;
  saveSession();
}
function resolveRoundPool(taggedPool){
  const poolKeys = new Set(taggedPool.map(w => statKey(w.c, w.m)));
  if (!roundKeys || roundKeys.every(k => !poolKeys.has(k))) {
    rollRound(taggedPool);
  }
  let roundSet = new Set(roundKeys);
  let resolved = taggedPool.filter(w => roundSet.has(statKey(w.c, w.m)));
  // only repair-reroll if the round is genuinely empty (e.g. every one of its words got deleted);
  // a deliberately small round (like "Practice these words" from My Progress) is fine as-is —
  // numChoices elsewhere already scales the number of options down to match a small pool
  if (resolved.length === 0) {
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
  // custom tags get their own badge color (see tagClass/tagHue) but intentionally don't drive
  // accent theming (Start button, score circle, question card) — that stays tied to the 5
  // built-in lists, falling back to the neutral 'other' tint for any custom tag
  const cls = tag ? tagClass(tag) : 'hsk1';
  return TINT_VARS[cls] || TINT_VARS.other;
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
  if (tag === 'untagged') return 'other';
  return 'custom-tag';
}

// deterministic hue (0-359) from a custom list name, so the same name always renders the
// same color; combined with the --tag-sat/--tag-bg-l/--tag-text-l tokens (defined per theme
// alongside the rest of the color tokens) via the .badge.custom-tag / button.active.custom-tag
// CSS rules, so it stays theme-aware without any JS re-render on a dark-mode toggle.
function tagHue(tag){
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function badgeHTML(tag){
  const cls = tagClass(tag);
  const style = cls === 'custom-tag' ? ` style="--tag-hue:${tagHue(tag)}"` : '';
  return `<span class="badge ${cls}"${style}>${tag}</span>`;
}

function renderTagOptions(){
  const tags = [...new Set(combinedPool().flatMap(w => w.tags))];
  document.getElementById('tagOptions').innerHTML = tags.map(t => `<option value="${t}">`).join('');
  renderTagRow('tagFilterRow', tags);
}
function renderTagRow(containerId, tags){
  const filterRow = document.getElementById(containerId);
  filterRow.innerHTML = '';
  tags.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    if (cls === 'custom-tag') btn.style.setProperty('--tag-hue', tagHue(t));
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
  const taggedPool = filteredPool();
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
  const taggedPool = filteredPool();
  const poolCountEl = document.getElementById('poolCount');
  const startBtn = document.getElementById('startBtn');
  if (taggedPool.length < 6) {
    poolCountEl.textContent = 'Select word lists with at least 6 words total to play';
    poolCountEl.classList.add('warning');
  } else {
    poolCountEl.textContent = `${taggedPool.length} words available in selected lists`;
    poolCountEl.classList.remove('warning');
  }
  startBtn.disabled = taggedPool.length < 6;
  const tv = tintOf(primaryTag([...activeTags]));
  startBtn.style.background = `var(${tv.solid})`;
  startBtn.style.borderColor = `var(${tv.solid})`;
  updateResumeButton();
}

// looks up the in-progress round's own words directly by roundKeys (not through the Home
// screen's current filteredPool()), so the Resume button stays accurate even if the player
// has since poked at different list/topic filters without starting a new round
function updateResumeButton(){
  const resumeBtn = document.getElementById('resumeBtn');
  if (!roundKeys) { resumeBtn.classList.add('hidden'); return; }
  const keySet = new Set(roundKeys);
  const pool = combinedPool().filter(w => keySet.has(statKey(w.c, w.m)));
  const done = doneCount(pool);
  if (pool.length === 0 || done >= pool.length) { resumeBtn.classList.add('hidden'); return; }
  resumeBtn.textContent = `▶ Resume round (${done}/${pool.length})`;
  resumeBtn.classList.remove('hidden');
}

// Shared topic filter widget: a dropdown that adds chips into a search-box-styled row.
// Chips union together (any selected topic matches). Used on both Home (filters the quiz
// pool, intersected with activeTags) and Word Decks (filters the word list, intersected
// with listFilterTags) — each screen keeps its own Set and passes an onChange callback.
function renderTopicChipFilter(chipsId, selectId, activeSet, onChange){
  const box = document.getElementById(chipsId);
  box.innerHTML = '';
  activeSet.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'topic-chip';
    chip.innerHTML = `${t} <button type="button" aria-label="Remove ${t}">×</button>`;
    chip.querySelector('button').onclick = () => {
      activeSet.delete(t);
      onChange();
    };
    box.appendChild(chip);
  });
  const select = document.getElementById(selectId);
  const remaining = TOPICS.filter(t => !activeSet.has(t));
  select.innerHTML = '<option value="" selected disabled>+ Add a topic…</option>'
    + remaining.map(t => `<option value="${t}">${t}</option>`).join('');
  select.classList.toggle('hidden', remaining.length === 0);
}

function renderTopicFilter(){
  renderTopicChipFilter('topicChips', 'topicSelect', activeTopics, () => {
    roundKeys = null;
    saveSession();
    renderTopicFilter();
    renderRoundSizeOptions();
    updateHomePoolCount();
  });
}
document.getElementById('topicSelect').onchange = (e) => {
  const t = e.target.value;
  if (!t) return;
  activeTopics.add(t);
  roundKeys = null;
  saveSession();
  renderTopicFilter();
  renderRoundSizeOptions();
  updateHomePoolCount();
};

function renderDeckTopicFilter(){
  renderTopicChipFilter('deckTopicChips', 'deckTopicSelect', listFilterTopics, () => {
    renderDeckTopicFilter();
    renderList();
  });
}
document.getElementById('deckTopicSelect').onchange = (e) => {
  const t = e.target.value;
  if (!t) return;
  listFilterTopics.add(t);
  renderDeckTopicFilter();
  renderList();
};

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
    if (cls === 'custom-tag') btn.style.setProperty('--tag-hue', tagHue(t));
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
  const hasFilter = listFilterTags.size > 0 || listFilterTopics.size > 0;
  const expanded = hasQuery || hasFilter || overlapOnly;
  const q = detone(query); // lowercases + strips tone marks; a no-op for Chinese characters
  // with no search text, tag filter, or overlap toggle, show only your own custom words;
  // any of those look across the built-in lists too
  const source = expanded
    ? combinedPool()
    : words.map(w => { const s = getStats(w.c, w.m); return { c: w.c, p: w.p, m: w.m, tags: w.tags, topic: w.topic, pos: w.pos, correct: s.correct, wrong: s.wrong }; });
  const filtered = source.filter(w => {
    if (overlapOnly && !isOverlap(w)) return false;
    if (listFilterTags.size && !w.tags.some(t => listFilterTags.has(t))) return false;
    if (listFilterTopics.size && !(w.topic && listFilterTopics.has(w.topic))) return false;
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
    const badges = w.tags.map(badgeHTML).join(' ');
    const seen = w.correct + w.wrong;
    const acc = seen > 0 ? Math.round(100 * w.correct / seen) : null;
    const row = document.createElement('div');
    row.className = 'word-row clickable';
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
    row.onclick = (e) => {
      if (e.target.closest('.del-btn')) return;
      showWordDetail(w);
    };
    box.appendChild(row);
  });
  box.querySelectorAll('.del-btn').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      words.splice(parseInt(b.dataset.idx), 1);
      saveWords();
      renderList();
      renderListFilterOptions();
      renderTagOptions();
      renderRoundSizeOptions();
    };
  });
}

/* ---------- progress: words ever answered wrong / marked "I don't know" / mastered ---------- */
function buildWordRow(w, clearField, onCleared){
  const seen = w.correct + w.wrong;
  const acc = seen > 0 ? Math.round(100 * w.correct / seen) : null;
  const badges = w.tags.map(badgeHTML).join(' ');
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
      if (onCleared) onCleared();
    };
  }
  return row;
}

// shared by each dedicated progress list screen — progressTags itself stays one global
// selection (not per-screen), only the control to change it moved off the My Progress hub
function renderProgressFilterRow(containerId, onChange){
  const tags = [...new Set(combinedPool().flatMap(w => w.tags))];
  // drop selected tags that no longer exist (e.g. after deleting the last custom word with that tag)
  progressTags.forEach(t => { if (!tags.includes(t)) progressTags.delete(t); });
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  tags.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    if (cls === 'custom-tag') btn.style.setProperty('--tag-hue', tagHue(t));
    const refresh = () => {
      btn.className = progressTags.has(t) ? `active ${cls}` : '';
    };
    btn.onclick = () => {
      if (progressTags.has(t)) progressTags.delete(t); else progressTags.add(t);
      refresh();
      onChange();
    };
    refresh();
    row.appendChild(btn);
  });
}

function progressPool(){
  return combinedPool().filter(w => progressTags.size === 0 || w.tags.some(t => progressTags.has(t)));
}

// My Progress is a hub: just counts + a link to each category's own dedicated screen (they can
// get long — see progressWrong/progressDontKnow/progressMastered, which each own their filter row)
function renderProgress(){
  const pool = progressPool();
  document.getElementById('progressWrongCount').textContent = pool.filter(w => w.wrong > 0).length;
  document.getElementById('progressDontKnowCount').textContent = pool.filter(w => w.dontknow > 0).length;
  document.getElementById('progressMasteredCount').textContent = pool.filter(w => w.correct > 0).length;
  document.getElementById('resetProgressBtn').textContent = progressTags.size === 0
    ? 'Reset all progress'
    : `Reset progress for ${[...progressTags].join(', ')}`;
}

// shared sort control for each dedicated progress screen — one mode applies across all three,
// same as progressTags. 'list' groups by primary list (HSK1..HSK4, ES1, then custom tags),
// falling back to `field` (wrong/dontknow/correct count) as a tiebreaker within the same list;
// 'percent' sorts by accuracy ascending (worst first — the words most worth reviewing).
let progressSortMode = 'list';
const LIST_SORT_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'ES1'];
function listSortIndex(tags){
  const idx = LIST_SORT_ORDER.indexOf(primaryTag(tags));
  return idx === -1 ? LIST_SORT_ORDER.length : idx;
}
function sortProgressWords(words, field){
  const sorted = [...words];
  if (progressSortMode === 'percent') {
    sorted.sort((a, b) => {
      const seenA = a.correct + a.wrong, seenB = b.correct + b.wrong;
      const accA = seenA > 0 ? a.correct / seenA : -1;
      const accB = seenB > 0 ? b.correct / seenB : -1;
      return accA - accB;
    });
  } else {
    sorted.sort((a, b) => listSortIndex(a.tags) - listSortIndex(b.tags) || b[field] - a[field]);
  }
  return sorted;
}
function renderProgressSortRow(containerId, onChange){
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  [['list', 'By list'], ['percent', 'By %']].forEach(([mode, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    const refresh = () => { btn.className = progressSortMode === mode ? 'active' : ''; };
    btn.onclick = () => { progressSortMode = mode; refresh(); onChange(); };
    refresh();
    row.appendChild(btn);
  });
}

// starts a fresh round scoped to exactly these words, regardless of which lists are currently
// selected on Home — broadens activeTags to cover whatever lists these words actually belong to
// so they don't get filtered back out, then pins roundKeys directly to them
function startPracticeRound(words){
  if (words.length === 0) return;
  activeTags = new Set(words.flatMap(w => w.tags));
  activeTopics = new Set();
  roundKeys = words.map(w => statKey(w.c, w.m));
  score = 0; total = 0; streak = 0;
  saveSession();
  showScreen('quiz');
}

function renderProgressWrong(){
  renderProgressFilterRow('wrongFilterRow', renderProgressWrong);
  renderProgressSortRow('wrongSortRow', renderProgressWrong);
  const wrongWords = sortProgressWords(progressPool().filter(w => w.wrong > 0), 'wrong');
  const box = document.getElementById('wrongList');
  box.innerHTML = '';
  if (wrongWords.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No wrong answers yet — nice!</div>';
  } else {
    wrongWords.forEach(w => box.appendChild(buildWordRow(w, 'wrong', renderProgressWrong)));
  }
  document.getElementById('resetWrongBtn').classList.toggle('hidden', wrongWords.length === 0);
  const practiceBtn = document.getElementById('practiceWrongBtn');
  practiceBtn.classList.toggle('hidden', wrongWords.length === 0);
  practiceBtn.textContent = `▶ Practice these words (${wrongWords.length})`;
  practiceBtn.onclick = () => startPracticeRound(wrongWords);
}

function renderProgressDontKnow(){
  renderProgressFilterRow('dontKnowFilterRow', renderProgressDontKnow);
  renderProgressSortRow('dontKnowSortRow', renderProgressDontKnow);
  const dontKnowWords = sortProgressWords(progressPool().filter(w => w.dontknow > 0), 'dontknow');
  const box = document.getElementById('dontKnowList');
  box.innerHTML = '';
  if (dontKnowWords.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">Nothing marked "I don\'t know" yet.</div>';
  } else {
    dontKnowWords.forEach(w => box.appendChild(buildWordRow(w, 'dontknow', renderProgressDontKnow)));
  }
  document.getElementById('resetDontKnowBtn').classList.toggle('hidden', dontKnowWords.length === 0);
  const practiceBtn = document.getElementById('practiceDontKnowBtn');
  practiceBtn.classList.toggle('hidden', dontKnowWords.length === 0);
  practiceBtn.textContent = `▶ Practice these words (${dontKnowWords.length})`;
  practiceBtn.onclick = () => startPracticeRound(dontKnowWords);
}

function renderProgressMastered(){
  renderProgressFilterRow('masteredFilterRow', renderProgressMastered);
  renderProgressSortRow('masteredSortRow', renderProgressMastered);
  const masteredWords = sortProgressWords(progressPool().filter(w => w.correct > 0), 'correct');
  const box = document.getElementById('masteredList');
  box.innerHTML = '';
  if (masteredWords.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No mastered words yet.</div>';
  } else {
    // clearing a mastered word's "correct" count un-masters it, so it can appear in quizzes again
    masteredWords.forEach(w => box.appendChild(buildWordRow(w, 'correct', renderProgressMastered)));
  }
  document.getElementById('resetMasteredBtn').classList.toggle('hidden', masteredWords.length === 0);
  const practiceBtn = document.getElementById('practiceMasteredBtn');
  practiceBtn.classList.toggle('hidden', masteredWords.length === 0);
  practiceBtn.textContent = `▶ Practice these words (${masteredWords.length})`;
  practiceBtn.onclick = () => startPracticeRound(masteredWords);
}

// clears just one stat field across the filtered pool, leaving the other fields untouched —
// unlike "Reset all progress" on the hub, which wipes every field for those words
function resetProgressField(field, label, onDone){
  const scopeLabel = progressTags.size === 0 ? 'all lists' : [...progressTags].join(', ');
  const ok = confirm(`Clear "${label}" history for ${scopeLabel}? This can't be undone.`);
  if (!ok) return;
  progressPool().forEach(w => clearWordStat(w.c, w.m, field));
  onDone();
}
document.getElementById('resetWrongBtn').onclick = () => resetProgressField('wrong', "gotten wrong", renderProgressWrong);
document.getElementById('resetDontKnowBtn').onclick = () => resetProgressField('dontknow', "marked I don't know", renderProgressDontKnow);
document.getElementById('resetMasteredBtn').onclick = () => resetProgressField('correct', "mastered", renderProgressMastered);

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

// topic/POS are optional single-select fields — clicking the already-active chip
// deselects it, unlike the required list-tag row above.
function renderAddWordTopicOptions(){
  const row = document.getElementById('addWordTopicRow');
  row.innerHTML = '';
  TOPICS.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t;
    btn.className = newWordTopic === t ? 'active' : '';
    btn.onclick = () => {
      newWordTopic = (newWordTopic === t ? '' : t);
      renderAddWordTopicOptions();
    };
    row.appendChild(btn);
  });
}
function renderAddWordPosOptions(){
  const row = document.getElementById('addWordPosRow');
  row.innerHTML = '';
  POS_LIST.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p;
    btn.className = newWordPos === p ? 'active' : '';
    btn.onclick = () => {
      newWordPos = (newWordPos === p ? '' : p);
      renderAddWordPosOptions();
    };
    row.appendChild(btn);
  });
}

function resetAddWordForm(){
  document.getElementById('inChar').value = '';
  document.getElementById('inPinyin').value = '';
  document.getElementById('inMeaning').value = '';
  document.getElementById('inTag').value = '';
  document.getElementById('addMsg').textContent = '';
  newWordTopic = '';
  newWordPos = '';
  renderAddWordLevelOptions();
  renderAddWordTopicOptions();
  renderAddWordPosOptions();
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
    if (newWordTopic) existing.topic = newWordTopic;
    if (newWordPos) existing.pos = newWordPos;
  } else {
    words.push({ c, p, m, tags: [tag], topic: newWordTopic || undefined, pos: newWordPos || undefined });
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

function syllableCount(p){
  return fixToneCase(p).split(' ').reduce((sum, tok) => sum + greedySyllables(tok).length, 0);
}

/* ---------- hard mode: grouping a character's pool entries into distinct senses ---------- */
// HSK vs ES1 (and other cross-list pairs) frequently restate the exact same word with
// slightly different pinyin notation (e.g. "dì(di)" vs "dìdi") or rephrased wording (e.g.
// "dad" vs "dad; father") — neither should count as a second sense. Only characters that are
// genuinely polyphonic (different reading AND different meaning, e.g. 还 hái "still" vs huán
// "to return") should require selecting more than one option. So two entries are folded into
// the same sense unless BOTH their normalized pinyin and their meaning differ.
function normPinyinForSense(p){ return p.replace(/[()'\s]/g, '').toLowerCase(); }
function normMeaningForSense(m){ return m.trim().toLowerCase(); }
function clusterSenses(entries){
  const clusters = [];
  entries.forEach(e => {
    const match = clusters.find(cl =>
      normPinyinForSense(cl[0].p) === normPinyinForSense(e.p) || normMeaningForSense(cl[0].m) === normMeaningForSense(e.m));
    if (match) match.push(e); else clusters.push([e]);
  });
  return clusters;
}
const HSK_LEVEL_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4'];

// hard mode looks for a character's other senses beyond just the current round's pool: pick
// HSK1..the highest HSK level currently selected on Home, cumulatively, regardless of which
// levels are actually toggled on (e.g. selecting only HSK3 still checks HSK1-3, since a learner
// at HSK3 already knows lower levels) — plus ES1 too, if it's currently active. There's no
// special ES1 exclusion: clusterSenses already merges genuine duplicates (identical pinyin or
// meaning) into a single sense regardless of source, so mixing HSK+ES1 doesn't double up
// near-identical entries — only real polyphones (different pinyin AND different meaning, from
// any source) end up as separate required senses. If no HSK level is selected at all (e.g.
// ES1-only or custom-only), falls back to the round's own pool, unchanged from before.
function senseLookupPool(roundPool){
  let maxIdx = -1;
  activeTags.forEach(t => {
    const idx = HSK_LEVEL_ORDER.indexOf(t);
    if (idx > maxIdx) maxIdx = idx;
  });
  if (maxIdx === -1) return roundPool;
  const levels = new Set(HSK_LEVEL_ORDER.slice(0, maxIdx + 1));
  if (activeTags.has('ES1')) levels.add('ES1');
  return combinedPool().filter(w => w.tags.some(t => levels.has(t)));
}

// the set of pool entries a question must require selecting for `word`'s character — just
// [word] unless hard mode is on and its character genuinely has multiple senses in the lookup
// pool. Only ever expands the *quiz* behavior — normal (non-hard) mode always returns [word],
// so a word's meaning always matches exactly the level it was picked from, never substituted.
function requiredSensesFor(word, pool){
  if (!hardMode) return [word];
  const lookupPool = senseLookupPool(pool);
  let sameChar = lookupPool.filter(w => w.c === word.c);
  if (!sameChar.includes(word)) sameChar = [...sameChar, word];
  if (sameChar.length < 2) return [word];
  const clusters = clusterSenses(sameChar);
  if (clusters.length < 2) return [word];
  return clusters.map(cl => cl.includes(word) ? word : cl[0]);
}

// picks distractors that "look like" the correct word first before falling back to a
// fully random pick, so wrong answers can't be eliminated on sight just because they're
// an obviously different kind of word (e.g. a grammar particle next to a color) or an
// obviously different-length one. Tiers, tightest first: same topic AND same syllable
// count > same syllable count in any topic > same topic+pos > same topic OR pos >
// anything else.
function pickDistractors(pool, word, n){
  const others = pool.filter(w => w !== word);
  const wordSyllables = word.p ? syllableCount(word.p) : null;
  const sameSyllables = w => wordSyllables !== null && w.p && syllableCount(w.p) === wordSyllables;
  const tiers = [
    others.filter(w => word.topic && w.topic === word.topic && sameSyllables(w)),
    others.filter(sameSyllables),
    others.filter(w => word.topic && word.pos && w.topic === word.topic && w.pos === word.pos),
    others.filter(w => (word.topic && w.topic === word.topic) || (word.pos && w.pos === word.pos)),
    others,
  ];
  const picked = [];
  const usedKeys = new Set();
  for (const tier of tiers) {
    if (picked.length >= n) break;
    const candidates = tier.filter(w => !usedKeys.has(statKey(w.c, w.m)));
    const chosen = pickRandom(candidates, n - picked.length, null);
    chosen.forEach(w => usedKeys.add(statKey(w.c, w.m)));
    picked.push(...chosen);
  }
  return picked;
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
  const taggedPool = filteredPool();
  if (taggedPool.length < 6) {
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

  const questionBox = document.getElementById('questionBox');
  questionBox.classList.remove('revealed', 'correct', 'wrong');
  questionBox.onclick = null;
  const feedback = document.getElementById('feedback');
  feedback.textContent = '';
  feedback.className = 'feedback';
  document.getElementById('quizMetaList').classList.add('hidden');
  const dontKnowBtn = document.getElementById('dontKnowBtn');
  dontKnowBtn.disabled = false;
  dontKnowBtn.classList.remove('hidden');

  const candidates = pool.filter(w => w.correct === 0);
  const word = weightedPick(candidates, lastWord);
  lastWord = statKey(word.c, word.m);
  document.getElementById('qMain').textContent = word.c;

  document.getElementById('qTags').innerHTML = word.tags.map(badgeHTML).join('');

  // hard mode: a genuinely polyphonic character (see clusterSenses) requires selecting every
  // one of its senses, not just `word` — degrades to [word] (today's single-answer behavior)
  // whenever hard mode is off or the character only has one sense in this pool
  const requiredWords = requiredSensesFor(word, pool);
  const isMultiSense = requiredWords.length > 1;
  const selected = new Set(); // statKeys of currently-tapped cells, multi-sense mode only

  const multiSelectHint = document.getElementById('multiSelectHint');
  multiSelectHint.classList.toggle('hidden', !isMultiSense);
  if (isMultiSense) multiSelectHint.textContent = `This word has ${requiredWords.length} meanings — select all that apply`;

  const submitBtn = document.getElementById('submitAnswerBtn');
  submitBtn.classList.toggle('hidden', !isMultiSense);
  submitBtn.disabled = true;

  const hintBtn = document.getElementById('hintBtn');
  const hintText = document.getElementById('hintText');
  hintText.textContent = '';
  hintText.classList.add('hidden');
  const hasHint = requiredWords.some(w => w.topic || w.pos);
  hintBtn.classList.toggle('hidden', !hasHint);
  hintBtn.onclick = (e) => {
    e.stopPropagation();
    hintText.textContent = requiredWords.map(w => {
      const parts = [w.topic, w.pos].filter(Boolean).join(' · ');
      return isMultiSense ? `${spacedPinyin(w.p)}: ${parts}` : parts;
    }).join(' | ');
    hintText.classList.remove('hidden');
    hintBtn.classList.add('hidden');
  };

  const opts = document.getElementById('options');
  opts.innerHTML = '';
  opts.classList.remove('hidden');

  const numChoices = Math.min(6, pool.length);
  let choiceWords;
  if (isMultiSense) {
    const requiredKeys = new Set(requiredWords.map(w => statKey(w.c, w.m)));
    const distractorPool = pool.filter(w => !requiredKeys.has(statKey(w.c, w.m)));
    const distractors = pickDistractors(distractorPool, word, Math.max(0, numChoices - requiredWords.length));
    choiceWords = [...requiredWords, ...distractors].sort(() => Math.random() - 0.5);
  } else {
    const distractors = pickDistractors(pool, word, numChoices - 1);
    choiceWords = [...distractors, word].sort(() => Math.random() - 0.5);
  }

  let answered = false;
  function finishQuestion(outcome){ // outcome: 'correct' | 'wrong' | 'dontknow'
    if (answered) return;
    answered = true;
    if (document.activeElement) document.activeElement.blur();
    total++;
    if (isMultiSense) {
      // credit/penalize each required sense individually based on whether it was actually
      // selected, regardless of the overall exact-match outcome — so per-word mastery stays
      // meaningful even when the question came out wrong because a sibling sense was missed
      if (outcome === 'correct') { score++; streak++; } else { streak = 0; }
      if (outcome === 'dontknow') {
        requiredWords.forEach(w => bumpStat(w.c, w.m, 'dontknow'));
      } else {
        requiredWords.forEach(w => bumpStat(w.c, w.m, selected.has(statKey(w.c, w.m)) ? 'correct' : 'wrong'));
      }
    } else if (outcome === 'correct') {
      score++; streak++; bumpStat(word.c, word.m, 'correct');
    } else {
      streak = 0;
      bumpStat(word.c, word.m, outcome);
    }
    // reveal a single flashcard-style answer, matching the Word Detail screen's layout
    // (character + pinyin + meaning + topic/POS per sense), tinted green/red for correct/wrong
    // instead of the list's own accent color; it auto-advances after a couple seconds, but
    // tapping/clicking the card jumps ahead immediately.
    opts.classList.add('hidden');
    dontKnowBtn.classList.add('hidden');
    hintBtn.classList.add('hidden');
    hintText.classList.add('hidden');
    multiSelectHint.classList.add('hidden');
    submitBtn.classList.add('hidden');
    feedback.innerHTML = requiredWords.map(w => `
      <div class="feedback-sense">
        ${isMultiSense ? `<span class="feedback-tags">${w.tags.map(badgeHTML).join('')}</span>` : ''}
        <span class="feedback-pinyin">${spacedPinyin(w.p)}</span>
        <span class="feedback-meaning">${w.m}</span>
      </div>
    `).join('');
    feedback.className = 'feedback revealed';
    document.getElementById('quizMetaList').innerHTML = requiredWords.map(w => `
      <div class="detail-meta-row"><span class="detail-meta-label">${isMultiSense ? spacedPinyin(w.p) + ' — Topic' : 'Topic'}</span><span class="detail-meta-value">${w.topic || '—'}</span></div>
      <div class="detail-meta-row"><span class="detail-meta-label">${isMultiSense ? spacedPinyin(w.p) + ' — Part of speech' : 'Part of speech'}</span><span class="detail-meta-value">${w.pos || '—'}</span></div>
    `).join('');
    document.getElementById('quizMetaList').classList.remove('hidden');
    document.getElementById('scoreOut').textContent = score;
    saveSession();
    if (autoPlaySound) speak(word.c);
    questionBox.classList.add('revealed', outcome === 'correct' ? 'correct' : 'wrong');
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      questionBox.onclick = null;
      newQuestion();
    };
    questionBox.onclick = advance;
    // the round's last word (this answer clears the pool) leads straight into the results
    // screen — leave that reveal on-screen until the player taps it instead of auto-advancing,
    // so they get a moment to see the round's final answer before "Round complete" appears.
    // Checked by re-reading live stats rather than predicting a delta, since a correct
    // multi-sense answer can mark 2+ pool entries done in one go, not just `word` alone.
    const isRoundFinisher = outcome === 'correct' && pool.every(w => getStats(w.c, w.m).correct > 0);
    if (!isRoundFinisher) {
      setTimeout(() => { if (screen === 'quiz') advance(); }, 2500);
    }
  }

  function scoreMultiSelect(){
    const requiredKeys = new Set(requiredWords.map(w => statKey(w.c, w.m)));
    if (selected.size !== requiredKeys.size) return 'wrong';
    for (const k of selected) if (!requiredKeys.has(k)) return 'wrong';
    return 'correct';
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
    if (isMultiSense) {
      const cwKey = statKey(cw.c, cw.m);
      cell.onclick = () => {
        if (answered) return;
        if (selected.has(cwKey)) { selected.delete(cwKey); cell.classList.remove('selected'); }
        else { selected.add(cwKey); cell.classList.add('selected'); }
        submitBtn.disabled = selected.size === 0;
      };
    } else {
      cell.onclick = () => finishQuestion(cw === word ? 'correct' : 'wrong');
    }
    cell.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && cell.onclick) { e.preventDefault(); cell.onclick(); } };
    opts.appendChild(cell);
  });

  submitBtn.onclick = () => finishQuestion(scoreMultiSelect());
  dontKnowBtn.onclick = () => finishQuestion('dontknow');
}

function renderResults(){
  const taggedPool = filteredPool();
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
  const taggedPool = filteredPool();
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

document.getElementById('startBtn').onclick = () => {
  // Start always begins a genuinely new round — Resume is the explicit way to continue
  // whatever round was already in progress instead
  roundKeys = null;
  saveSession();
  showScreen('quiz');
};
document.getElementById('resumeBtn').onclick = () => showScreen('quiz');

/* ---------- navigation ---------- */
const SCREENS = ['home', 'quiz', 'results', 'settings', 'wordDecks', 'myProgress', 'progressWrong', 'progressDontKnow', 'progressMastered', 'addWord', 'wordDetail'];
function showScreen(name){
  SCREENS.forEach(s => document.getElementById(s + 'Screen').classList.toggle('hidden', s !== name));
  screen = name;
  if (name === 'home') { renderTopicFilter(); updateHomePoolCount(); }
  if (name === 'quiz') newQuestion();
  if (name === 'results') renderResults();
  if (name === 'wordDecks') { renderListFilterOptions(); renderDeckTopicFilter(); renderList(); }
  if (name === 'myProgress') renderProgress();
  if (name === 'progressWrong') renderProgressWrong();
  if (name === 'progressDontKnow') renderProgressDontKnow();
  if (name === 'progressMastered') renderProgressMastered();
  if (name === 'addWord') { renderAddWordLevelOptions(); renderAddWordTopicOptions(); renderAddWordPosOptions(); }
  if (name === 'wordDetail') renderWordDetail();
}

function showWordDetail(w){
  detailWord = w;
  showScreen('wordDetail');
}
function renderWordDetail(){
  const w = detailWord;
  if (!w) { showScreen('wordDecks'); return; }
  document.getElementById('detailChar').textContent = w.c;
  document.getElementById('detailPinyin').textContent = spacedPinyin(w.p);
  document.getElementById('detailMeaning').textContent = w.m;
  document.getElementById('detailListTags').innerHTML = w.tags.map(badgeHTML).join('');
  document.getElementById('detailTopic').textContent = w.topic || '—';
  document.getElementById('detailPos').textContent = w.pos || '—';
  document.getElementById('detailSpeakBtn').onclick = () => speak(w.c);
  const tv = tintOf(primaryTag(w.tags));
  document.getElementById('detailCard').style.background = `var(${tv.bg})`;

  // lifetime stats for this word, fetched fresh (not from whatever fields the calling
  // screen's row happened to carry) so they're always accurate
  const s = getStats(w.c, w.m);
  const seen = s.correct + s.wrong;
  const acc = seen > 0 ? Math.round(100 * s.correct / seen) : null;
  document.getElementById('detailCorrect').textContent = s.correct;
  document.getElementById('detailWrong').textContent = s.wrong;
  document.getElementById('detailAccuracy').textContent = acc !== null ? acc + '%' : 'No attempts yet';
}

document.getElementById('homeSettingsBtn').onclick = () => { screenBeforeSettings = 'home'; showScreen('settings'); };
document.getElementById('quizSettingsBtn').onclick = () => { screenBeforeSettings = 'quiz'; showScreen('settings'); };
document.getElementById('quizExitBtn').onclick = () => showScreen('home');
document.getElementById('settingsBackBtn').onclick = () => showScreen(screenBeforeSettings);
document.getElementById('openWordDecksBtn').onclick = () => showScreen('wordDecks');
document.getElementById('wordDecksBackBtn').onclick = () => showScreen('settings');
document.getElementById('homeProgressBtn').onclick = () => showScreen('myProgress');
document.getElementById('myProgressBackBtn').onclick = () => showScreen('home');
document.getElementById('openProgressWrongBtn').onclick = () => showScreen('progressWrong');
document.getElementById('progressWrongBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openProgressDontKnowBtn').onclick = () => showScreen('progressDontKnow');
document.getElementById('progressDontKnowBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openProgressMasteredBtn').onclick = () => showScreen('progressMastered');
document.getElementById('progressMasteredBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openAddWordBtn').onclick = () => showScreen('addWord');
document.getElementById('addWordBackBtn').onclick = () => showScreen('wordDecks');
document.getElementById('wordDetailBackBtn').onclick = () => showScreen('wordDecks');
document.getElementById('darkModeToggle').onclick = toggleDarkMode;
document.getElementById('autoPlaySoundToggle').onclick = toggleAutoPlaySound;
document.getElementById('hardModeToggle').onclick = toggleHardMode;

/* ---------- init ---------- */
loadTheme();
loadAutoPlaySound();
loadHardMode();
loadStats();
activeTags = new Set(Object.keys(BUILTIN_LISTS));
loadSession(); // may override score/total/streak/activeTags/roundSize/roundKeys with a resumed session
loadWords();
// resume straight into an unfinished round on reload instead of always landing on Home;
// newQuestion()/showScreen already handle re-rolling an invalid round, jumping to Results
// if it was already complete, or falling back to Home if the pool's too small now.
showScreen(roundKeys ? 'quiz' : 'home');
