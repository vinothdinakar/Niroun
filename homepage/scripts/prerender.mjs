// Static prerender: renders every route to HTML at build time so crawlers and link previews
// see real content, then the client hydrates. Runs after `vite build` (client) and
// `vite build --ssr` (server bundle in dist-ssr/).
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ssrDir = join(root, 'dist-ssr');

const { render, ROUTES, NOT_FOUND } = await import(pathToFileURL(join(ssrDir, 'entry-server.js')).href);
const template = await readFile(join(dist, 'index.html'), 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function page(meta, url) {
  const html = render(url);
  return template
    .replace('<div id="root"></div>', () => `<div id="root">${html}</div>`)
    .replace(/<title>.*?<\/title>/, () => `<title>${esc(meta.title)}</title>`)
    .replace('<meta name="description" content="" />', () => `<meta name="description" content="${esc(meta.description)}" />`)
    .replace('<meta property="og:title" content="Bond" />', () => `<meta property="og:title" content="${esc(meta.title)}" />`)
    .replace('<meta property="og:description" content="" />', () => `<meta property="og:description" content="${esc(meta.description)}" />`);
}

for (const meta of ROUTES) {
  const out = meta.path === '/' ? join(dist, 'index.html') : join(dist, meta.path.slice(1), 'index.html');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, page(meta, meta.path));
  console.log('prerendered', meta.path);
}

// Unknown URLs: hosts serve 404.html (the client router shows the not-found page).
await writeFile(join(dist, '404.html'), page(NOT_FOUND, '/this-page-does-not-exist'));
console.log('prerendered 404.html');

await rm(ssrDir, { recursive: true, force: true });
