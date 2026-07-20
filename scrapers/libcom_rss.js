// Libcom.org RSS/API scraper — new articles since last scrape
// ponytail: libcom has /feeds/recent for RSS, use as incremental top-up
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(new URL(r.headers.location, url).href).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return html.replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}

async function scrape() {
  const db = await getDb();
  // Libcom RSS — top-up only, full history already in DB from main scraper
  const rss = await get('https://libcom.org/feeds/recent').catch(() => null);
  if (!rss) { console.log('[Libcom RSS] fetch failed'); await closeDb(); return; }

  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  let inserted = 0;
  for (const item of items) {
    const link = (item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1]?.trim();
    const titleRaw = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const bodyRaw = (item.match(/<description>([\s\S]*?)<\/description>/) || item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1] || '';
    const pubDate = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1];

    if (!link || !titleRaw) continue;
    const title = stripHtml(titleRaw).slice(0, 200);
    const bodyText = stripHtml(bodyRaw).slice(0, 100000);
    if (bodyText.length < 50) continue;

    const slug = slugify('libcom-' + link.replace('https://libcom.org/', '').replace(/\//g, '-').replace(/-$/, ''));
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;

    await upsert(db, {
      slug, title, author: 'Libcom',
      desc: bodyText.slice(0, 300), body: bodyText, source: link,
      sourceName: 'libcom.org', category: 'anarchism', language: 'en',
      tags: ['anarchism', 'libcom'], hasBody: true, atRisk: false,
      cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
  }
  console.log(`[Libcom RSS] +${inserted} new`);
  await closeDb();
}

scrape().catch(e => { console.error(e); process.exit(1); });
