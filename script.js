const STORAGE_KEY = 'hsk-vocab-words';
const STATS_KEY = 'hsk-vocab-stats';
const SESSION_KEY = 'hsk-vocab-session';
const THEME_KEY = 'hsk-vocab-theme';
const AUTOPLAY_SOUND_KEY = 'hsk-vocab-autoplay-sound';
const HARD_MODE_KEY = 'hsk-vocab-hard-mode';
const HANZI_FONT_KEY = 'hsk-vocab-hanzi-font';
const SRS_KEY = 'hsk-vocab-srs';
const FLASHCARD_SESSION_KEY = 'hsk-vocab-flashcard-session';
const LAST_STUDY_MODE_KEY = 'hsk-vocab-last-study-mode'; // 'quiz' or 'flashcards' — which resumable session to prefer on load if both exist
const CHAPTER_PROGRESS_KEY = 'hsk-vocab-chapter-progress'; // { [listTag]: chapterNumber } — "studied through chapter N", set explicitly in Settings/end-of-session, never inferred from whatever's browsed in the picker
// build number = this script's own cache-busting "?v=" query param, so it's never a second
// place that needs bumping — reading it back out just reflects whatever was already bumped
const APP_BUILD = (() => {
  try {
    const src = document.currentScript && document.currentScript.src;
    const m = src && src.match(/[?&]v=(\d+)/);
    return m ? m[1] : '?';
  } catch (e) { return '?'; }
})();
const BUILTIN_LISTS = { HSK1: FULL_HSK1, HSK2: FULL_HSK2, HSK3: FULL_HSK3, HSK4: FULL_HSK4, HSK5: FULL_HSK5, ES1: FULL_ES1, ES2: FULL_ES2 };
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
let chapterTaggedOnly = false;
const UNSEEN_BONUS = 8; // weight multiplier for words never asked before (correct+wrong+dontknow === 0)
let roundSize = 'all'; // 25|50|100|150|200|250|'all' — how many unique words make up the current round
let roundKeys = null; // array of statKeys in the current round, or null if not yet rolled
const ROUND_SIZES = [25, 50, 100, 150, 200, 250];
let progressTags = new Set(); // Settings' progress-list filter; empty means "all lists"
let darkMode = false;
let autoPlaySound = true;
let hardMode = false; // when on, a character with 2+ genuinely distinct senses (see clusterSenses)
let hanziFont = 'serif';
                       // requires selecting all of them + Submit, instead of tap-one-to-answer
let screen = 'home'; // 'home' | 'quiz' | 'results' | 'settings' | 'addWord'
let screenBeforeSettings = 'home';

