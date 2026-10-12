// Builds the site's pages from src/index.html — edit that file, never the generated ones.
//
// Each page (index.html for home, implants-what.html, blog-*.html, …) contains
// only its own section plus the shared header, menu and scripts, with its own
// <title>, meta description, canonical and single <h1> in the raw HTML, so
// crawlers see distinct pages before any JavaScript runs.
// Vercel serves /implants-what from implants-what.html (cleanUrls in vercel.json).
//
// Also writes sitemap.xml and per-page BreadcrumbList / BlogPosting JSON-LD.
// Re-run after every edit to src/index.html:  node build-pages.mjs
// Local crawl testing: SITE_URL=http://localhost:3000 node build-pages.mjs
// (then rebuild without it before committing).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = (process.env.SITE_URL || 'https://www.limitlessperiodontics.com').replace(/\/$/, '');
const src = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');

// Reuse the per-page titles/descriptions that showPage() already uses
const metaMatch = src.match(/const pageMeta = (\{[\s\S]*?\n  \});/);
if (!metaMatch) throw new Error('pageMeta object not found in src/index.html');
const pageMeta = new Function(`return ${metaMatch[1]}`)();

// Verified first-publication dates (page shows the same month). Posts not listed
// get no datePublished until their visible date matches when they really went live.
const BLOG_DATES = { 'blog-gum-disease-signs': '2026-04-15', 'blog-implant-cost': '2026-10-03' };
const PRACTICE_ID = 'https://www.limitlessperiodontics.com/#practice';  // Dentist JSON-LD @id in src/index.html

const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const jsonLd = obj => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>\n`;

// BreadcrumbList from the page's visible breadcrumb: its links, then the current page
function breadcrumbLd(section, url) {
  const first = section.search(/<a class="crumb-link"/);
  if (first === -1) return null;
  const block = section.slice(first, section.indexOf('</div>', first));
  const items = [];
  for (const m of block.matchAll(/<a class="crumb-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const itemUrl = m[1] === '/' ? `${SITE}/` : `${SITE}${m[1]}`;
    if (itemUrl !== url) items.push({ name: stripTags(m[2]), item: itemUrl });
  }
  items.push({ name: stripTags(block.split('›').pop()), item: url });
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.item })),
  };
}

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function replaceOnce(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`${label} not found in src/index.html`);
  return html.replace(pattern, replacement);
}

// Locate every page section: [id, start, end) — end found by matching nested <div>s
const sections = [];
for (const m of src.matchAll(/<div (?:class="page(?: active)?" id="page-([a-z0-9-]+)"|id="page-([a-z0-9-]+)" class="page(?: active)?")>/g)) {
  const id = m[1] || m[2];
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = m.index + m[0].length;
  let depth = 1, t;
  while (depth && (t = tags.exec(src))) depth += t[0] === '</div>' ? -1 : 1;
  if (depth) throw new Error(`Unclosed section #page-${id}`);
  sections.push({ id, start: m.index, end: tags.lastIndex });
}
const missing = Object.keys(pageMeta).filter(id => !sections.some(s => s.id === id));
if (missing.length) throw new Error(`No section for: ${missing.join(', ')}`);

const written = [];
for (const [id, meta] of Object.entries(pageMeta)) {
  // Keep only this page's section (cut from the end so earlier offsets stay valid)
  let html = src;
  for (const s of [...sections].reverse()) {
    if (s.id !== id) html = html.slice(0, s.start) + html.slice(s.end);
  }

  const url = id === 'home' ? `${SITE}/` : `${SITE}/${id}`;
  const section = src.slice(sections.find(s => s.id === id).start, sections.find(s => s.id === id).end);
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeText(meta.title)}</title>`, '<title>');
  html = replaceOnce(html, /<meta name="description" content="[^"]*"\/>/,
    `<meta name="description" content="${escapeAttr(meta.desc)}"/>`, 'meta description');
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"\/>/, `<link rel="canonical" href="${url}"/>`, 'canonical');

  if (id !== 'home') {
    // FAQ schema describes the home page FAQ only
    html = html.replace(/<script type="application\/ld\+json">\s*\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "FAQPage"[\s\S]*?<\/script>\n?/, '');
    html = html.replace(new RegExp(`<div (class="page" id="page-${id}"|id="page-${id}" class="page")>`),
      `<div class="page active" id="page-${id}">`);
    // This page's heading (marked class="page-h1") becomes its <h1>
    html = replaceOnce(html, /<(h2|strong) class="([^"]*\bpage-h1\b[^"]*)"([^>]*)>([\s\S]*?)<\/\1>/,
      '<h1 class="$2"$3>$4</h1>', `page-h1 heading in #page-${id}`);
  }
  // A sub-page's first image is above the fold: load it right away (LCP), not lazily
  // (unless src/index.html already marks this page's priority image with fetchpriority="high")
  if (id !== 'home' && !section.includes('fetchpriority="high"')) {
    const at = html.indexOf(`id="page-${id}"`);
    const img = html.indexOf('<img ', at);
    if (img !== -1) {
      const end = html.indexOf('>', img);
      html = html.slice(0, img) + html.slice(img, end).replace(' loading="lazy"', ' fetchpriority="high"') + html.slice(end);
    }
  }

  // The visible page section is the page's <main> landmark (its closing </div> becomes </main>)
  const open = new RegExp(`<div class="page active" id="page-${id}">`).exec(html);
  if (!open) throw new Error(`${id}: active section not found`);
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = open.index + open[0].length;
  let depth = 1, t;
  while (depth && (t = tags.exec(html))) depth += t[0] === '</div>' ? -1 : 1;
  html = html.slice(0, open.index) + `<main class="page active" id="page-${id}">` +
    html.slice(open.index + open[0].length, t.index) + '</main>' + html.slice(t.index + 6);

  // Per-page structured data: breadcrumbs where one is shown, BlogPosting for posts
  const ld = [];
  const crumbs = breadcrumbLd(section, url);
  if (crumbs) ld.push(crumbs);
  if (id.startsWith('blog-')) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    ld.push({
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: stripTags(h1[1]), description: meta.desc, url, mainEntityOfPage: url,
      ...(BLOG_DATES[id] && { datePublished: BLOG_DATES[id] }),
      author: { '@type': 'Person', name: 'Dr. Ramin Foroughi', jobTitle: 'Periodontist', url: `${SITE}/meet-doctor` },
      publisher: { '@id': PRACTICE_ID },
      inLanguage: 'en-US',
    });
  }
  if (ld.length) html = html.replace('</head>', ld.map(jsonLd).join('') + '</head>');

  const h1s = html.match(/<h1[\s>]/g) || [];
  if (h1s.length !== 1) throw new Error(`${id}: expected exactly one <h1>, found ${h1s.length}`);

  html = html.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n<!-- GENERATED by build-pages.mjs from src/index.html. Do not edit; edit src/index.html and rebuild. -->\n');

  const out = id === 'home' ? 'index.html' : `${id}.html`;
  fs.writeFileSync(path.join(__dirname, out), html);
  written.push(out);
}

// sitemap.xml lists every page, so it can't drift from pageMeta
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.keys(pageMeta).map(id => `  <url><loc>${id === 'home' ? `${SITE}/` : `${SITE}/${id}`}</loc></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);

console.log(`Wrote ${written.length} pages + sitemap.xml for ${SITE}: ${written.join(', ')}`);
