// A-Infos scraper — date-based URLs, 1995–present
// ponytail: scrapes monthly index pages, extracts article links, upserts bodies
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 10000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => rej(new Error('timeout')));
  });
}

function parseArticles(html) {
  // A-Infos index: <li><a href="/en/ainfos/YYYYMM/ainfosNNNNN.html">Title</a>
  const re = /href="(\/\w+\/ainfos\/\d{6}\/ainfos\d+\.html)"[^>]*>([^<]+)</g;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ path: m[1], title: m[2].trim() });
  return out;
}

function parseBody(html, path) {
  // strip tags for plain text body
  const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
  // language from path prefix e.g. /en/ /de/ /fr/
  const lang = (path.match(/^\/([a-z]{2})\//) || [])[1] || 'en';
  return { body, lang };
}

async function scrapeMonth(db, yyyymm, lang = 'en') {
  const url = `https://www.ainfos.ca/${lang}/ainfos/${yyyymm}/`;
  let html;
  try { html = await get(url); } catch { return 0; }
  const articles = parseArticles(html);
  let inserted = 0;
  for (const a of articles) {
    const slug = slugify(`ainfos-${a.path.replace(/\//g, '-').replace(/\.html$/, '')}`);
    // skip if exists
    const exists = await db.collection('books').findOne({ slug }, { projection: { _id: 1 } });
    if (exists) continue;
    let bodyHtml = '';
    try { bodyHtml = await get(`https://www.ainfos.ca${a.path}`); await new Promise(r => setTimeout(r, 800)); } catch { continue; }
    const { body, lang: detLang } = parseBody(bodyHtml, a.path);
    await upsert(db, {
      slug, title: a.title, author: 'A-Infos', desc: body.slice(0, 300),
      source: `https://www.ainfos.ca${a.path}`, sourceName: 'A-Infos',
      category: 'anarchist-news', language: detLang,
      tags: ['anarchism', 'news', 'history'], hasBody: false, atRisk: false,
      cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
  }
  return inserted;
}

(async () => {
  const db = await getDb();
  const now = new Date();
  // scrape last 6 months by default; for full history pass --all
  const all = process.argv.includes('--all');
  const months = [];
  if (all) {
    for (let y = 1995; y <= now.getFullYear(); y++)
      for (let m = 1; m <= 12; m++) {
        if (y === now.getFullYear() && m > now.getMonth() + 1) break;
        months.push(`${y}${String(m).padStart(2,'0')}`);
      }
  } else {
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`);
    }
  }
  let total = 0;
  for (const lang of ['en', 'de', 'fr', 'es', 'pt', 'it']) {
    for (const m of months) {
      const n = await scrapeMonth(db, m, lang);
      if (n) { console.log(`[A-Infos] ${lang}/${m}: +${n}`); total += n; }
      await new Promise(r => setTimeout(r, 300));
    }
  }
  console.log(`[A-Infos] TOTAL: +${total}`);
  await closeDb();
})();
