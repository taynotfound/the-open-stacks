#!/usr/bin/env node
// ponytail: hits our own /api/ia-files proxy (same logic, reuses cache) then saves to DB
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const { MongoClient } = require('mongodb');

const BASE = process.env.SITE_URL || 'http://localhost:4200';
const CONCURRENCY = 5;

function get(url) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d)); }).on('error',rej);
  });
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const col = client.db('open-stacks').collection('books');

  // ponytail: re-run clears files:[] too — so fetch all IA items with empty files
  const items = await col.find({ sourceName: 'Internet Archive' }, { projection: { slug: 1, source: 1 } }).toArray();
  console.log(`Backfilling ${items.length} IA items…`);

  let done = 0, updated = 0, failed = 0;
  // process in batches of CONCURRENCY
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async item => {
      const id = (item.source || '').replace('https://archive.org/details/', '');
      if (!id) return;
      try {
        const raw = await get(`${BASE}/api/ia-files/${encodeURIComponent(id)}`);
        const files = JSON.parse(raw);
        if (!files.length) { done++; return; }
        const textFile = files.find(f => /DjVuTXT|OCR Search Text|Plain Text/i.test(f.format||'') && /\.txt$/.test(f.name));
        await col.updateOne({ _id: item._id }, { $set: { files, hasBody: !!textFile } });
        updated++;
      } catch(e) {
        console.error(`  FAIL ${id}: ${e.message}`);
        failed++;
      }
      done++;
    }));
    if (i % 50 === 0) process.stdout.write(`  ${done}/${items.length}\r`);
    await new Promise(r => setTimeout(r, 100)); // be gentle with IA
  }
  console.log(`\nDone. updated=${updated} failed=${failed}`);
  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
