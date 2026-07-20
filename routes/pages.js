const express = require('express');
const https = require('https');
const router = express.Router();

const RAW = 'https://raw.githubusercontent.com/taynotfound/open-stacks-library/main';

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' } }, res => {
      if (res.statusCode === 404) return resolve(null);
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function stripFrontmatter(md) {
  const m = md.match(/^---[\s\S]*?---\n?([\s\S]*)/);
  return m ? m[1].trim() : md.trim();
}

function extractToc(md) {
  const headings = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^#{2,4}\s+(.+)/);
    if (m) headings.push(m[1].trim());
  }
  return headings;
}

function mdToHtml(text) {
  let i = 0;
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{4}\s+(.+)$/gm, (_, t) => `<h4>${t}</h4>`)
    .replace(/^#{3}\s+(.+)$/gm, (_, t) => `<h3 id="section-${i++}">${t}</h3>`)
    .replace(/^#{2}\s+(.+)$/gm, (_, t) => `<h2 id="section-${i++}">${t}</h2>`)
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .split(/\n{2,}/)
    .map(p => p.startsWith('<h') || p.startsWith('<hr') || p.startsWith('<blockquote') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

async function getStats(db, cache) {
  if (!db) return { total: 0, withBody: 0, sources: 0 };
  const hit = cache.get('stats');
  if (hit) return hit;
  try {
    const col = db.collection('books');
    const [total, withBody] = await Promise.all([col.countDocuments(), col.countDocuments({ hasBody: true })]);
    const sources = (await col.distinct('sourceName')).filter(Boolean).length;
    const result = { total, withBody, sources };
    cache.set('stats', result, 600);
    return result;
  } catch { return { total: 0, withBody: 0, sources: 0 }; }
}

async function getCategories(db, cache) {
  if (!db) return [];
  const hit = cache.get('categories');
  if (hit) return hit;
  try {
    const cats = (await db.collection('books').distinct('category')).filter(Boolean).sort();
    cache.set('categories', cats, 600);
    return cats;
  } catch { return []; }
}

router.get('/', async (req, res) => {
  const { db, cache } = res.locals;
  const { q, category, page = 1 } = req.query;
  const limit = 24, skip = (parseInt(page) - 1) * limit;
  const [stats, categories] = await Promise.all([getStats(db, cache), getCategories(db, cache)]);
  let books = [], total = 0, error = null;
  if (db) {
    try {
      const filter = {};
      if (q?.trim()) filter.$text = { $search: q.trim() };
      if (category) filter.category = category;
      const col = db.collection('books');
      [books, total] = await Promise.all([
        col.find(filter).sort({ added: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter)
      ]);
    } catch (e) { error = e.message; }
  } else { error = 'Database unavailable.'; }
  res.render('index', { books, total, page: parseInt(page), pages: Math.ceil(total / limit), stats, categories, q: q || '', category: category || '', error });
});

router.get('/about', async (req, res) => {
  const stats = await getStats(res.locals.db, res.locals.cache);
  res.render('about', { stats });
});

router.get('/book/:slug', async (req, res) => {
  const { db, cache } = res.locals;
  if (!db) return res.status(503).render('book', { book: null, body: null, toc: [], stats: { total: 0 }, error: 'Database unavailable' });
  const stats = await getStats(db, cache);
  const slug = req.params.slug;

  let book = cache.get(`book:${slug}`);
  if (!book) {
    book = await db.collection('books').findOne({ slug }).catch(() => null);
    if (book) cache.set(`book:${slug}`, book, 300);
  }
  if (!book) return res.status(404).render('book', { book: null, body: null, toc: [], stats, error: 'Text not found.' });

  // Find translations of this book (books where originalSlug === slug)
  let translations = [];
  if (db) {
    try {
      translations = await db.collection('books').find({ originalSlug: slug }).project({ slug: 1, language: 1, translatedType: 1 }).toArray();
    } catch {}
  }
  book.translations = translations;

  let body = null, toc = [];
  if (book.hasBody && book.path) {
    const ck = `body:${slug}`;
    const cached = cache.get(ck);
    if (cached) { body = cached.html; toc = cached.toc; }
    else {
      const md = await fetchRaw(`${RAW}/${book.path}`).catch(() => null);
      if (md) {
        const content = stripFrontmatter(md);
        toc = extractToc(content);
        body = mdToHtml(content);
        cache.set(ck, { html: body, toc }, 3600);
      }
    }
  }

  res.render('book', { book, body, toc, stats, error: null });
});

module.exports = router;