/* ---------- Learning Mode: chapter-by-chapter flashcard review (separate from the quiz) ---------- */
let learningList = null; // built-in list tag currently picked, e.g. 'ES1', or null if none yet
let learningChapters = new Set(); // chapter numbers explicitly ticked in the chip picker
let learningCumulative = false; // "include all chapters before this one too"
let chapterProgress = {}; // { [listTag]: chapterNumber } — see CHAPTER_PROGRESS_KEY; independent of learningChapters/learningCumulative, which are just this session's browsing selection
let flashcardPool = [];
let flashcardIndex = 0;
let flashcardRevealed = false;
// Ebbinghaus-style review schedule, day-level only (no intraday steps like 5min/30min/12hr —
// this is a local app with no notifications to pull someone back that soon, so the schedule
// starts at "1 day" and stretches out from there as a word keeps being recalled instantly).
const SRS_INTERVALS_DAYS = [1, 2, 4, 7, 15, 31];
let srsMap = {}; // key (c::m) -> { intervalIndex, nextReviewAt, lastRatedAt }, set only by flashcard self-ratings
// one label+icon per SRS_INTERVALS_DAYS step, for showing "how well remembered" in plain terms
// instead of raw interval numbers — a growth theme (seedling -> potted plant -> grass -> flower
// -> tree -> forest), icons are Material Symbols, inlined with fill="currentColor"
const SRS_LEVELS = [
  { label: 'New', icon: '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M440-120v-319q-64 0-123-24.5T213-533q-45-45-69-104t-24-123v-80h80q63 0 122 24.5T426-746q31 31 51.5 68t31.5 79q5-7 11-13.5t13-13.5q45-45 104-69.5T760-720h80v80q0 64-24.5 123T746-413q-45 45-103.5 69T520-320v200h-80Zm0-400q0-48-18.5-91.5T369-689q-34-34-77.5-52.5T200-760q0 48 18 92t52 78q34 34 78 52t92 18Zm80 120q48 0 91.5-18t77.5-52q34-34 52.5-78t18.5-92q-48 0-92 18.5T590-569q-34 34-52 77.5T520-400Zm0 0Zm-80-120Z"/></svg>' },
  { label: 'Learning', icon: '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M342-160h276l40-160H302l40 160Zm0 80q-28 0-49-17t-28-44l-45-179h520l-45 179q-7 27-28 44t-49 17H342ZM200-400h560v-80H200v80Zm280-240q0-100 70-170t170-70q0 90-57 156t-143 80v84h320v160q0 33-23.5 56.5T760-320H200q-33 0-56.5-23.5T120-400v-160h320v-84q-86-14-143-80t-57-156q100 0 170 70t70 170Z"/></svg>' },
  { label: 'Familiar', icon: '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M80-160v-80h230q-22-85-83.5-146.5T80-470q20-5 39.5-7.5T160-480q134 0 227 93t93 227H80Zm480 0q0-42-9-83.5T525-323q42-71 114.5-114T800-480q21 0 40.5 2.5T880-470q-85 22-146 83.5T650-240h230v80H560Zm-80-239q0-65 24-122t66-100.5q42-43.5 98.5-69.5T789-719q-56 35-98 86t-65 114q-44 21-80.5 51.5T480-399Zm-73-75q-12-9-24-17t-25-16q0-6 1-12.5t1-12.5q0-76-24-144t-68-124q66 27 114.5 77.5T457-606q-18 30-31 63.5T407-474Z"/></svg>' },
  { label: 'Known', icon: '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M480-600q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm-70.5 218.5Q378-403 364-438q-5 0-9 .5t-9 .5q-52 0-89-37t-37-89q0-21 7-40.5t21-36.5q-13-17-20-36.5t-7-40.5q0-52 36.5-89t88.5-37q5 0 9 .5t9 .5q14-35 45.5-56.5T480-920q39 0 70.5 21.5T596-842q5 0 9-.5t9-.5q52 0 88.5 37t36.5 89q0 21-6.5 40.5T712-640q13 17 20 36.5t7 40.5q0 52-36.5 89T614-437q-5 0-9-.5t-9-.5q-14 35-45.5 56.5T480-360q-39 0-70.5-21.5ZM480-80q0-74 28.5-139.5T586-334q49-49 114.5-77.5T840-440q0 74-28.5 139.5T734-186q-49 49-114.5 77.5T480-80Zm98-98q57-21 100-64t64-100q-57 21-100 64t-64 100Zm-98 98q0-74-28.5-139.5T374-334q-49-49-114.5-77.5T120-440q0 74 28.5 139.5T226-186q49 49 114.5 77.5T480-80Zm-98-98q-57-21-100-64t-64-100q57 21 100 64t64 100Zm196 0Zm-196 0Zm232-339q19 0 32.5-13.5T660-563q0-14-7.5-24.5T633-604l-35-17q-2 11-6 21.5t-9 19.5q-5 9-12 17t-15 15l32 23q5 4 11.5 6t14.5 2Zm-16-142 35-17q12-6 19-17t7-24q0-19-13-32.5T614-763q-8 0-14 2t-12 6l-33 23q8 7 15.5 15t12.5 17q5 9 9 19.5t6 21.5Zm-159-93q10-4 20-6t21-2q11 0 21 2t20 6l5-44q2-18-12.5-31T480-840q-19 0-33.5 13T434-796l5 44Zm41 312q19 0 33.5-13t12.5-31l-5-44q-10 4-20 6t-21 2q-11 0-21-2t-20-6l-5 44q-2 18 12.5 31t33.5 13ZM362-659q2-11 6-21.5t9-19.5q5-9 12-17t15-15l-32-23q-5-4-11.5-6t-14.5-2q-19 0-32.5 13.5T300-717q0 13 7.5 24t19.5 17l35 17Zm-16 141q8 0 14-1.5t12-6.5l33-22q-8-7-15.5-15T377-580q-5-9-9-19.5t-6-21.5l-35 17q-12 6-19 17t-7 24q1 19 13.5 32t31.5 13Zm237-62Zm0-120Zm-103-60Zm0 240ZM377-700Zm0 120Z"/></svg>' },
  { label: 'Strong', icon: '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M200-80v-80h240v-160h-80q-83 0-141.5-58.5T160-520q0-60 33-110.5t89-73.5q9-75 65.5-125.5T480-880q76 0 132.5 50.5T678-704q56 23 89 73.5T800-520q0 83-58.5 141.5T600-320h-80v160h240v80H200Zm160-320h240q50 0 85-35t35-85q0-36-20.5-66T646-630l-42-18-6-46q-6-45-39.5-75.5T480-800q-45 0-78.5 30.5T362-694l-6 46-42 18q-33 14-53.5 44T240-520q0 50 35 85t85 35Zm120-200Z"/></svg>' },
  { label: 'Expert', icon: '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M280-80v-160H0l154-240H80l280-400 120 172 120-172 280 400h-74l154 240H680v160H520v-160h-80v160H280Zm389-240h145L659-560h67L600-740l-71 101 111 159h-74l103 160Zm-523 0h428L419-560h67L360-740 234-560h67L146-320Zm0 0h155-67 252-67 155-428Zm523 0H566h74-111 197-67 155-145Zm-149 80h160-160Zm201 0Z"/></svg>' },
];
function srsLevel(intervalIndex){ return SRS_LEVELS[intervalIndex] || SRS_LEVELS[0]; }
function srsBadgeHTML(intervalIndex){
  const lvl = srsLevel(intervalIndex);
  return `<span class="srs-badge">${lvl.icon}<span class="srs-badge-label">${lvl.label}</span></span>`;
}

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

/* ---------- character font used for the big hanzi in quiz questions & flashcards ---------- */
function loadHanziFont(){
  const saved = localStorage.getItem(HANZI_FONT_KEY);
  hanziFont = saved === 'sans' || saved === 'hand' ? saved : 'serif';
  applyHanziFont();
}
function applyHanziFont(){
  document.body.classList.remove('hanzi-font-serif', 'hanzi-font-sans', 'hanzi-font-hand');
  document.body.classList.add(`hanzi-font-${hanziFont}`);
  document.querySelectorAll('[data-font]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.font === hanziFont);
  });
}
function setHanziFont(font){
  hanziFont = font;
  try { localStorage.setItem(HANZI_FONT_KEY, font); } catch (e) {}
  applyHanziFont();
}
// quick font-preview popover on the quiz card / flashcard — picking an option here changes the
// same font used everywhere (Settings just controls the initial default)
function setupHanziFontMenu(triggerId, menuId){
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  trigger.onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  };
  menu.querySelectorAll('[data-font]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      setHanziFont(btn.dataset.font);
      menu.classList.add('hidden');
    };
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== trigger) {
      menu.classList.add('hidden');
    }
  });
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

