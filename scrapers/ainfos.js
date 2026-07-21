// A-Infos scraper — fetches articles, decodes latin1, strips nav, pushes .md to GitHub
const https = require('https');
const iconv = require('iconv-lite');
const { getDb, closeDb, slugify, upsert } = require('./lib');
const { ghApi, ghGet } = require('../lib/github');

const AGENT = { headers: { 'User-Agent': 'OpenStacks/1.0' }, rejectUnauthorized: false, timeout: 15000 };

function getRaw(url) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, ...AGENT }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return getRaw(new URL(r.headers.location, url).href).then(res).catch(rej);
      const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function get(url) {
  const buf = await getRaw(url);
  return iconv.decode(buf, 'latin1');
}

function stripHtml(s) {
  return (s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x[0-9a-fA-F]+;/g, c => String.fromCharCode(parseInt(c.slice(3,-1),16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// Cut navigation boilerplate — A-Infos pages have a long header + footer nav
function extractBody(html) {
  // body lives after the <hr> that follows the article header
  const parts = html.split(/<hr\s*\/?>/i);
  // article body is typically the 2nd block (after the nav header)
  if (parts.length >= 3) return parts.slice(1, -1).join('\n---\n');
  if (parts.length === 2) return parts[1];
  return html;
}

async function pushToGitHub(path, content) {
  let sha;
  try { const f = await ghGet(`contents/${path}`); sha = f.sha; } catch {}
  await ghApi('PUT', `contents/${path}`, {
    message: `scrape: ainfos ${path}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

async function scrapeLang(db, lang) {
  const base = `https://www.ainfos.ca/${lang}/`;
  let inserted = 0, page = 0;
  while (true) {
    const url = page === 0 ? base : `${base}?first=${page * 100}`;
    let html; try { html = await get(url); } catch (e) { console.error(`[A-Infos] ${lang} p${page}: ${e.message}`); break; }
    const links = [...html.matchAll(/href="(ainfos\d+\.html)"/g)].map(m => m[1]);
    if (!links.length) break;
    let pageInserted = 0;
    for (const link of links) {
      const slug = `ainfos-${lang}-${link.replace('.html', '')}`;
      if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
      let artHtml; try { artHtml = await get(base + link); } catch { continue; }
      await new Promise(r => setTimeout(r, 400));

      const rawTitle = (artHtml.match(/<title>([^<]+)<\/title>/i) || [])[1] || link;
      const title = stripHtml(rawTitle).replace(/\s*-\s*A-Infos.*/i, '').trim().slice(0, 200);

      const bodyHtml = extractBody(artHtml);
      const bodyText = stripHtml(bodyHtml).replace(/\n{3,}/g, '\n\n').trim();
      if (bodyText.length < 80) continue; // skip nav-only pages

      // Push .md to GitHub library repo
      const ghPath = `ainfos/${lang}/${link.replace('.html', '')}.md`;
      const md = `# ${title}\n\n**Source:** ${base + link}  \n**Language:** ${lang}\n\n---\n\n${bodyText}`;
      try { await pushToGitHub(ghPath, md); } catch (e) { console.error(`[A-Infos] github push failed: ${e.message}`); continue; }

      await upsert(db, {
        slug, title, author: 'A-Infos',
        desc: bodyText.slice(0, 300),
        source: base + link, sourceName: 'A-Infos',
        category: 'anarchist-news', language: lang,
        tags: ['anarchism', 'news'], hasBody: true, atRisk: false,
        cover: '', files: [], images: [], links: [], state: 'active',
        path: ghPath, pageType: 'external', body: '',
      });
      inserted++;
      pageInserted++;
    }
    console.log(`[A-Infos] ${lang} p${page}: +${pageInserted} new`);
    if (links.length < 100) break;
    if (pageInserted === 0 && page > 1) break;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }
  return inserted;
}

(async () => {
  const db = await getDb();
  let total = 0;
  for (const lang of ['en', 'de', 'fr', 'es', 'pt', 'it']) {
    try {
      const n = await scrapeLang(db, lang);
      console.log(`[A-Infos] ${lang} done: +${n}`);
      total += n;
    } catch (e) { console.error(`[A-Infos] ${lang} fatal: ${e.message}`); }
  }
  console.log(`[A-Infos] TOTAL: +${total}`);
  await closeDb();
})();
