const STORAGE_KEY = 'hsk-vocab-words';
const STATS_KEY = 'hsk-vocab-stats';
const BUILTIN_LISTS = { HSK1: FULL_HSK1, HSK2: FULL_HSK2, ES1: FULL_ES1 };
let words = []; // user's own custom words: { c, p, m, tags }
let statsMap = {}; // key (c::m) -> { correct, wrong }, covers built-in + custom words
let score = 0, total = 0, streak = 0, lastWord = null;
let activeTags = new Set();
let listSearch = '';
let listFilterTags = new Set();

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

/* ---------- stats (per-word progress, keyed by character+meaning) ---------- */
function statKey(c, m){ return c + '::' + m; }
function getStats(c, m){ return statsMap[statKey(c, m)] || { correct: 0, wrong: 0 }; }
function bumpStat(c, m, field){
  const k = statKey(c, m);
  if (!statsMap[k]) statsMap[k] = { correct: 0, wrong: 0 };
  statsMap[k][field]++;
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
    return { c: w.c, p: w.p, m: w.m, tags: [...w.tags], correct: s.correct, wrong: s.wrong };
  });
}

function updateStatsLine(){
  const counts = Object.entries(BUILTIN_LISTS).map(([tag, list]) => `${tag}: ${list.length} words`).join(' · ');
  document.getElementById('statsLine').textContent =
    `Built-in lists (pick on the Quiz page): ${counts}`;
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
}
function saveWords(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(words)); } catch (e) {}
}

/* ---------- tags ---------- */
function tagClass(tag){
  if (tag.startsWith('HSK')) return 'hsk';
  if (tag.startsWith('ES')) return 'es';
  return 'other';
}

function renderTagOptions(){
  const tags = [...new Set(combinedPool().flatMap(w => w.tags))];
  document.getElementById('tagOptions').innerHTML = tags.map(t => `<option value="${t}">`).join('');
  const filterRow = document.getElementById('tagFilterRow');
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
      refresh();
      newQuestion();
    };
    refresh();
    filterRow.appendChild(btn);
  });
}