/* ---------- spaced repetition (flashcard self-ratings only — quiz answers never touch this) ---------- */
function loadSrs(){
  try {
    const raw = localStorage.getItem(SRS_KEY);
    srsMap = raw ? JSON.parse(raw) : {};
  } catch (e) {
    srsMap = {};
  }
}
function saveSrs(){
  try { localStorage.setItem(SRS_KEY, JSON.stringify(srsMap)); } catch (e) {}
}
function getSrs(c, m){ return srsMap[statKey(c, m)] || null; }
function clearWordSrs(c, m){
  const k = statKey(c, m);
  if (!srsMap[k]) return;
  delete srsMap[k];
  saveSrs();
}
// only words that have actually been rated at least once and have fallen past their scheduled
// review time count as "due" — a never-studied word isn't due for review, it's due to be
// learned for the first time (that's what plain "Start flashcards" is for). Without this,
// "Review due words" would flood a session with brand-new, never-seen words from chapters the
// learner hasn't gotten to yet, which is discouraging rather than a helpful review queue.
function isDue(w){
  const s = getSrs(w.c, w.m);
  return !!s && s.nextReviewAt <= Date.now();
}
// rating: 'unknown' resets the schedule to day 1 (regardless of prior progress); 'hesitant'
// repeats the current step without advancing; 'instant' advances one step (capped at the
// longest interval, which then just keeps repeating at that spacing)
function rateFlashcard(w, rating){
  const k = statKey(w.c, w.m);
  const cur = srsMap[k];
  const curIdx = cur ? cur.intervalIndex : -1;
  let idx;
  if (rating === 'unknown') idx = 0;
  else if (rating === 'hesitant') idx = Math.max(curIdx, 0);
  else idx = Math.min(curIdx + 1, SRS_INTERVALS_DAYS.length - 1);
  const days = SRS_INTERVALS_DAYS[idx];
  srsMap[k] = { intervalIndex: idx, nextReviewAt: Date.now() + days * 86400000, lastRatedAt: Date.now() };
  saveSrs();
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
      if (!map.has(k)) map.set(k, { c, p, m, tags: new Set(), pos: pos || null, topic: topic || null, chapters: {} });
      // a word can be shared across lists (e.g. HSK1 and ES1 both teaching 八), each with its
      // own book's own lesson order — a single word can genuinely have a different chapter
      // number per list, so chapters is keyed by list tag rather than one shared value
      if (chapter) map.get(k).chapters[tag] = chapter;
      map.get(k).tags.add(tag);
    });
  });
  words.forEach(w => {
    const k = statKey(w.c, w.m);
    if (!map.has(k)) map.set(k, { c: w.c, p: w.p, m: w.m, tags: new Set(), pos: w.pos || null, topic: w.topic || null, chapters: {} });
    w.tags.forEach(t => map.get(k).tags.add(t));
  });
  return [...map.values()].map(w => {
    const s = getStats(w.c, w.m);
    return { c: w.c, p: w.p, m: w.m, tags: [...w.tags], pos: w.pos, topic: w.topic, chapters: w.chapters, correct: s.correct, wrong: s.wrong, dontknow: s.dontknow, srs: getSrs(w.c, w.m) };
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
  hsk5: { bg: '--hsk5-bg', solid: '--hsk5-text' },
  es: { bg: '--es-bg', solid: '--es-text' },
  other: { bg: '--surface-1', solid: '--accent-solid' },
};
function primaryTag(tags){
  const order = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'ES1', 'ES2'];
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
  if (tag === 'HSK5') return 'hsk5';
  if (tag.startsWith('ES')) return 'es';
  if (tag === 'untagged') return 'other';
  return 'custom-tag';
}

