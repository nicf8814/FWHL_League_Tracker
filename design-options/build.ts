// Design mockups only. Assembles one self-contained HTML file per option: the app's real design
// tokens and component CSS (from src/index.css), the bundled fonts as data URIs, the real league and
// draft data (prep.ts), the shared mockup kit and the option's own script.
//   node design-options/build.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { prep } from './prep.ts';

const root = new URL('..', import.meta.url).pathname;
const here = new URL('.', import.meta.url).pathname;
const css = readFileSync(root + 'src/index.css', 'utf8');

// Plain-CSS parts of src/index.css: font faces, the token blocks and the base and component layers.
const fonts = css.match(/@font-face[^\n]+\n/g)!.join('').replace(/url\('\/fonts\/([^']+)'\)/g, (_, f: string) => `url(data:font/woff2;base64,${readFileSync(root + 'public/fonts/' + f).toString('base64')})`);
const tokens = css.slice(css.indexOf(':root {'), css.indexOf('@theme {'));
const motion = css.slice(css.indexOf('/* Motion tokens'), css.indexOf('@layer base'));
const layer = (name: string) => { const s = css.indexOf(`@layer ${name} {`); let d = 0, i = css.indexOf('{', s); const start = i + 1; for (; i < css.length; i++) { if (css[i] === '{') d++; else if (css[i] === '}' && --d === 0) break; } return css.slice(start, i); };
const vars = `:root{--font-display:'Archivo','Arial Narrow',system-ui,sans-serif;--font-sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--font-mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;--text-xs:.75rem;--text-sm:.875rem;--text-base:1rem;--text-lg:1.25rem;--text-xl:1.75rem;--text-2xl:2.5rem;--radius-sm:2px;--radius:4px;--ease-snap:cubic-bezier(.2,.8,.2,1);--ease-out:cubic-bezier(.16,1,.3,1)}`;

const data = prep();
const kitCss = readFileSync(here + 'kit/kit.css', 'utf8');
const kitJs = readFileSync(here + 'kit/kit.js', 'utf8');

const options = [
  { file: 'option-a-ledger-archive.html', script: 'kit/option-a.js', title: 'History A: Ledger Archive' },
  { file: 'option-b-owner-season-grid.html', script: 'kit/option-b.js', title: 'History B: Owner by Season Grid' },
  { file: 'option-c-search-desk.html', script: 'kit/option-c.js', title: 'History C: Search Desk' },
];
for (const o of options) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<style>
${fonts}
${vars}
${tokens}
${motion}
${layer('base')}
${layer('components')}
${kitCss}
</style>
</head>
<body>
<div id="app"></div>
<script>const D = ${JSON.stringify(data)};</script>
<script>${kitJs}</script>
<script>${readFileSync(here + o.script, 'utf8')}</script>
</body>
</html>
`;
  writeFileSync(here + o.file, html);
  console.log(o.file, `${Math.round(html.length / 1024)} KB`);
}
