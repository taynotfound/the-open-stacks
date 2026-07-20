// A-Infos scraper — articles at ainfos.ca/{lang}/ as relative links
// ponytail: index pages have `ainfosNNNNN.html` links; paginate via ?first=N
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

const AGENT = { headers: { 'User-Agent': 'OpenStacks/1.0' }, rejectUnauthorized: false, timeout: 12000 };

function get(url) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, ...AGENT }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(new URL(r.headers.location, url).href).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => rej(new Error('timeout')));
  });
}

async function scrapeLang(db, lang) {
  const base = `https://www.ainfos.ca/${lang}/`;
  let inserted = 0, page = 0, pageInserted = 0;
  while (true) {
    const url = page === 0 ? base : `${base}?first=${page * 100}`;
    let html; try { html = await get(url); } catch (e) { console.error(`[A-Infos] ${lang} p${page}: ${e.message}`); break; }
    const links = [...html.matchAll(/href="(ainfos\d+\.html)"/g)].map(m => m[1]);
    if (!links.length) break;
    pageInserted = 0;
    for (const link of links) {
      const slug = `ainfos-${lang}-${link.replace('.html', '')}`;
      if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
      let body = ''; try { body = await get(base + link); await new Promise(r => setTimeout(r, 600)); } catch { continue; }
      const title = (body.match(/<title>([^<]+)<\/title>/i) || [])[1]?.replace(/\s*-\s*A-Infos.*/i, '').trim() || link;
      const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      await upsert(db, {
        slug, title: title.slice(0, 200), author: 'A-Infos',
        desc: text.slice(0, 300), source: base + link, sourceName: 'A-Infos',
        category: 'anarchist-news', language: lang,
        tags: ['anarchism', 'news'], hasBody: false, atRisk: false,
        cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
      });
      inserted++;
      pageInserted++;
    }
    console.log(`[A-Infos] ${lang} p${page}: +${pageInserted} new`);
    // if page returned <100 links we're at the end
    if (links.length < 100) break;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }
  return inserted;
}

(async () => {
  const db = await getDb();
  let total = 0;
  for (const lang of ['en', 'de', 'fr', 'es', 'pt', 'it']) {
    const n = await scrapeLang(db, lang);
    console.log(`[A-Infos] ${lang} done: +${n}`);
    total += n;
  }
  console.log(`[A-Infos] TOTAL: +${total}`);
  await closeDb();
})();
