const STORAGE_KEY = 'hsk-vocab-words';
let words = [];
let score = 0, total = 0, streak = 0, lastWord = null;
let activeTags = new Set();

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

/* ---------- stats ---------- */
function computeStats(){
  const hskSet = new Set(FULL_HSK1.map(w => w[0] + '::' + w[2]));
  let overlap = 0;
  FULL_ES1.forEach(w => { if (hskSet.has(w[0] + '::' + w[2])) overlap++; });
  const combinedUnique = FULL_HSK1.length + FULL_ES1.length - overlap;
  document.getElementById('statsLine').textContent =
    `HSK1: ${FULL_HSK1.length} words · ES1: ${FULL_ES1.length} words · ${overlap} overlap · combined unique: ${combinedUnique}`;
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
  activeTags = new Set(words.flatMap(w => w.tags));
  renderList();
  renderTagOptions();
}
function saveWords(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(words)); } catch (e) {}
}

function importList(list, tag){
  let added = 0, merged = 0;
  list.forEach(([c, p, m]) => {
    const existing = words.find(w => w.c === c && w.m === m);
    if (existing) {
      if (!existing.tags.includes(tag)) { existing.tags.push(tag); merged++; }
    } else {
      words.push({ c, p, m, tags: [tag], correct: 0, wrong: 0 });
      added++;
    }
  });
  return { added, merged };
}

document.getElementById('bulkBtnHSK').onclick = () => {
  const { added, merged } = importList(FULL_HSK1, 'HSK1');
  saveWords();
  activeTags.add('HSK1');
  renderList(); renderTagOptions();
  let msg = added > 0 ? `added ${added} new words` : 'no new words';
  if (merged > 0) msg += `, tagged ${merged} existing words as HSK1 too`;
  document.getElementById('bulkMsg').textContent = `${msg} (${words.length} total)`;
};

document.getElementById('bulkBtnES1').onclick = () => {
  const { added, merged } = importList(FULL_ES1, 'ES1');
  saveWords();
  activeTags.add('ES1');
  renderList(); renderTagOptions();
  let msg = added > 0 ? `added ${added} new words` : 'no new words';
  if (merged > 0) msg += `, tagged ${merged} existing words as ES1 too`;
  document.getElementById('bulkMsg').textContent = `${msg} (${words.length} total)`;
};

/* ---------- tags ---------- */
function tagClass(tag){
  if (tag.startsWith('HSK')) return 'hsk';
  if (tag.startsWith('ES')) return 'es';
  return 'other';
}

function renderTagOptions(){
  const tags = [...new Set(words.flatMap(w => w.tags))];
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
function renderList(){
  document.getElementById('countLabel').textContent = `${words.length} ${words.length === 1 ? 'word' : 'words'} saved`;
  const box = document.getElementById('wordList');
  box.innerHTML = '';
  if (words.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No words yet — import a list above or add your own.</div>';
    return;
  }
  [...words].reverse().forEach(w => {
    const idx = words.indexOf(w);
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
      <button class="del-btn" data-idx="${idx}" aria-label="Delete">✕</button>
    `;
    box.appendChild(row);
  });
  box.querySelectorAll('.del-btn').forEach(b => {
    b.onclick = () => {
      words.splice(parseInt(b.dataset.idx), 1);
      saveWords();
      renderList();
      renderTagOptions();
    };
  });
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
  if (existing) {
    if (!existing.tags.includes(tag)) existing.tags.push(tag);
    msg.textContent = `${c} already existed, tagged as ${tag} too`;
  } else {
    words.push({ c, p, m, tags: [tag], correct: 0, wrong: 0 });
    msg.textContent = `added ${c} (${tag})`;
  }
  saveWords();
  document.getElementById('inChar').value = '';
  document.getElementById('inPinyin').value = '';
  document.getElementById('inMeaning').value = '';
  activeTags.add(tag);
  renderList();
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

function weightedPick(pool, exclude){
  const weights = pool.map(w => {
    const base = 1 + w.wrong * 2.5 - w.correct * 0.4;
    const clamped = Math.max(0.3, base);
    const jitter = 0.6 + Math.random() * 0.8;
    let val = clamped * jitter;
    if (w === exclude) val *= 0.15;
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
  const pool = words.filter(w => w.tags.some(t => activeTags.has(t)));
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
  lastWord = word;
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
        score++; streak++; word.correct++;
        mainBtn.classList.add('correct');
        feedback.textContent = `✓ correct — ${word.c} (${spacedPinyin(word.p)}) = ${word.m}`;
        feedback.className = 'feedback correct';
      } else {
        streak = 0; word.wrong++;
        mainBtn.classList.add('wrong');
        feedback.textContent = `✗ answer: ${word.c} (${spacedPinyin(word.p)}) = ${word.m}`;
        feedback.className = 'feedback wrong';
      }
      opts.querySelectorAll('.option-main').forEach((b2, i2) => {
        b2.disabled = true;
        if (choiceWords[i2] === word && !isCorrect) b2.classList.add('correct');
      });
      saveWords();
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
computeStats();
loadWords();
