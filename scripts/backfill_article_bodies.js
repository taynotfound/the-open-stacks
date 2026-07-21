// Fetch full article body for RSS items that have a source URL but no body
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { fetchBody } = require('../scrapers/lib');

const SKIP_SOURCES = ['Internet Archive', 'The Anarchist Library']; // handled separately

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('open-stacks');
  const docs = await db.collection('books').find({
    hasBody: { $ne: true },
    source: { $exists: true, $ne: '' },
    sourceName: { $nin: SKIP_SOURCES },
    path: { $in: [null, ''] },
  }).project({ _id: 1, slug: 1, source: 1 }).toArray();
  console.log(`${docs.length} items to backfill`);
  let done = 0, failed = 0;
  for (const doc of docs) {
    const body = await fetchBody(doc.source).catch(() => null);
    if (body && body.length > 100) {
      await db.collection('books').updateOne({ _id: doc._id }, { $set: { body, hasBody: true, desc: body.slice(0, 300) } });
      done++;
    } else {
      failed++;
    }
    if ((done + failed) % 20 === 0) console.log(`  ${done + failed}/${docs.length}…`);
  }
  console.log(`Done. fetched=${done} failed=${failed}`);
  await c.close();
})().catch(e => { console.error(e.message); process.exit(1); });
