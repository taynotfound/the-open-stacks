const express = require('express');
const router = express.Router();

async function cached(cache, key, fn, ttl=300) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const val = await fn();
  cache.set(key, val, ttl);
  return val;
}

router.get('/search', async (req, res) => {
  const { db, cache } = res.locals;
  if (!db) return res.status(503).json({ error: 'DB unavailable' });
  const { q, category, lang, page = 1, limit = 24 } = req.query;
  const lim = Math.min(parseInt(limit) || 24, 100);
  const skip = (parseInt(page) - 1) * lim;
  const filter = {};
  if (q?.trim()) {
    // try $text first (indexed), fall back to regex if index not ready
    filter.$or = [
      { title: { $regex: q.trim(), $options: 'i' } },
      { author: { $regex: q.trim(), $options: 'i' } },
    ];
  }
  if (category) filter.category = category;
  if (lang) filter.language = lang;
  const col = db.collection('books');
  const [books, total] = await Promise.all([
    col.find(filter).sort({ added: -1 }).skip(skip).limit(lim).toArray(),
    col.countDocuments(filter)
  ]);
  res.json({ books, total, page: parseInt(page), pages: Math.ceil(total / lim) });
});

router.get('/book/:slug', async (req, res) => {
  const { db, cache } = res.locals;
  if (!db) return res.status(503).json({ error: 'DB unavailable' });
  const book = await cached(cache, `book:${req.params.slug}`,
    () => db.collection('books').findOne({ slug: req.params.slug }));
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.get('/suggest', async (req, res) => {
  const { db, cache } = res.locals;
  const q = req.query.q?.trim();
  if (!q || q.length < 2 || !db) return res.json([]);
  const ck = `suggest:${q}`;
  const hit = cache.get(ck);
  if (hit) return res.json(hit);
  // ponytail: regex scan, good enough for <100k docs; switch to Atlas Search if slow
  const results = await db.collection('books')
    .find({ title: { $regex: q, $options: 'i' } })
    .project({ title: 1, author: 1, slug: 1 })
    .limit(8).toArray();
  cache.set(ck, results, 120);
  res.json(results);
});

router.get('/news', async (req, res) => {
  const { cache } = res.locals;
  const ck = 'indymedia:news';
  const hit = cache.get(ck);
  if (hit) return res.json(hit);
  try {
    const html = await new Promise((ok, fail) => {
      const mod = require('https');
      mod.get('https://de.indymedia.org/newswire', { headers: { 'User-Agent': 'OpenStacks/1.0' } }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => ok(d));
      }).on('error', fail);
    });
    const items = [];
    const re = /href="(\/node\/(\d+))"[^>]*>([^<]{10,})/g;
    let m;
    while ((m = re.exec(html)) !== null && items.length < 12) {
      const title = m[3].trim();
      if (/Unterstützen|Mailinglisten|Impressum|About/i.test(title)) continue;
      items.push({ url: 'https://de.indymedia.org' + m[1], title });
    }
    cache.set(ck, items, 900); // ponytail: 15min TTL, good enough for a newswire
    res.json(items);
  } catch(e) { res.json([]); }
});

router.get('/categories', async (req, res) => {
  const { db, cache } = res.locals;
  if (!db) return res.json([]);
  const cats = await cached(cache, 'categories',
    () => db.collection('books').distinct('category').then(a => a.filter(Boolean).sort()));
  res.json(cats);
});

router.get('/stats', async (req, res) => {
  const { db, cache } = res.locals;
  if (!db) return res.json({ total: 0, withBody: 0, sources: 0 });
  const stats = await cached(cache, 'stats', async () => {
    const col = db.collection('books');
    const [total, withBody] = await Promise.all([col.countDocuments(), col.countDocuments({ hasBody: true })]);
    const sources = (await col.distinct('sourceName')).filter(Boolean).length;
    return { total, withBody, sources };
  });
  res.json(stats);
});

module.exports = router;
