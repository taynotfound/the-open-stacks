#!/usr/bin/env node
// Push scraped article bodies to the library repo as markdown, set path in DB.
// Idempotent: only items with hasBody and no path. Usage: node scripts/push_bodies.js [limit]
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { ghApi, ghGet } = require('../lib/github');

const LIMIT = parseInt(process.argv[2]) || 0;

function md(doc) {
  const esc = s => String(s || '').replace(/"/g, '\\"');
  return [
    '---',
    `title: "${esc(doc.title)}"`,
    doc.author ? `author: "${esc(doc.author)}"` : null,
    doc.sourceName ? `source: "${esc(doc.sourceName)}"` : null,
    doc.source ? `url: "${esc(doc.source)}"` : null,
    '---',
    '',
    doc.body,
  ].filter(x => x !== null).join('\n');
}

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = c.db('open-stacks').collection('books');
  const q = { hasBody: true, body: { $exists: true, $ne: '' }, path: { $in: [null, ''] } };
  let cur = col.find(q).project({ slug: 1, title: 1, author: 1, source: 1, sourceName: 1, body: 1 });
  if (LIMIT) cur = cur.limit(LIMIT);
  const items = await cur.toArray();
  console.log(`${items.length} bodies to push`);
  let done = 0, failed = 0;
  for (const doc of items) {
    const path = `contents/articles/${doc.slug}.md`;
    try {
      const content = Buffer.from(md(doc)).toString('base64');
      const existing = await ghGet(`contents/articles/${doc.slug}.md`).catch(() => null);
      await ghApi('PUT', path, { message: `add: ${doc.slug}`, content, ...(existing?.sha ? { sha: existing.sha } : {}) });
      await col.updateOne({ _id: doc._id }, { $set: { path: `articles/${doc.slug}.md` } });
      done++;
    } catch (e) {
      failed++;
      console.error(`fail ${doc.slug}: ${e.message}`);
    }
    if ((done + failed) % 50 === 0) console.log(`  ${done + failed}/${items.length}…`);
    await new Promise(r => setTimeout(r, 400)); // ponytail: fixed delay, fine for GitHub secondary rate limits
  }
  console.log(`Done. pushed=${done} failed=${failed}`);
  await c.close();
})();
