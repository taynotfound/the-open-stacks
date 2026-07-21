#!/usr/bin/env node
// Fetch DjVuTXT for IA items that have it, push as .md to GitHub, set path+hasBody
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const { MongoClient } = require('mongodb');
const { ghApi, ghGet } = require('../lib/github');

function get(url) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 30000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(r.headers.location).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', rej);
  });
}

async function pushToGithub(slug, text) {
  const path = `contents/ia/${slug}.md`;
  const content = Buffer.from(text).toString('base64');
  const existing = await ghGet(path).catch(() => null);
  const sha = existing?.sha;
  return ghApi('PUT', path, { message: `add: ${slug}`, content, ...(sha ? { sha } : {}) });
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const col = client.db('open-stacks').collection('books');

  // items with a text file in DB but no path yet
  const items = await col.find({
    sourceName: 'Internet Archive',
    hasBody: true,
    path: { $in: [null, ''] }
  }, { projection: { slug: 1, source: 1, files: 1 } }).toArray();

  console.log(`${items.length} IA items to fetch text for`);
  let done = 0, skipped = 0;

  for (const item of items) {
    const txtFile = (item.files || []).find(f => /DjVuTXT|Plain Text/i.test(f.format || '') && /\.txt$/.test(f.name));
    if (!txtFile) { skipped++; continue; }
    try {
      const raw = await get(txtFile.url);
      const clean = raw.replace(/\f/g, '\n\n').replace(/\r/g, '').trim();
      if (clean.length < 100) { skipped++; continue; }
      await pushToGithub(item.slug, clean);
      await col.updateOne({ _id: item._id }, { $set: { path: `ia/${item.slug}.md`, hasBody: true } });
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${items.length}…`);
      await new Promise(r => setTimeout(r, 400)); // ponytail: rate limit, GH secondary rate limit is 100 writes/min
    } catch (e) {
      console.error(`  FAIL ${item.slug}: ${e.message}`);
    }
  }
  console.log(`Done. pushed=${done} skipped=${skipped}`);
  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
