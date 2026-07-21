const express = require('express');
const https = require('https');
const router = express.Router();

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function headOk(url) {
  return new Promise(res => {
    https.request(url, { method: 'HEAD' }, r => res(r.statusCode === 200)).on('error', () => res(false)).end();
  });
}

// ponytail: exported so server.js cron can call it directly with a db ref
async function fillCovers(db) {
  // validate + clear broken covers so they get re-fetched below
  const broken = await db.collection('books')
    .find({ cover: { $exists: true } }).project({ _id: 1, cover: 1 }).limit(100).toArray();
  for (const b of broken) {
    const ok = await headOk(b.cover).catch(() => false);
    if (!ok) await db.collection('books').updateOne({ _id: b._id }, { $unset: { cover: '' } });
  }

  const books = await db.collection('books')
    .find({ author: { $exists: true }, $or: [{ cover: { $exists: false } }, { isbn: { $exists: false } }, { publishYear: { $exists: false } }, { olKey: { $exists: false } }] })
    .project({ _id: 1, title: 1, author: 1 })
    .limit(50)
    .toArray();

  let filled = 0;
  for (const book of books) {
    try {
      const q = encodeURIComponent(book.title);
      const a = encodeURIComponent(book.author || '');
      const raw = await httpsGet(`https://openlibrary.org/search.json?title=${q}&author=${a}&fields=cover_i,isbn,first_publish_year,publisher,edition_count,key,subject&limit=1`);
      const doc = JSON.parse(raw)?.docs?.[0];
      if (!doc) continue;

      const update = {};

      if (doc.cover_i) {
        const l  = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
        const xl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-XL.jpg`;
        if (await headOk(l)) update.cover = (await headOk(xl)) ? xl : l;
      }

      if (doc.isbn?.length)        update.isbn        = doc.isbn[0];
      if (doc.first_publish_year)  update.publishYear = doc.first_publish_year;
      if (doc.publisher?.length)   update.publisher   = doc.publisher[0];
      if (doc.edition_count)       update.editionCount = doc.edition_count;
      if (doc.key)                 update.olKey       = doc.key;
      if (doc.subject?.length)     update.subjects    = doc.subject.slice(0, 5);

      if (Object.keys(update).length) {
        await db.collection('books').updateOne({ _id: book._id }, { $set: update });
        filled++;
      }
    } catch (_) { /* skip, try next run */ }
  }
  return { checked: books.length, filled };
}
module.exports.fillCovers = fillCovers;

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

// IA file list — proxy metadata API, cache 1h
// ponytail: client fetches this on demand, no scrape-time overhead
const SKIP_FORMATS = /Metadata|Torrent|JPEG Thumb|Item Tile|chOCR|DjVu XML|Scandata|hOCR|Page Numbers JSON|OCR Page Index/i;
router.get('/ia-files/:id', async (req, res) => {
  const { cache } = res.locals;
  const id = req.params.id.replace(/[^a-zA-Z0-9_.-]/g, '');
  const ck = `ia:${id}`;
  const hit = cache.get(ck);
  if (hit) return res.json(hit);
  try {
    const raw = await httpsGet(`https://archive.org/metadata/${id}`);
    const meta = JSON.parse(raw);
    const base = `https://archive.org/download/${id}/`;
    const files = (meta.files || [])
      .filter(f => !SKIP_FORMATS.test(f.format || ''))
      .map(f => ({ name: f.name, url: base + encodeURIComponent(f.name), format: f.format, size: f.size }));
    cache.set(ck, files, 3600);
    res.json(files);
  } catch { res.json([]); }
});

// PDF proxy — archive.org sends no CORS headers, so our PDF.js reader streams through us.
// Supports Range so pdf.js can fetch chunks; follows IA's redirect to the node server.
const httpsLib = require('https');
router.get('/ia-pdf/:id/:name', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_.-]/g, '');
  const name = req.params.name;
  if (!/\.pdf$/i.test(name)) return res.status(400).end();
  const fetchIt = (url, hops) => {
    if (hops > 5) return res.status(502).end();
    httpsLib.get(url, { headers: { ...(req.headers.range ? { Range: req.headers.range } : {}), 'User-Agent': 'open-stacks/1.0' } }, up => {
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) { up.resume(); return fetchIt(new URL(up.headers.location, url).href, hops + 1); }
      res.status(up.statusCode);
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => { if (up.headers[h]) res.setHeader(h, up.headers[h]); });
      res.setHeader('Cache-Control', 'public, max-age=86400');
      up.pipe(res);
    }).on('error', () => { if (!res.headersSent) res.status(502).end(); });
  };
  fetchIt(`https://archive.org/download/${id}/${encodeURIComponent(name)}`, 0);
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
  const ck = 'newswire:v2';
  const hit = cache.get(ck);
  if (hit) return res.json(hit);
  try {
    function fetchText(url) {
      return new Promise((ok, fail) => {
        const mod = require('https');
        const req = mod.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 8000 }, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => ok(d));
        }).on('error', fail).on('timeout', () => { req.destroy(); fail(new Error('timeout')); });
      });
    }
    // fetch both feeds in parallel
    const [deHtml, anRss] = await Promise.allSettled([
      fetchText('https://de.indymedia.org/newswire'),
      fetchText('https://anarchistnews.org/rss.xml'),
    ]);
    const items = [];
    // de.indymedia.org — scrape HTML links
    if (deHtml.status === 'fulfilled') {
      const re = /href="(\/node\/(\d+))"[^>]*>([^<]{10,})/g; let m;
      while ((m = re.exec(deHtml.value)) !== null && items.filter(i=>i.lang==='de').length < 8) {
        const title = m[3].trim();
        if (/Unterstützen|Mailinglisten|Impressum|About/i.test(title)) continue;
        items.push({ url: 'https://de.indymedia.org' + m[1], title, lang: 'de', src: 'de.indymedia.org' });
      }
    }
    // anarchistnews.org — RSS
    if (anRss.status === 'fulfilled') {
      const posts = [...anRss.value.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
      for (const p of posts) {
        const link = (p[1].match(/<link>([^<]+)<\/link>/) || p[1].match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1]?.trim();
        const rawTitle = (p[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const title = rawTitle.replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'').replace(/<[^>]+>/g,'').trim();
        if (link && title) items.push({ url: link, title, lang: 'en', src: 'anarchistnews.org' });
      }
    }
    cache.set(ck, items, 900);
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

// ── TRANSLATE ──────────────────────────────────────────────────────────────
// ponytail: three engines, one route each. No abstraction — they're different APIs.

// MyMemory (free, no key)
router.post('/translate/mymemory', async (req, res) => {
  const { text, sourceLang } = req.body;
  if (!text) return res.json({ error: 'no text' });
  const lang = (sourceLang && sourceLang !== 'auto') ? `${sourceLang}|en` : 'autodetect|en';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0,500))}&langpair=${encodeURIComponent(lang)}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    res.json({ translated: d.responseData?.translatedText || d.responseDetails || 'error' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DeepL (free tier key in .env)
router.post('/translate/deepl', async (req, res) => {
  const { text, sourceLang } = req.body;
  if (!text) return res.json({ error: 'no text' });
  if (!process.env.DEEPL_TOKEN) return res.status(503).json({ error: 'DeepL not configured' });
  try {
    const r = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [text], target_lang: 'EN', ...(sourceLang && sourceLang !== 'auto' ? { source_lang: sourceLang.toUpperCase() } : {}) })
    });
    const d = await r.json();
    if (d.message) return res.status(400).json({ error: d.message });
    res.json({ translated: d.translations?.[0]?.text || 'error' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Related texts
router.get('/related/:slug', async (req, res) => {
  const { db } = res.locals;
  if (!db) return res.json([]);
  const book = await db.collection('books').findOne({ slug: req.params.slug }, { projection: { category: 1, tags: 1 } });
  if (!book) return res.json([]);
  const q = { slug: { $ne: req.params.slug }, $or: [{ category: book.category }, ...(book.tags||[]).map(t=>({tags:t}))] };
  const related = await db.collection('books').find(q).project({ slug:1, title:1, author:1, cover:1, category:1 }).limit(4).toArray();
  res.json(related);
});

router.get('/admin/fill-covers', async (req, res) => {
  const { db } = res.locals;
  if (!db) return res.status(503).json({ error: 'DB unavailable' });
  const result = await fillCovers(db).catch(e => ({ error: e.message }));
  res.json(result);
});

router.get('/debug-book/:slug', async (req, res) => {
  const { db } = res.locals;
  if (!db) return res.json({ error: 'no db' });
  const book = await db.collection('books').findOne({ slug: req.params.slug }, { projection: { slug: 1, hasBody: 1, bodyLen: { $strLenCP: { $ifNull: ['$body', ''] } }, path: 1 } }).catch(e => ({ error: e.message }));
  res.json(book);
});

module.exports = router;
module.exports.fillCovers = fillCovers;