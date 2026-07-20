// Spunk Library scraper — Apache dir listing, static files
// ponytail: parse dir listing, download text files, upsert
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

const BASE = 'https://www.spunk.org/texts/';
// Top-level categories from spunk.org/texts/
const CATS = ['pubs', 'misc', 'politics', 'history', 'arts', 'intro', 'people', 'places', 'work', 'fight'];

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 12000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => rej(new Error('timeout')));
  });
}

function parseLinks(html, base) {
  const re = /href="([^"]+)"/g; const out = []; let m;
  while ((m = re.exec(html))) {
    const h = m[1];
    if (h.startsWith('?') || h.startsWith('/') || h.startsWith('http')) continue;
    out.push(new URL(h, base).href);
  }
  return out;
}

async function scrapeDir(db, url, depth = 0) {
  if (depth > 3) return 0;
  let html; try { html = await get(url); } catch { return 0; }
  const links = parseLinks(html, url);
  let inserted = 0;
  for (const link of links) {
    if (link.endsWith('/')) {
      inserted += await scrapeDir(db, link, depth + 1);
      await new Promise(r => setTimeout(r, 500));
    } else if (/\.(txt|html?)$/i.test(link)) {
      const slug = slugify('spunk-' + link.replace(BASE, '').replace(/\//g, '-').replace(/\.\w+$/, ''));
      const exists = await db.collection('books').findOne({ slug }, { projection: { _id: 1 } });
      if (exists) continue;
      let body = ''; try { body = await get(link); } catch { continue; }
      body = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const title = (body.match(/^([^\n.]{10,80})/) || [])[1]?.trim() || slug;
      await upsert(db, {
        slug, title: title.slice(0, 120), author: 'Unknown',
        desc: body.slice(0, 300), source: link, sourceName: 'Spunk Library',
        category: 'history-and-archives', language: 'en',
        tags: ['anarchism', 'history', 'spunk'], hasBody: false, atRisk: true,
        cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
      });
      inserted++;
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return inserted;
}

(async () => {
  const db = await getDb();
  let total = 0;
  for (const cat of CATS) {
    const n = await scrapeDir(db, `${BASE}${cat}/`);
    console.log(`[Spunk] ${cat}: +${n}`);
    total += n;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`[Spunk] TOTAL: +${total}`);
  await closeDb();
})();
