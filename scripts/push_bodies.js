#!/usr/bin/env node
// Push scraped article bodies to the library repo in batched commits (git trees API).
// Idempotent: only items with hasBody and no path. Usage: node scripts/push_bodies.js [limit]
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { ghApi } = require('../lib/github');

const LIMIT = parseInt(process.argv[2]) || 0;
const BATCH = 100;
const IDENT = { name: 'taynotfound', email: 'marztayron@gmail.com' };

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

async function gh(method, path, data) {
  for (;;) {
    const r = await ghApi(method, path, data);
    if (r.message && /rate limit/i.test(r.message)) {
      console.log('rate limited, sleeping 5m…');
      await new Promise(rs => setTimeout(rs, 5 * 60000));
      continue;
    }
    return r;
  }
}

(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const col = c.db('open-stacks').collection('books');
  const q = { hasBody: true, body: { $exists: true, $ne: '' }, path: { $in: [null, ''] } };
  let cur = col.find(q).project({ slug: 1, title: 1, author: 1, source: 1, sourceName: 1, body: 1 });
  if (LIMIT) cur = cur.limit(LIMIT);
  const items = await cur.toArray();
  console.log(`${items.length} bodies to push (batches of ${BATCH})`);
  let pushed = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const ref = await gh('GET', 'git/ref/heads/main');
    if (!ref.object) throw new Error(`ref failed: ${ref.message}`);
    const headSha = ref.object.sha;
    const tree = await gh('POST', 'git/trees', {
      base_tree: headSha,
      tree: batch.map(d => ({ path: `articles/${d.slug}.md`, mode: '100644', type: 'blob', content: md(d) })),
    });
    if (!tree.sha) throw new Error(`tree failed: ${tree.message}`);
    const commit = await gh('POST', 'git/commits', {
      message: `add: ${batch.length} articles (scraper batch)`,
      tree: tree.sha, parents: [headSha], author: IDENT, committer: IDENT,
    });
    if (!commit.sha) throw new Error(`commit failed: ${commit.message}`);
    const upd = await gh('PATCH', 'git/refs/heads/main', { sha: commit.sha });
    if (!upd.object) throw new Error(`ref update failed: ${upd.message}`);
    await col.bulkWrite(batch.map(d => ({
      updateOne: { filter: { _id: d._id }, update: { $set: { path: `articles/${d.slug}.md` } } },
    })));
    pushed += batch.length;
    console.log(`  ${pushed}/${items.length} (${commit.sha.slice(0, 7)})`);
    await new Promise(r => setTimeout(r, 3000)); // ponytail: fixed pause between batches, gentle on secondary limits
  }
  console.log(`Done. pushed=${pushed}`);
  await c.close();
})().catch(e => { console.error(e.message); process.exit(1); });
