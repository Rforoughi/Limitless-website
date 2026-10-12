// Generates one HTML file per page (e.g. implants-what.html) from index.html,
// each with its own <title>, meta description and canonical in the raw HTML,
// so crawlers see the right page before any JavaScript runs.
// Vercel serves /implants-what from implants-what.html (cleanUrls in vercel.json).
//
// Re-run after every edit to index.html:  node build-pages.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://www.limitlessperiodontics.com';
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Reuse the per-page titles/descriptions that showPage() already uses
const metaMatch = src.match(/const pageMeta = (\{[\s\S]*?\n  \});/);
if (!metaMatch) throw new Error('pageMeta object not found in index.html');
const pageMeta = new Function(`return ${metaMatch[1]}`)();

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function replaceOnce(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`${label} not found in index.html`);
  return html.replace(pattern, replacement);
}

const written = [];
for (const [id, meta] of Object.entries(pageMeta)) {
  if (id === 'home') continue;
  if (!src.includes(`id="page-${id}"`)) throw new Error(`No section #page-${id} in index.html`);

  let html = src;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeText(meta.title)}</title>`, '<title>');
  html = replaceOnce(html, /<meta name="description" content="[^"]*"\/>/,
    `<meta name="description" content="${escapeAttr(meta.desc)}"/>`, 'meta description');
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"\/>/,
    `<link rel="canonical" href="${SITE}/${id}"/>`, 'canonical');

  // FAQ schema describes the home page FAQ only
  html = html.replace(/<script type="application\/ld\+json">\s*\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "FAQPage"[\s\S]*?<\/script>\n?/, '');

  // Show this page's section (not home's) in the raw HTML
  html = replaceOnce(html, /class="page active" id="page-home"/, 'class="page" id="page-home"', 'home section');
  html = html.replace(new RegExp(`<div (class="page" id="page-${id}"|id="page-${id}" class="page")>`),
    `<div class="page active" id="page-${id}">`);

  // One <h1> per page: demote the home hero's <h1>, then promote this page's
  // heading (marked class="page-h1") to <h1>
  html = replaceOnce(html, /<h1 class="page-h1">([\s\S]*?)<\/h1>/, '<h2 class="page-h1">$1</h2>', 'home <h1>');
  const start = html.indexOf(`id="page-${id}"`);
  const head = /<(h2|strong) class="([^"]*\bpage-h1\b[^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g;
  head.lastIndex = start;
  const h = head.exec(html);
  const nextPage = html.indexOf('class="page', start + 1);
  if (!h || (nextPage !== -1 && h.index > nextPage)) throw new Error(`No page-h1 heading in #page-${id}`);
  html = html.slice(0, h.index) + `<h1 class="${h[2]}"${h[3]}>${h[4]}</h1>` + html.slice(h.index + h[0].length);
  if (html.match(/<h1[\s>]/g).length !== 1) throw new Error(`${id}: expected exactly one <h1>`);

  const out = `${id}.html`;
  fs.writeFileSync(path.join(__dirname, out), html);
  written.push(out);
}

console.log(`Wrote ${written.length} pages: ${written.join(', ')}`);
