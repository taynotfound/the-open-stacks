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
  if (q?.trim()) filter.$text = { $search: q.trim() };
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
