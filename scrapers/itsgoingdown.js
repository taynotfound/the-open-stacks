// It's Going Down — RSS (Firefox UA required, CF-protected)
const { getDb, closeDb, slugify, upsert, get, strip } = require('./lib');
const FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';

(async () => {
  const db = await getDb();
  const rss = await get('https://itsgoingdown.org/feed/', FF);
  let inserted = 0;
  for (const [, item] of rss.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const link = strip((item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1] || '');
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const body = strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 100000);
    const cats = [...item.matchAll(/<category><!\[CDATA\[([^\]]+)\]\]><\/category>/g)].map(m => m[1].toLowerCase());
    if (!link || !title || body.length < 50) continue;
    const slug = 'igd-' + slugify(title).slice(0, 72);
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, { slug, title, author: "It's Going Down", desc: body.slice(0, 300), body, source: link, sourceName: "It's Going Down", category: 'anarchist-news', language: 'eng', tags: ['anarchism', 'news', ...cats.slice(0, 5)], hasBody: true, atRisk: false, cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external' });
    inserted++;
  }
  console.log(`[It's Going Down] +${inserted} new`);
  await closeDb();
})().catch(e => { console.error('[IGD]', e.message); process.exit(1); });
