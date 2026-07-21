// Subversion Press — WordPress RSS
const { getDb, closeDb, slugify, upsert, get, strip } = require('./lib');

(async () => {
  const db = await getDb();
  const rss = await get('https://subversionpress.wordpress.com/feed/');
  let inserted = 0;
  for (const [, item] of rss.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const link = strip((item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1] || '');
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const body = strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 100000);
    const pdfUrl = (item.match(/href="([^"]+\.pdf)"/i) || [])[1] || null;
    if (!link || !title) continue;
    const slug = 'subv-' + slugify(title).slice(0, 72);
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, { slug, title, author: 'Subversion Press', desc: body.slice(0, 300), body, source: link, sourceName: 'Subversion Press', category: 'anarchism', language: 'eng', tags: ['anarchism', 'pamphlet'], hasBody: !!body.trim(), atRisk: false, cover: '', files: pdfUrl ? [{ url: pdfUrl, label: 'PDF', format: 'pdf' }] : [], images: [], links: [], state: 'active', path: '', pageType: 'external' });
    inserted++;
  }
  console.log(`[Subversion Press] +${inserted} new`);
  await closeDb();
})().catch(e => { console.error('[SubversionPress]', e.message); process.exit(1); });
