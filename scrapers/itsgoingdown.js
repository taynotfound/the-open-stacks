// It's Going Down scraper — RSS at itsgoingdown.org/feed/ (requires Firefox UA)
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url, redirects = 5) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0' },
      timeout: 15000
    }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0)
        return get(new URL(r.headers.location, url).href, redirects - 1).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

function strip(s) {
  return (s||'').replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'').replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}

async function scrape() {
  const db = await getDb();
  const rss = await get('https://itsgoingdown.org/feed/');
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let inserted = 0;
  for (const [, item] of items) {
    const link = (item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1]?.trim();
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const body = strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 100000);
    const pubDate = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1];
    const categories = [...item.matchAll(/<category><!\[CDATA\[([^\]]+)\]\]><\/category>/g)].map(m => m[1].toLowerCase());
    if (!link || !title || body.length < 50) continue;
    const slug = 'igd-' + slugify(title).slice(0, 72);
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, {
      slug, title, author: 'It\'s Going Down', desc: body.slice(0, 300), body,
      source: link, sourceName: "It's Going Down", category: 'anarchist-news', language: 'eng',
      tags: ['anarchism', 'news', ...categories.slice(0, 5)], hasBody: true, atRisk: false,
      cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
  }
  console.log(`[It's Going Down] +${inserted} new`);
  await closeDb();
}

scrape().catch(e => { console.error('[IGD] error:', e.message); process.exit(1); });