/* ---------- word list ---------- */
function renderListFilterOptions(){
  const tags = [...new Set(words.flatMap(w => w.tags))];
  const filterRow = document.getElementById('listFilterRow');
  filterRow.innerHTML = '';
  // drop selected tags that no longer exist (e.g. after deleting the last word with that tag)
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
  const query = listSearch.trim();
  const hasQuery = query.length > 0;
  const q = detone(query); // lowercases + strips tone marks; a no-op for Chinese characters
  // with no search text, show only your own custom words; once you search, look across built-in lists too
  const source = hasQuery
    ? combinedPool()
    : words.map(w => { const s = getStats(w.c, w.m); return { c: w.c, p: w.p, m: w.m, tags: w.tags, correct: s.correct, wrong: s.wrong }; });
  const filtered = source.filter(w => {
    if (listFilterTags.size && !w.tags.some(t => listFilterTags.has(t))) return false;
    if (!hasQuery) return true;
    return w.c.includes(query) || detone(w.p).includes(q) || w.m.toLowerCase().includes(q);
  });
  document.getElementById('countLabel').textContent = hasQuery
    ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} across all lists`
    : `${filtered.length} of ${words.length} ${words.length === 1 ? 'word' : 'words'} shown`;
  const box = document.getElementById('wordList');
  box.innerHTML = '';
  if (!hasQuery && words.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No custom words yet — add your own below, or pick a built-in list on the Quiz page.</div>';
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
      <span class="tags">${badges}</span>
      <span class="acc">${acc !== null ? acc + '%' : 'new'}</span>
      ${idx !== -1 ? `<button class="del-btn" data-idx="${idx}" aria-label="Delete">✕</button>` : '<span class="del-btn-spacer"></span>'}
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
    };
  });
}

document.getElementById('searchWord').oninput = (e) => {
  listSearch = e.target.value;
  renderList();
};

function findBuiltinTags(c){
  return Object.entries(BUILTIN_LISTS)
    .filter(([, list]) => list.some(([lc]) => lc === c))
    .map(([tag]) => tag);
}

document.getElementById('addBtn').onclick = () => {
  const c = document.getElementById('inChar').value.trim();
  const p = document.getElementById('inPinyin').value.trim();
  const m = document.getElementById('inMeaning').value.trim();
  const tag = document.getElementById('inTag').value.trim() || 'untagged';
  const msg = document.getElementById('addMsg');
  if (!c || !p || !m) {
    msg.textContent = 'fill in character, pinyin, and meaning';
    return;
  }
  const existing = words.find(w => w.c === c && w.m === m);
  let msgText;
  if (existing) {
    if (!existing.tags.includes(tag)) existing.tags.push(tag);
    msgText = `${c} already existed, tagged as ${tag} too`;
  } else {
    words.push({ c, p, m, tags: [tag] });
    msgText = `added ${c} (${tag})`;
  }
  const builtinTags = findBuiltinTags(c);
  if (builtinTags.length) {
    msgText += ` — heads up, ${c} is already in ${builtinTags.join(', ')}`;
  }
  msg.textContent = msgText;
  saveWords();
  document.getElementById('inChar').value = '';
  document.getElementById('inPinyin').value = '';
  document.getElementById('inMeaning').value = '';
  renderList();
  renderListFilterOptions();
  renderTagOptions();
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
    const base = 1 + w.wrong * 2.5 - w.correct * 0.4;
    const clamped = Math.max(0.3, base);
    const jitter = 0.6 + Math.random() * 0.8;
    let val = clamped * jitter;
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
  const notEnough = document.getElementById('notEnough');
  document.getElementById('nextBtn').classList.add('hidden');
  const pool = combinedPool().filter(w => w.tags.some(t => activeTags.has(t)));
  if (pool.length < 4) {
    notEnough.textContent = 'select tags with at least 4 words total to quiz';
    document.getElementById('questionBox').classList.add('hidden');
    document.getElementById('options').innerHTML = '';
    document.getElementById('feedback').textContent = '';
    return;
  }
  notEnough.textContent = '';
  document.getElementById('questionBox').classList.remove('hidden');
  const feedback = document.getElementById('feedback');
  feedback.textContent = '';
  feedback.className = 'feedback';

  const word = weightedPick(pool, lastWord);
  lastWord = statKey(word.c, word.m);
  document.getElementById('qMain').textContent = word.c;

  const opts = document.getElementById('options');
  opts.innerHTML = '';

  const numChoices = Math.min(6, pool.length);
  const distractors = pickRandom(pool, numChoices - 1, word);
  const choiceWords = [...distractors, word].sort(() => Math.random() - 0.5);

  let answered = false;
  choiceWords.forEach(cw => {
    const row = document.createElement('div');
    row.className = 'option-row';

    const mainBtn = document.createElement('button');
    mainBtn.className = 'option-main';
    mainBtn.innerHTML = `<span class="top">${spacedPinyin(cw.p)}</span><span class="bottom">${cw.m}</span>`;

    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-btn';
    speakBtn.setAttribute('aria-label', 'play audio');
    speakBtn.textContent = '🔊';
    speakBtn.onclick = (e) => { e.stopPropagation(); speak(cw.c); };

    mainBtn.onclick = () => {
      if (answered) return;
      answered = true;
      total++;
      const isCorrect = (cw === word);
      if (isCorrect) {
        score++; streak++; bumpStat(word.c, word.m, 'correct');
        mainBtn.classList.add('correct');
        feedback.textContent = `✓ correct — ${word.c} (${spacedPinyin(word.p)}) = ${word.m}`;
        feedback.className = 'feedback correct';
      } else {
        streak = 0; bumpStat(word.c, word.m, 'wrong');
        mainBtn.classList.add('wrong');
        feedback.textContent = `✗ answer: ${word.c} (${spacedPinyin(word.p)}) = ${word.m}`;
        feedback.className = 'feedback wrong';
      }
      opts.querySelectorAll('.option-main').forEach((b2, i2) => {
        b2.disabled = true;
        if (choiceWords[i2] === word && !isCorrect) b2.classList.add('correct');
      });
      document.getElementById('scoreOut').textContent = `${score} / ${total}`;
      document.getElementById('streakOut').textContent = streak;
      document.getElementById('nextBtn').classList.remove('hidden');
    };

    row.appendChild(mainBtn);
    row.appendChild(speakBtn);
    opts.appendChild(row);
  });
}

document.getElementById('nextBtn').onclick = newQuestion;

/* ---------- tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    if (b.dataset.tab === 'add') {
      document.getElementById('addPane').classList.remove('hidden');
      document.getElementById('quizPane').classList.add('hidden');
    } else {
      document.getElementById('addPane').classList.add('hidden');
      document.getElementById('quizPane').classList.remove('hidden');
      newQuestion();
    }
  };
});

/* ---------- init ---------- */
updateStatsLine();
loadStats();
activeTags = new Set(Object.keys(BUILTIN_LISTS));
loadWords();
