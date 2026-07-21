// Anarchist News — RSS scraper
// ponytail: RSS only ~20 items; incremental via cron
const { getDb, closeDb, slugify, upsert, get, strip } = require('./lib');

(async () => {
  const db = await getDb();
  const rss = await get('https://anarchistnews.org/rss.xml');
  let inserted = 0;
  for (const [, item] of rss.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const link = strip((item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1] || '');
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const desc = strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 300);
    if (!link || !title) continue;
    const slug = slugify('an-' + link.replace(/https?:\/\/[^/]+\//, '').replace(/\//g, '-').replace(/-$/, ''));
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, { slug, title, author: 'Anarchist News', desc, source: link, sourceName: 'anarchistnews.org', category: 'anarchist-news', language: 'eng', tags: ['anarchism', 'news'], hasBody: false, body: '', atRisk: false, cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external' });
    inserted++;
  }
  console.log(`[AnarchistNews] +${inserted} new`);
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
