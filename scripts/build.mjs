import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['src/app.js', 'src/engine.js', 'src/roads.js', 'src/session.js']) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
await mkdir(resolve(root, 'dist'), { recursive: true });
for (const file of ['index.html', 'favicon.svg', 'src']) await cp(resolve(root, file), resolve(root, 'dist', file), { recursive: true });
await writeFile(resolve(root, 'dist', '.nojekyll'), '');
const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
if (!html.includes('./src/app.js')) throw new Error('Missing app entrypoint');
const css = await readFile(resolve(root, 'src/styles.css'), 'utf8');
const scriptParts = [];
for (const file of ['engine.js', 'roads.js', 'session.js', 'app.js']) {
  scriptParts.push((await readFile(resolve(root, 'src', file), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''));
}
const bundled = scriptParts.join('\n\n');
new Function(bundled); // Syntax validation only; the browser executes the bundle.
const standalone = html.replace('  <link rel="icon" href="./favicon.svg" type="image/svg+xml">\n', '')
  .replace('<link rel="stylesheet" href="./src/styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./src/app.js"></script>', () => `<script>document.addEventListener('DOMContentLoaded', () => {\n'use strict';\n${bundled}\n});</script>`)
  .replace('href="./" aria-label="바카라 테이블 홈"', 'href="" aria-label="바카라 테이블 홈"');
await writeFile(resolve(root, 'dist/offline.html'), standalone);
console.log('Build successful: dist/ (static HTML, CSS and ES modules; no external dependencies)');
console.log('Offline edition: dist/offline.html (open directly in a browser)');
