// ponytail: shared upsert + slug helper for all scrapers
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

// upsert by slug; returns true if inserted, false if updated
async function upsert(db, doc) {
  const r = await db.collection('books').updateOne(
    { slug: doc.slug },
    { $setOnInsert: { added: Math.floor(Date.now() / 1000) }, $set: doc },
    { upsert: true }
  );
  return !!r.upsertedCount;
}

module.exports = { getDb, closeDb, slugify, upsert };
