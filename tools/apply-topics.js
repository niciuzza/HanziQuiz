#!/usr/bin/env node
// Rewrites the Topic column of one built-in word list in data.js.
//
//   node tools/apply-topics.js FULL_HSK5 path/to/topics.json
//
// The JSON is { "<row index>": "<Topic>" } against the list as it stands, because HSK5 and HSK6
// each carry a few characters twice with different readings (处, 调, 系) and keying by the word
// would move both. Topics must come from the TOPICS list in script.js; anything else is refused
// rather than written, since a typo'd topic silently disappears from the filter.
//
// Only the Topic field changes. The block is re-emitted from the parsed rows at five per line,
// which is how data.js already writes these lists, so the diff shows the lines that moved and
// nothing else.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'data.js');
const PER_LINE = 5;

function topicVocabulary(){
  const src = fs.readFileSync(path.join(REPO, 'script.js'), 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('const TOPICS = '));
  if (!line) throw new Error('could not find TOPICS in script.js');
  return new Set(JSON.parse(line.slice(line.indexOf('['), line.lastIndexOf(']') + 1).replace(/'/g, '"')));
}

function readList(name){
  const src = fs.readFileSync(DATA, 'utf8').replace(/const /g, 'var ');
  return new Function(`${src}; return ${name};`)();
}

function blockRange(text, name){
  const start = text.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`${name} not found in data.js`);
  const open = text.indexOf('[', start);
  const close = text.indexOf('\n];', open);
  if (close < 0) throw new Error(`could not find the end of ${name}`);
  return { open, close };
}

function main(){
  const [name, file] = process.argv.slice(2);
  if (!name || !file) {
    console.error('usage: node tools/apply-topics.js FULL_HSK5 topics.json');
    process.exit(1);
  }
  const topics = topicVocabulary();
  const rows = readList(name);
  const changes = JSON.parse(fs.readFileSync(file, 'utf8'));

  const bad = Object.values(changes).filter((t) => !topics.has(t));
  if (bad.length) throw new Error(`not topics in script.js: ${[...new Set(bad)].join(', ')}`);

  let moved = 0;
  for (const [key, topic] of Object.entries(changes)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= rows.length) throw new Error(`row ${key} is outside ${name}`);
    if (rows[i][4] !== topic) { rows[i][4] = topic; moved++; }
  }

  const lines = [];
  for (let i = 0; i < rows.length; i += PER_LINE) {
    lines.push(rows.slice(i, i + PER_LINE).map((r) => JSON.stringify(r)).join(',') + ',');
  }
  const text = fs.readFileSync(DATA, 'utf8');
  const { open, close } = blockRange(text, name);
  fs.writeFileSync(DATA, text.slice(0, open) + '[\n' + lines.join('\n') + text.slice(close));

  const other = rows.filter((r) => !r[4] || r[4] === 'Other').length;
  console.log(`${name}: ${moved} row${moved === 1 ? '' : 's'} retopiced`);
  console.log(`  now "Other": ${other} of ${rows.length} (${Math.round((100 * other) / rows.length)}%)`);
}

main();
