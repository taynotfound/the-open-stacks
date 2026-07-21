// ponytail: shared upsert + slug helper for all scrapers
const https = require('https');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

let _client, _db;
async function getDb() {
  if (!_db) {
    _client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await _client.connect();
    _db = _client.db('open-stacks');
  }
  return _db;
}
async function closeDb() { if (_client) await _client.close(); }

function slugify(s) {
  return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);
}

// upsert by slug; returns true if inserted
async function upsert(db, doc) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await db.collection('books').updateOne(
        { slug: doc.slug },
        { $setOnInsert: { added: Math.floor(Date.now() / 1000) }, $set: doc },
        { upsert: true }
      );
      return !!r.upsertedCount;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

function get(url, ua = 'OpenStacks/1.0', rd = 5) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': ua }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && rd > 0)
        return get(new URL(r.headers.location, url).href, ua, rd - 1).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

const strip = s => {
  let t = (s || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
  // decode first (handles double-encoded HTML like &lt;span&gt;), then strip tags, then decode again
  const dec = x => x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&nbsp;/g, ' ');
  t = dec(t);
  t = t.replace(/<[^>]+>/g, ' ');
  return dec(t).replace(/\s+/g, ' ').trim();
};

module.exports = { getDb, closeDb, slugify, upsert, get, strip };
