// Anarchist News scraper — RSS at anarchistnews.org/rss.xml (WP REST API is disabled)
// ponytail: RSS only goes back ~20 items; run regularly via cron for incremental updates
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

function strip(s) {
  return (s||'').replace(/<![CDATA[/g,'').replace(/]]>/g,'').replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}

async function scrape() {
  const db = await getDb();
  const rss = await get('https://anarchistnews.org/rss.xml');
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let inserted = 0;
  for (const [, item] of items) {
    const link = (item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1]?.trim();
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const bodyText = strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 100000);
    const pubDate = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1];
    if (!link || !title || bodyText.length < 50) continue;
    const slug = slugify('an-' + link.replace(/https?:\/\/[^/]+\//,'').replace(/\//g,'-').replace(/-$/,''));
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, {
      slug, title, author: 'Anarchist News', desc: bodyText.slice(0, 300), body: bodyText,
      source: link, sourceName: 'anarchistnews.org', category: 'anarchist-news', language: 'en',
      tags: ['anarchism', 'news'], hasBody: true, atRisk: false,
      cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
  }
  console.log(`[AnarchistNews] +${inserted} new`);
  await closeDb();
}

scrape().catch(e => { console.error(e); process.exit(1); });