// which visual row a list tag belongs in wherever list-picker buttons are rendered: HSK1-4
// together, then ES1 (and future ES2/ES3 as they're added) on their own row below, regardless
// of container width — see appendTagRowBreak()
function tagGroup(tag){
  if (tag.startsWith('HSK')) return 'hsk';
  if (tag.startsWith('ES')) return 'es';
  return 'other';
}
// inserts a forced line-break in a flex-wrap tag row when the group changes (see tagGroup),
// so callers just need to pass the previous tag in the iteration alongside the current one
function appendTagRowBreak(container, tag, prevTag){
  if (prevTag && tagGroup(tag) !== tagGroup(prevTag)) {
    container.appendChild(document.createElement('span')).className = 'tag-row-break';
  }
}
// tags collected from combinedPool() (via a Set over each word's own tags) end up in
// whatever order words happened to be merged in, not list order — e.g. a word shared between
// HSK1 and ES1 can make 'ES1' appear before 'HSK2' just because that shared word was merged
// early. Sort explicitly instead of relying on incidental insertion order: HSK1-4 first (in
// numeric order), then ES1/ES2/ES3.. (also numeric), then any custom list tags alphabetically.
function sortListTags(tags){
  const groupOrder = { hsk: 0, es: 1, other: 2 };
  return [...tags].sort((a, b) => {
    const ga = tagGroup(a), gb = tagGroup(b);
    if (ga !== gb) return groupOrder[ga] - groupOrder[gb];
    return a.localeCompare(b, undefined, { numeric: true });
  });
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
  const tags = sortListTags(new Set(combinedPool().flatMap(w => w.tags)));
  document.getElementById('tagOptions').innerHTML = tags.map(t => `<option value="${t}">`).join('');
  renderTagRow('tagFilterRow', tags);
}
function renderTagRow(containerId, tags){
  const filterRow = document.getElementById(containerId);
  filterRow.innerHTML = '';
  let prevTag = null;
  tags.forEach(t => {
    appendTagRowBreak(filterRow, t, prevTag);
    prevTag = t;
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
function renderTopicChipFilter(chipsId, selectId, activeSet, onChange, options = TOPICS, placeholder = '+ Add a topic…'){
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
  const remaining = options.filter(t => !activeSet.has(t));
  select.innerHTML = `<option value="" selected disabled>${placeholder}</option>`
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

/* ---------- Learning Mode: list/chapter picker ---------- */
function chaptersForList(tag){
  const list = BUILTIN_LISTS[tag] || [];
  const chapters = new Set();
  list.forEach(([, , , , , chapter]) => { if (chapter) chapters.add(chapter); });
  return [...chapters].sort((a, b) => a - b);
}
function chapterTaggedListTags(){
  return Object.keys(BUILTIN_LISTS).filter(t => chaptersForList(t).length > 0);
}
// ticking chapter 8 with the cumulative toggle on reviews 1-8, not just 8 — same idea as hard
// mode's cumulative HSK-level lookup (see senseLookupPool()/HSK_LEVEL_ORDER). No chapters
// explicitly ticked means "all chapters of this list" by default, not "none".
function effectiveLearningChapters(){
  if (learningChapters.size === 0) return new Set(chaptersForList(learningList));
  if (!learningCumulative) return new Set(learningChapters);
  const maxChapter = Math.max(...learningChapters);
  return new Set(chaptersForList(learningList).filter(c => c <= maxChapter));
}
function learningPool(){
  if (!learningList) return [];
  const chapters = effectiveLearningChapters();
  if (chapters.size === 0) return [];
  return combinedPool().filter(w => w.tags.includes(learningList) && chapters.has(w.chapters[learningList]));
}

/* ---------- chapter progress: "studied through chapter N" per list, set explicitly in
   Settings or via the end-of-flashcard-session prompt — deliberately independent of
   learningChapters/learningCumulative (the picker above), which is just free browsing and
   never writes here on its own. Used to scope "Review due words" to chapters actually studied. */
function loadChapterProgress(){
  try {
    const raw = localStorage.getItem(CHAPTER_PROGRESS_KEY);
    chapterProgress = raw ? JSON.parse(raw) : {};
  } catch (e) {
    chapterProgress = {};
  }
}
function saveChapterProgress(){
  try { localStorage.setItem(CHAPTER_PROGRESS_KEY, JSON.stringify(chapterProgress)); } catch (e) {}
}
function setChapterProgress(tag, chapter){
  if (chapter > 0) chapterProgress[tag] = chapter; else delete chapterProgress[tag];
  saveChapterProgress();
}
// words in `tag` at or below its marked "studied through" chapter — empty if nothing marked yet
function studiedPoolForList(tag){
  const maxCh = chapterProgress[tag] || 0;
  if (!tag || maxCh === 0) return [];
  return combinedPool().filter(w => w.tags.includes(tag) && w.chapters[tag] && w.chapters[tag] <= maxCh);
}
function renderChapterProgressScreen(){
  const container = document.getElementById('chapterProgressList');
  container.innerHTML = '';
  chapterTaggedListTags().forEach(tag => {
    const current = chapterProgress[tag] || 0;
    const wrap = document.createElement('div');
    wrap.className = 'settings-menu-item settings-menu-item-stack';
    const label = document.createElement('span');
    label.textContent = `${tag} — ${current > 0 ? `studied through chapter ${current}` : 'not started'}`;
    wrap.appendChild(label);
    const select = document.createElement('select');
    select.className = 'chapter-progress-select';
    const noneOpt = document.createElement('option');
    noneOpt.value = '0';
    noneOpt.textContent = 'None';
    select.appendChild(noneOpt);
    chaptersForList(tag).forEach(ch => {
      const opt = document.createElement('option');
      opt.value = String(ch);
      opt.textContent = `Chapter ${ch}`;
      select.appendChild(opt);
    });
    select.value = String(current);
    select.onchange = () => { setChapterProgress(tag, Number(select.value)); renderChapterProgressScreen(); };
    wrap.appendChild(select);
    container.appendChild(wrap);
  });
}

function renderLearningHome(){
  const listRow = document.getElementById('learningListRow');
  listRow.innerHTML = '';
  let prevListTag = null;
  chapterTaggedListTags().forEach(t => {
    appendTagRowBreak(listRow, t, prevListTag);
    prevListTag = t;
    const btn = document.createElement('button');
    btn.textContent = t;
    const cls = tagClass(t);
    if (cls === 'custom-tag') btn.style.setProperty('--tag-hue', tagHue(t));
    btn.className = learningList === t ? `active ${cls}` : '';
    btn.onclick = () => {
      if (learningList !== t) {
        learningList = t;
        learningChapters = new Set();
        learningCumulative = false;
      }
      renderLearningHome();
    };
    listRow.appendChild(btn);
  });

  const chapterSection = document.getElementById('learningChapterSection');
  chapterSection.classList.toggle('hidden', !learningList);
  if (learningList) {
    renderTopicChipFilter('learningChapterChips', 'learningChapterSelect', learningChapters, () => {
      renderLearningHome();
    }, chaptersForList(learningList), '+ Add a chapter…');
    const cumToggle = document.getElementById('learningCumulativeToggle');
    cumToggle.classList.toggle('on', learningCumulative);
    cumToggle.setAttribute('aria-checked', String(learningCumulative));
  }

  const pool = learningPool();
  // due words are scoped to what's actually marked studied (Settings > Chapter progress), not
  // to whatever chapters happen to be browsed/selected above — see studiedPoolForList()
  const duePool = studiedPoolForList(learningList).filter(isDue);
  const allChaptersLabel = learningList && learningChapters.size === 0 ? ' (all chapters)' : '';
  document.getElementById('learningPoolCount').textContent = pool.length
    ? `${pool.length} word${pool.length === 1 ? '' : 's'} in this selection${allChaptersLabel} · ${duePool.length} due for review today`
    : 'Pick at least one chapter to continue';
  document.getElementById('learningStartBtn').disabled = pool.length === 0;
  document.getElementById('learningQuizBtn').disabled = pool.length === 0;
  document.getElementById('learningReviewDueBtn').disabled = duePool.length === 0;
}
document.getElementById('learningChapterSelect').onchange = (e) => {
  const v = e.target.value;
  if (!v) return;
  learningChapters.add(Number(v));
  renderLearningHome();
};
document.getElementById('learningCumulativeToggle').onclick = () => {
  learningCumulative = !learningCumulative;
  renderLearningHome();
};
document.getElementById('learningStartBtn').onclick = () => startFlashcards();
document.getElementById('learningQuizBtn').onclick = () => startPracticeRound(learningPool());
document.getElementById('learningReviewDueBtn').onclick = () => startFlashcards(studiedPoolForList(learningList).filter(isDue));
document.getElementById('homeModeLearningBtn').onclick = () => showScreen('learningHome');
document.getElementById('learningModeQuizBtn').onclick = () => showScreen('home');

/* ---------- Learning Mode: flashcards ---------- */
// unlike the quiz round (whose progress is derivable from statsMap + roundKeys alone),
// flashcard position/reveal state has nowhere else to live, so it needs its own explicit
// session snapshot to survive a reload — stores statKeys rather than full word objects so it
// stays valid even if word data changes between saves
function saveFlashcardSession(){
  try {
    localStorage.setItem(FLASHCARD_SESSION_KEY, JSON.stringify({
      poolKeys: flashcardPool.map(w => statKey(w.c, w.m)),
      index: flashcardIndex,
      revealed: flashcardRevealed,
      learningList,
    }));
  } catch (e) {}
}
function loadFlashcardSession(){
  try {
    const raw = localStorage.getItem(FLASHCARD_SESSION_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.poolKeys) || s.poolKeys.length === 0) return false;
    if (!(s.index < s.poolKeys.length)) return false; // already finished this session
    const byKey = new Map(combinedPool().map(w => [statKey(w.c, w.m), w]));
    const pool = s.poolKeys.map(k => byKey.get(k)).filter(Boolean);
    if (pool.length === 0) return false;
    flashcardPool = pool;
    flashcardIndex = Math.min(s.index || 0, pool.length - 1);
    flashcardRevealed = !!s.revealed;
    if (s.learningList) learningList = s.learningList;
    return true;
  } catch (e) {
    return false;
  }
}
function startFlashcards(pool = learningPool()){
  if (pool.length === 0) return;
  flashcardPool = pickRandom(pool, pool.length, null);
  flashcardIndex = 0;
  flashcardRevealed = false;
  saveFlashcardSession();
  showScreen('flashcards');
}
function renderFlashcard(){
  const card = document.getElementById('flashcardCard');
  const doneBox = document.getElementById('flashcardDone');
  const rateRow = document.getElementById('flashcardRateRow');
  const hint = document.getElementById('flashcardRevealHint');
  if (flashcardIndex >= flashcardPool.length) {
    card.classList.add('hidden');
    hint.classList.add('hidden');
    rateRow.classList.add('hidden');
    doneBox.classList.remove('hidden');
    document.getElementById('flashcardDoneText').textContent =
      `You've reviewed all ${flashcardPool.length} word${flashcardPool.length === 1 ? '' : 's'} in this selection.`;
    document.getElementById('flashcardPositionText').textContent = '';
    // offer to advance the "studied through" marker (Settings > Chapter progress) only if this
    // session actually reached further than it — never offered to move it backward, and never
    // shown at all for a session with no chapter context (e.g. reviewing a mixed word list)
    const markBtn = document.getElementById('flashcardMarkLearnedBtn');
    const maxChapter = learningList
      ? Math.max(0, ...flashcardPool.map(w => (w.tags.includes(learningList) && w.chapters[learningList]) || 0))
      : 0;
    const currentProgress = learningList ? (chapterProgress[learningList] || 0) : 0;
    if (learningList && maxChapter > currentProgress) {
      markBtn.textContent = `Mark ${learningList} chapter ${maxChapter} as learned`;
      markBtn.classList.remove('hidden');
      markBtn.onclick = () => {
        setChapterProgress(learningList, maxChapter);
        markBtn.classList.add('hidden');
      };
    } else {
      markBtn.classList.add('hidden');
    }
    return;
  }
  card.classList.remove('hidden');
  doneBox.classList.add('hidden');
  const w = flashcardPool[flashcardIndex];
  const wordChapter = w.chapters[learningList];
  const chapterBadge = wordChapter ? `<span class="badge">Ch ${wordChapter}</span>` : '';
  document.getElementById('flashcardTags').innerHTML = w.tags.map(badgeHTML).join('') + chapterBadge;
  document.getElementById('flashcardChar').textContent = w.c;
  document.getElementById('flashcardPinyin').textContent = spacedPinyin(w.p);
  document.getElementById('flashcardMeaning').textContent = w.m;
  document.getElementById('flashcardSpeakBtn').onclick = (e) => { e.stopPropagation(); speak(w.c); };
  const disambigEl = document.getElementById('flashcardDisambig');
  const example = findDisambiguationExample(w);
  disambigEl.classList.toggle('hidden', !example);
  if (example) disambigEl.innerHTML = `as in <b>${example.c}</b>`;
  document.getElementById('flashcardRevealInfo').classList.toggle('hidden', !flashcardRevealed);
  hint.classList.toggle('hidden', flashcardRevealed);
  rateRow.classList.toggle('hidden', !flashcardRevealed);
  document.getElementById('flashcardPositionText').textContent = `${flashcardIndex + 1} / ${flashcardPool.length}`;
}
function revealFlashcard(){
  if (flashcardRevealed) return;
  flashcardRevealed = true;
  saveFlashcardSession();
  renderFlashcard();
  if (autoPlaySound) speak(flashcardPool[flashcardIndex].c);
}
function nextFlashcard(){
  flashcardIndex++;
  flashcardRevealed = false;
  saveFlashcardSession();
  renderFlashcard();
}
// a rating button both records the self-assessment (which reschedules the word's next
// review per the Ebbinghaus-style day intervals) and advances to the next card in one tap
function rateAndAdvance(rating){
  const w = flashcardPool[flashcardIndex];
  rateFlashcard(w, rating);
  nextFlashcard();
}
document.getElementById('flashcardCard').onclick = revealFlashcard;
document.getElementById('flashcardRateUnknownBtn').onclick = () => rateAndAdvance('unknown');
document.getElementById('flashcardRateHesitantBtn').onclick = () => rateAndAdvance('hesitant');
document.getElementById('flashcardRateInstantBtn').onclick = () => rateAndAdvance('instant');
document.getElementById('flashcardRestartBtn').onclick = () => startFlashcards(flashcardPool);
document.getElementById('flashcardBackBtn').onclick = () => showScreen('learningHome');
document.getElementById('flashcardBackToPickerBtn').onclick = () => showScreen('learningHome');

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
function countChapterTagged(){
  return combinedPool().filter(w => Object.keys(w.chapters).length > 0).length;
}

function renderListFilterOptions(){
  const tags = sortListTags(new Set(combinedPool().flatMap(w => w.tags)));
  const filterRow = document.getElementById('listFilterRow');
  filterRow.innerHTML = '';
  // drop selected tags that no longer exist (e.g. after deleting the last custom word with that tag)
  listFilterTags.forEach(t => { if (!tags.includes(t)) listFilterTags.delete(t); });
  let prevTag = null;
  tags.forEach(t => {
    appendTagRowBreak(filterRow, t, prevTag);
    prevTag = t;
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
  document.getElementById('chapterTaggedCount').textContent = `(${countChapterTagged()})`;
  const query = listSearch.trim();
  const hasQuery = query.length > 0;
  const hasFilter = listFilterTags.size > 0 || listFilterTopics.size > 0;
  const expanded = hasQuery || hasFilter || overlapOnly || chapterTaggedOnly;
  const q = detone(query); // lowercases + strips tone marks; a no-op for Chinese characters
  // with no search text, tag filter, or overlap toggle, show only your own custom words;
  // any of those look across the built-in lists too
  const source = expanded
    ? combinedPool()
    : words.map(w => { const s = getStats(w.c, w.m); return { c: w.c, p: w.p, m: w.m, tags: w.tags, topic: w.topic, pos: w.pos, correct: s.correct, wrong: s.wrong }; });
  const filtered = source.filter(w => {
    if (overlapOnly && !isOverlap(w)) return false;
    if (chapterTaggedOnly && Object.keys(w.chapters || {}).length === 0) return false;
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
function renderProgressFilterRow(containerId, onChange, tagsOverride){
  const allTags = sortListTags(new Set(combinedPool().flatMap(w => w.tags)));
  const tags = tagsOverride || allTags;
  // drop selected tags that no longer exist (e.g. after deleting the last custom word with that
  // tag) — checked against every valid tag, not just this row's (possibly restricted) button set,
  // since progressTags is shared across all 4 progress screens
  progressTags.forEach(t => { if (!allTags.includes(t)) progressTags.delete(t); });
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  let prevTag = null;
  tags.forEach(t => {
    appendTagRowBreak(row, t, prevTag);
    prevTag = t;
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
  document.getElementById('progressFlashcardCount').textContent = flashcardStudiedPool().length;
  document.getElementById('resetProgressBtn').textContent = progressTags.size === 0
    ? 'Reset all progress'
    : `Reset progress for ${[...progressTags].join(', ')}`;
}

// shared sort control for each dedicated progress screen — one mode applies across all three,
// same as progressTags. 'list' groups by primary list (HSK1..HSK5, ES1, then custom tags),
// falling back to `field` (wrong/dontknow/correct count) as a tiebreaker within the same list;
// 'percent' sorts by accuracy ascending (worst first — the words most worth reviewing).
let progressSortMode = 'list';
const LIST_SORT_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'ES1', 'ES2'];
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

// this list filters by memory level (New/Learning/.../Expert) instead of by word list — the
// other 3 lists' progressTags filter doesn't apply here
let progressSrsLevels = new Set();
function renderSrsLevelFilterRow(containerId, onChange){
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  SRS_LEVELS.forEach((lvl, i) => {
    const btn = document.createElement('button');
    btn.className = 'srs-filter-btn';
    btn.innerHTML = `${lvl.icon}<span>${lvl.label}</span>`;
    const refresh = () => { btn.classList.toggle('active', progressSrsLevels.has(i)); };
    btn.onclick = () => {
      if (progressSrsLevels.has(i)) progressSrsLevels.delete(i); else progressSrsLevels.add(i);
      refresh();
      onChange();
    };
    refresh();
    row.appendChild(btn);
  });
}
function flashcardStudiedPool(){
  return combinedPool().filter(w => w.srs
    && (progressSrsLevels.size === 0 || progressSrsLevels.has(w.srs.intervalIndex))
    && (progressTags.size === 0 || w.tags.some(t => progressTags.has(t))));
}

// unlike the other 3 lists (which sort "worst first" by a wrong/dontknow/correct count),
// least-confident-first here means lowest SRS interval index — no percent-accuracy concept
// applies to flashcard self-ratings
function renderProgressFlashcard(){
  // restricted to chapter-tagged lists only — this filter exists to narrow "studied via
  // flashcard" down to a specific list for chapter-based review, which only makes sense for
  // lists that actually have chapters (HSK1, ES1, ES2)
  renderProgressFilterRow('flashcardListFilterRow', renderProgressFlashcard, chapterTaggedListTags());
  renderSrsLevelFilterRow('flashcardFilterRow', renderProgressFlashcard);
  const studiedWords = flashcardStudiedPool().sort((a, b) => a.srs.intervalIndex - b.srs.intervalIndex);
  const box = document.getElementById('flashcardProgressList');
  box.innerHTML = '';
  if (studiedWords.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No words studied in Flashcard mode yet.</div>';
  } else {
    studiedWords.forEach(w => box.appendChild(buildFlashcardProgressRow(w, renderProgressFlashcard)));
  }
  document.getElementById('resetFlashcardProgressBtn').classList.toggle('hidden', studiedWords.length === 0);
  // routes to Flashcard, not Quiz — flashcard is what actually reads/updates srsMap, so it's
  // the mode that matches what this list is tracking (see SRS_LEVELS)
  const practiceBtn = document.getElementById('practiceFlashcardProgressBtn');
  practiceBtn.classList.toggle('hidden', studiedWords.length === 0);
  practiceBtn.textContent = `▶ Review these words (${studiedWords.length})`;
  practiceBtn.onclick = () => startFlashcards(studiedWords);
}
function buildFlashcardProgressRow(w, onCleared){
  const badges = w.tags.map(badgeHTML).join(' ');
  const row = document.createElement('div');
  row.className = 'word-row';
  row.innerHTML = `
    <span class="char">${w.c}</span>
    <span class="pinyin">${spacedPinyin(w.p)}</span>
    <span class="meaning">${w.m}</span>
    <span class="row-meta">
      <span class="tags">${badges}</span>
      ${srsBadgeHTML(w.srs.intervalIndex)}
    </span>
    <button class="del-btn" aria-label="Clear">✕</button>
  `;
  row.querySelector('.del-btn').onclick = () => {
    clearWordSrs(w.c, w.m);
    if (onCleared) onCleared();
  };
  return row;
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
document.getElementById('resetFlashcardProgressBtn').onclick = () => {
  const levelLabel = progressSrsLevels.size === 0 ? 'all levels' : [...progressSrsLevels].map(i => SRS_LEVELS[i].label).join(', ');
  const listLabel = progressTags.size === 0 ? 'all lists' : [...progressTags].join(', ');
  const ok = confirm(`Clear flashcard study progress for ${levelLabel} (${listLabel})? This can't be undone.`);
  if (!ok) return;
  flashcardStudiedPool().forEach(w => clearWordSrs(w.c, w.m));
  renderProgressFlashcard();
};

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

document.getElementById('chapterTaggedOnly').onchange = (e) => {
  chapterTaggedOnly = e.target.checked;
  renderList();
};

/* ---------- add word ---------- */
function renderAddWordLevelOptions(){
  const row = document.getElementById('addWordLevelRow');
  row.innerHTML = '';
  const current = document.getElementById('inTag').value.trim();
  let prevTag = null;
  // hardcoded rather than derived from BUILTIN_LISTS since this offers every built-in list as
  // an Add Word destination regardless of whether the user has any words in it yet — add future
  // lists (e.g. ES2/ES3) here too when they're added to data.js
  ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'ES1', 'ES2'].forEach(t => {
    appendTagRowBreak(row, t, prevTag);
    prevTag = t;
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
const HSK_LEVEL_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5'];

// for a genuinely polyphonic single character (per clusterSenses, same definition hard mode
// uses), find a compound word elsewhere in the pool that uses this exact reading, so a
// flashcard for e.g. 乐/yuè "music" can show "as in 音乐" instead of looking like an unexplained
// duplicate of the 乐/lè "happy" card. spacedPinyin already splits a compound's merged pinyin
// into one syllable per character (see README's pinyin splitter notes), which is what lets this
// line the found word's syllable up against this specific reading.
function findDisambiguationExample(w){
  const chars = [...w.c];
  if (chars.length !== 1) return null;
  const siblings = combinedPool().filter(x => x.c === w.c);
  if (clusterSenses(siblings).length < 2) return null;
  const candidates = combinedPool().filter(x => x.c.length > 1 && x.c.includes(w.c));
  for (const cand of candidates) {
    const candChars = [...cand.c];
    const idx = candChars.indexOf(w.c);
    const syllables = spacedPinyin(cand.p).split(' ');
    if (idx !== -1 && syllables[idx] && syllables[idx].toLowerCase() === w.p.toLowerCase()) {
      return cand;
    }
  }
  return null;
}

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
const SCREENS = ['home', 'learningHome', 'flashcards', 'quiz', 'results', 'settings', 'chapterProgress', 'wordDecks', 'myProgress', 'progressWrong', 'progressDontKnow', 'progressMastered', 'progressFlashcard', 'addWord', 'wordDetail'];
function showScreen(name){
  SCREENS.forEach(s => document.getElementById(s + 'Screen').classList.toggle('hidden', s !== name));
  screen = name;
  // which of the two resumable sessions to prefer on the next load, if both are pending
  if (name === 'quiz' || name === 'flashcards') {
    try { localStorage.setItem(LAST_STUDY_MODE_KEY, name); } catch (e) {}
  }
  if (name === 'home') { renderTopicFilter(); updateHomePoolCount(); }
  if (name === 'learningHome') renderLearningHome();
  if (name === 'flashcards') renderFlashcard();
  if (name === 'quiz') newQuestion();
  if (name === 'results') renderResults();
  if (name === 'chapterProgress') renderChapterProgressScreen();
  if (name === 'wordDecks') { renderListFilterOptions(); renderDeckTopicFilter(); renderList(); }
  if (name === 'myProgress') renderProgress();
  if (name === 'progressWrong') renderProgressWrong();
  if (name === 'progressDontKnow') renderProgressDontKnow();
  if (name === 'progressMastered') renderProgressMastered();
  if (name === 'progressFlashcard') renderProgressFlashcard();
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

  const srs = getSrs(w.c, w.m);
  const srsDueRow = document.getElementById('detailSrsDueRow');
  if (srs) {
    document.getElementById('detailSrsLevel').innerHTML = srsBadgeHTML(srs.intervalIndex);
    srsDueRow.classList.remove('hidden');
    document.getElementById('detailSrsDue').textContent = formatSrsDue(srs.nextReviewAt);
  } else {
    document.getElementById('detailSrsLevel').textContent = 'Not studied yet';
    srsDueRow.classList.add('hidden');
  }
}
// "In 3 days (Jul 25)", or "Due now" once nextReviewAt has passed
function formatSrsDue(ts){
  const days = Math.ceil((ts - Date.now()) / 86400000);
  if (days <= 0) return 'Due now';
  const dateStr = new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `In ${days} day${days === 1 ? '' : 's'} (${dateStr})`;
}

document.getElementById('homeSettingsBtn').onclick = () => { screenBeforeSettings = 'home'; showScreen('settings'); };
document.getElementById('quizSettingsBtn').onclick = () => { screenBeforeSettings = 'quiz'; showScreen('settings'); };
document.getElementById('quizExitBtn').onclick = () => showScreen('home');
document.getElementById('settingsBackBtn').onclick = () => showScreen(screenBeforeSettings);
document.getElementById('openWordDecksBtn').onclick = () => showScreen('wordDecks');
document.getElementById('wordDecksBackBtn').onclick = () => showScreen('settings');
document.getElementById('openChapterProgressBtn').onclick = () => showScreen('chapterProgress');
document.getElementById('chapterProgressBackBtn').onclick = () => showScreen('settings');
document.getElementById('homeProgressBtn').onclick = () => showScreen('myProgress');
document.getElementById('learningProgressBtn').onclick = () => showScreen('myProgress');
document.getElementById('learningSettingsBtn').onclick = () => { screenBeforeSettings = 'learningHome'; showScreen('settings'); };
document.getElementById('homeModeQuizBtn').onclick = () => showScreen('home');
document.getElementById('learningModeLearningBtn').onclick = () => showScreen('learningHome');
document.getElementById('myProgressBackBtn').onclick = () => showScreen('home');
document.getElementById('openProgressWrongBtn').onclick = () => showScreen('progressWrong');
document.getElementById('progressWrongBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openProgressDontKnowBtn').onclick = () => showScreen('progressDontKnow');
document.getElementById('progressDontKnowBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openProgressMasteredBtn').onclick = () => showScreen('progressMastered');
document.getElementById('progressMasteredBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openProgressFlashcardBtn').onclick = () => showScreen('progressFlashcard');
document.getElementById('progressFlashcardBackBtn').onclick = () => showScreen('myProgress');
document.getElementById('openAddWordBtn').onclick = () => showScreen('addWord');
document.getElementById('addWordBackBtn').onclick = () => showScreen('wordDecks');
document.getElementById('wordDetailBackBtn').onclick = () => showScreen('wordDecks');
document.getElementById('darkModeToggle').onclick = toggleDarkMode;
document.getElementById('autoPlaySoundToggle').onclick = toggleAutoPlaySound;
document.getElementById('hardModeToggle').onclick = toggleHardMode;
document.querySelectorAll('#hanziFontRow .mode-switch-btn').forEach((btn) => {
  btn.onclick = () => setHanziFont(btn.dataset.font);
});
setupHanziFontMenu('qFontBtn', 'qFontMenu');
setupHanziFontMenu('flashcardFontBtn', 'flashcardFontMenu');
document.getElementById('appVersionBtn').textContent = `HanZi Quiz · Build ${APP_BUILD}`;
document.getElementById('appVersionBtn').onclick = () => {
  alert(`HanZi Quiz\nBuild ${APP_BUILD}\n\nWord lists:\nHSK1-5 — official HSK 3.0 vocabulary lists\nES1/ES2 — Easy Steps to Chinese 1/2 (textbooks)`);
};
document.getElementById('checkUpdateBtn').onclick = async () => {
  if (!('serviceWorker' in navigator)) { alert('Updates aren\'t supported in this browser.'); return; }
  if (!navigator.onLine) { alert('You\'re offline — connect to the internet to check for updates.'); return; }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) {}
  // force a real network fetch of index.html — with the old service worker gone, this can't
  // be served from a stale cache anymore. Your word lists, stats and settings (localStorage)
  // are untouched by any of this.
  location.reload();
};

/* ---------- init ---------- */
loadTheme();
loadAutoPlaySound();
loadHardMode();
loadHanziFont();
loadStats();
loadSrs();
loadChapterProgress();
activeTags = new Set(); // no word list selected by default — the user picks explicitly
loadSession(); // may override score/total/streak/activeTags/roundSize/roundKeys with a resumed session
loadWords();
// resume straight into an unfinished round/flashcard session on reload instead of always
// landing on Home; newQuestion()/showScreen already handle re-rolling an invalid quiz round,
// jumping to Results if it was already complete, or falling back to Home if the pool's too
// small now. If both a quiz round and a flashcard session are pending, prefer whichever one
// was actually active most recently (see LAST_STUDY_MODE_KEY in showScreen).
const flashcardResumed = loadFlashcardSession();
const lastStudyMode = localStorage.getItem(LAST_STUDY_MODE_KEY);
if (flashcardResumed && (lastStudyMode === 'flashcards' || !roundKeys)) {
  showScreen('flashcards');
} else if (roundKeys) {
  showScreen('quiz');
} else {
  showScreen('home');
}

// offline support: cache name is tied to APP_BUILD (see sw.js), so bumping the usual ?v= is
// all that's needed to invalidate stale cached assets
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`sw.js?v=${APP_BUILD}`).catch(() => {});
  });
}
