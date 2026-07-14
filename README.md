# Chinese Vocab Builder

A small self-hosted flashcard/quiz app for learning Mandarin vocabulary, built around
five built-in word lists (HSK1, HSK2, HSK3, HSK4, and a textbook list you can label however you
like, e.g. `ES1`) with support for adding your own words and tags. Built-in lists are
available directly on the Quiz page — no import step needed.

Pure HTML/CSS/JS — no build step, no framework, no backend. Words are saved in the
browser's `localStorage`, so progress is per-browser (clearing site data will reset it).

## Files

- `index.html` — page structure
- `style.css` — styling (light/dark mode via `prefers-color-scheme`)
- `data.js` — the HSK1, HSK2, HSK3, HSK4, and ES1 word list data
- `script.js` — app logic: tagging, spaced-repetition-weighted quiz, pinyin syllable
  splitting, text-to-speech via the browser's built-in `SpeechSynthesis` API

## Run locally

No build tools needed. Just open `index.html` in a browser, or serve it locally:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then visit `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create a new repo on GitHub (e.g. `chinese-vocab-builder`), don't initialize it
   with a README (you already have one here).
2. From this folder:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

3. On GitHub: go to **Settings → Pages**, set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`, then save.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

## Notes on the pinyin syllable splitter

Pinyin in `data.js` is written in standard Hanyu Pinyin orthography (syllables of one
word are written together, e.g. `diànhuà` for 电话). `script.js` includes a small
heuristic tokenizer (`spacedPinyin`) that splits merged pinyin into one syllable per
character for display, so a 2-character word always shows 2 pinyin syllables. It's
not a dictionary-backed splitter — just a valid-initial/valid-final matcher — so an
occasional word may split oddly. If you spot one, the easiest fix is to add a
`'` (apostrophe) in that word's pinyin in `data.js` at the syllable boundary
(e.g. `nǚ'ér`), which forces a hard break there.

## Ideas for extending this in Claude Code

- Swap `localStorage` for a real backend (e.g. a small SQLite/Express API, or
  Supabase) if you want progress to sync across devices.
- Add HSK5+ word lists, or a CSV/JSON import for your own textbook lists.
- Add a "due today" spaced-repetition view (e.g. SM-2 style scheduling) instead of
  the current wrong-answer weighting.
- Export/import your word list as JSON so you can back it up or move it between
  browsers.
