/** Garde-fous frontend : régressions déjà rencontrées (regex catastrophique, IDs orphelins). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('pas de quantificateur imbriqué dans les regex JS (gel navigateur)', () => {
  // Motif type ([...]*)*  ou (...)+)+ : backtracking catastrophique.
  const nested = /\([^()]*[*+][^()]*\)[*+]/;
  expect(nested.test(appJs)).toBe(false);
});

test('tous les getElementById de app.js existent dans index.html', () => {
  const used = new Set([...appJs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]));
  const defined = new Set([...indexHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !defined.has(id));
  expect(missing).toEqual([]);
});

test('seuils perf et garde-fous génération présents', () => {
  for (const token of [
    'LONG_CONTENT_THRESHOLD',
    'generationId',
    'myId !== generationId',
    'replaceChildren',
    'debounceAdaptive',
  ]) {
    expect(appJs).toContain(token);
  }
});
