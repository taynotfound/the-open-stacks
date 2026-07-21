// Subversion Press scraper — WordPress RSS feed
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url, redirects = 5) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000
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
  const rss = await get('https://subversionpress.wordpress.com/feed/');
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let inserted = 0;
  for (const [, item] of items) {
    const link = (item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1]?.trim();
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const body = strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 100000);
    const pubDate = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1];
    const pdfMatch = item.match(/href="([^"]+\.pdf)"/i);
    const pdfUrl = pdfMatch ? pdfMatch[1] : null;
    if (!link || !title) continue;
    const slug = 'subv-' + slugify(title).slice(0, 72);
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, {
      slug, title, author: 'Subversion Press', desc: body.slice(0, 300), body,
      source: link, sourceName: 'Subversion Press', category: 'anarchism', language: 'eng',
      tags: ['anarchism', 'pamphlet'], hasBody: !!body.trim(), atRisk: false,
      cover: '', files: pdfUrl ? [{ url: pdfUrl, label: 'PDF', format: 'pdf' }] : [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
  }
  console.log(`[Subversion Press] +${inserted} new`);
  await closeDb();
}

scrape().catch(e => { console.error('[SubversionPress] error:', e.message); process.exit(1); });
