// Libcom.org — RSS top-up (full history already in DB)
const { getDb, closeDb, slugify, upsert, get, strip } = require('./lib');

(async () => {
  const db = await getDb();
  const rss = await get('https://libcom.org/feeds/recent').catch(() => null);
  if (!rss) { console.log('[Libcom RSS] fetch failed'); await closeDb(); return; }
  let inserted = 0;
  for (const [, item] of rss.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const link = strip((item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1] || '');
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const body = strip((item.match(/<description>([\s\S]*?)<\/description>/) || item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1] || '').slice(0, 100000);
    if (!link || !title || body.length < 50) continue;
    const slug = slugify('libcom-' + link.replace('https://libcom.org/', '').replace(/\//g, '-').replace(/-$/, ''));
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, { slug, title, author: 'Libcom', desc: body.slice(0, 300), body, source: link, sourceName: 'libcom.org', category: 'anarchism', language: 'eng', tags: ['anarchism', 'libcom'], hasBody: true, atRisk: false, cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external' });
    inserted++;
  }
  console.log(`[Libcom RSS] +${inserted} new`);
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
