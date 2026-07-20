const express = require('express');
const https = require('https');
const router = express.Router();

const RAW = 'https://raw.githubusercontent.com/taynotfound/open-stacks-library/main';

function fetchRaw(url, conditionalEtag) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'OpenStacks/1.0' };
    if (conditionalEtag) headers['If-None-Match'] = conditionalEtag;
    https.get(url, { headers }, res => {
      if (res.statusCode === 304) return resolve({ notModified: true });
      if (res.statusCode === 404) return resolve(null);
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ body: d, etag: res.headers['etag'] || null }));
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
  // strip YAML front matter
  if (text.startsWith('---')) text = text.replace(/^---[\s\S]*?---\n?/, '');
  // strip Twitter/X embed URLs (CORP-blocked, useless without embed JS)
  text = text.replace(/https?:\/\/(twitter|x)\.com\/[^\s\])"]+/g, '');
  // strip Kramdown block attributes {: #id .class} and footnote defs [^1]: ...
  text = text.replace(/^\{:[^}]*\}\s*$/gm, '');
  text = text.replace(/^\[\^[^\]]+\]:.+$/gm, '');
  // CrimethInc [[url]] or [[url class:X caption text]] → figure with optional caption
  text = text.replace(/\[\[(https?:\/\/[^\]\s]+)(?:\s+class:[^\s\]]+)?(?:\s+([^\]]+))?\]\]/g, (_, url, caption) =>
    caption ? `\n\n![${caption.trim()}](${url})\n\n*${caption.trim()}*\n\n` : `![](${url})`);
  // promote single newlines to double — do this first so \n\n check below is accurate
  if (text.includes('\n') && !text.includes('\n\n')) {
    text = text.replace(/\n/g, '\n\n');
  }
  // ponytail: re-paragraph wall-of-text if no double newlines exist (scraped content)
  if (!text.includes('\n\n') && text.length > 500) {
    text = text.replace(/[ \t]{3,}([IVXLCDM]+)\. /g, '\n\n## ');
    // split on sentence end + capital (incl. accented/unicode) — covers FR/DE/ES
    text = text.replace(/([.!?])\s+([A-ZÁÉÍÓÚÄÖÜÀÂÇÈÊÎÏÔÙÛŒÆÑ«"])/g, '$1\n\n$2');
  }
  let i = 0;
  const lines = text.split('\n');
  const out = [];
  let inQuote = false, quoteLines = [], inAbbr = false, abbrLines = [];

  const flushQuote = () => { if (quoteLines.length) { out.push(`<blockquote>${quoteLines.join('<br>')}</blockquote>`); quoteLines = []; } inQuote = false; };
  const flushAbbr = () => {
    if (!abbrLines.length) { inAbbr = false; return; }
    const rows = abbrLines.map(l => { const m = l.match(/^([A-Z]{2,})\s{2,}(.+)$/); return m ? `<tr><td class="abbr-key">${m[1]}</td><td>${m[2]}</td></tr>` : `<tr><td colspan="2">${l}</td></tr>`; });
    out.push(`<table class="abbr-table"><tbody>${rows.join('')}</tbody></table>`);
    abbrLines = []; inAbbr = false;
  };

  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    // blockquote: lines starting with > OR indented italic quote blocks
    if (l.startsWith('> ')) { inQuote = true; quoteLines.push(l.slice(2)); continue; }
    if (inQuote && l.trim() === '') { flushQuote(); out.push(''); continue; }
    if (inQuote) { quoteLines.push(l); continue; }

    // abbreviation table: lines like "WORD    definition..."
    if (/^[A-Z]{2,}\s{2,}\S/.test(l)) { inAbbr = true; abbrLines.push(l); continue; }
    if (inAbbr && /^[A-Z]/.test(l) && !/^#{1,4}\s/.test(l)) { abbrLines.push(l); continue; }
    if (inAbbr) { flushAbbr(); }

    out.push(l);
  }
  if (inQuote) flushQuote();
  if (inAbbr) flushAbbr();

  const joined = out.join('\n');
  return joined
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // restore our already-generated HTML tags
    .replace(/&lt;(\/?(blockquote|table|tbody|tr|td|h[2-4]|sup|p|br|strong|em|a|img|hr)[^&]*)&gt;/g, '<$1>')
    .replace(/&lt;(a href=)&quot;([^&]+)&quot;/g, '<a href="$2"')
    .replace(/^#{4}\s+(.+)$/gm, (_, t) => `<h4>${t}</h4>`)
    .replace(/^#{3}\s+(.+)$/gm, (_, t) => `<h3 id="section-${i++}">${t}</h3>`)
    .replace(/^#{2}\s+(.+)$/gm, (_, t) => `<h2 id="section-${i++}">${t}</h2>`)
    .replace(/^# (.+)$/gm, (_, t) => `<h1 class="book-body-title">${t}</h1>`)
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="body-img" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .split(/\n{2,}/)
    .map(p => {
      if (p.startsWith('<h') || p.startsWith('<hr') || p.startsWith('<blockquote') || p.startsWith('<table') || p.startsWith('<p class="footnote')) return p;
      // "Notes" section heading (standalone)
      if (/^Notes\s*$/.test(p.trim())) return '<h3 class="footnotes-heading" id="section-notes">Notes</h3>';
      // footnote paragraph: starts with digit(s) optionally followed by . then space
      // matches: "1. text", "2 text", "10. text"
      if (/^\d{1,3}\.?\s/.test(p.trim())) {
        return `<p class="footnote">${p.trim().replace(/^(\d{1,3})\.?\s/, '<sup>$1</sup> ')}</p>`;
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

const LANG_NAMES = {en:'English',de:'Deutsch',fr:'Français',es:'Español',ru:'Русский',zh:'中文',ar:'العربية',pt:'Português',it:'Italiano',nl:'Nederlands',pl:'Polski',sv:'Svenska',tr:'Türkçe',ja:'日本語',fa:'فارسی'};
async function getLangs(db, cache) {
  const hit = cache.get('langs');
  if (hit) return hit;
  const codes = db ? await db.collection('books').distinct('language').catch(() => []) : [];
  const langs = codes.filter(Boolean).sort().map(c => ({ code: c, label: LANG_NAMES[c] || c.toUpperCase() }));
  cache.set('langs', langs, 600);
  return langs;
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

// Pretty URLs for SEO — set query params + prettyCanonical, then fall through to index handler
async function indexHandler(req, res) {
  const { db, cache } = res.locals;
  const { q, category, lang, source, page = 1 } = req.query;
  const limit = 24, skip = (parseInt(page) - 1) * limit;
  const [stats, categories, langs] = await Promise.all([getStats(db, cache), getCategories(db, cache), getLangs(db, cache)]);
  let books = [], total = 0, error = null;
  if (db) {
    try {
      const filter = {};
      if (q?.trim()) filter.$text = { $search: q.trim() };
      if (category) filter.category = category;
      if (lang) filter.language = lang;
      if (source) filter.sourceName = source;
      const col = db.collection('books');
      [books, total] = await Promise.all([
        col.find(filter).sort({ added: -1 }).skip(skip).limit(limit)
          .project({ slug:1, title:1, author:1, cover:1, category:1, sourceName:1, hasBody:1, body:1, desc:1 })
          .toArray().then(bs => bs.map(b => {
            // ponytail: extract first image from body as cover if none stored
            if (!b.cover && b.body) {
              const m = b.body.match(/\[\[(https?:\/\/[^\]\s]+)|\!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
              if (m) b.cover = m[1] || m[2];
            }
            // derive read time from body word count, store on object for template
            b._readMin = b.body ? Math.ceil(b.body.split(/\s+/).length / 220) : 0;
            delete b.body; // don't send full body to template
            return b;
          })),
        col.countDocuments(filter)
      ]);
    } catch (e) { error = e.message; }
  } else { error = 'Database unavailable.'; }
  // ponytail: sources list cached same as categories
  let sources = cache.get('sources');
  if (!sources && db) {
    try {
      // ponytail: only sources with >50 items as filter pills — long tail is noise
      const agg = await db.collection('books').aggregate([
        { $group: { _id: '$sourceName', c: { $sum: 1 } } },
        { $match: { _id: { $ne: null }, c: { $gt: 50 } } },
        { $sort: { c: -1 } }
      ]).toArray();
      sources = agg.map(s => s._id).sort();
      cache.set('sources', sources, 600);
    } catch { sources = []; }
  }
  res.render('index', { books, total, page: parseInt(page), pages: Math.ceil(total / limit), stats, categories, langs, sources: sources || [], q: q || '', category: category || '', lang: lang || '', source: source || '', canonical: req.prettyCanonical || null, error });
}

router.get('/', indexHandler);
router.get('/category/:slug', async (req, res, next) => { req.query.category = req.params.slug; req.prettyCanonical = `https://theopenstacks.apolochees.me/category/${req.params.slug}`; return indexHandler(req, res, next); });
router.get('/source/:slug', async (req, res, next) => { req.query.source = decodeURIComponent(req.params.slug); req.prettyCanonical = `https://theopenstacks.apolochees.me/source/${req.params.slug}`; return indexHandler(req, res, next); });

router.get('/random', async (req, res) => {
  const { db } = res.locals;
  if (!db) return res.redirect('/');
  const [book] = await db.collection('books').aggregate([{ $sample: { size: 1 } }]).toArray().catch(() => []);
  res.redirect(book ? `/book/${book.slug}` : '/');
});

router.get('/reading-list', async (req, res) => {
  const stats = await getStats(res.locals.db, res.locals.cache);
  res.render('reading-list', { stats });
});

router.get('/about', async (req, res) => {
  const stats = await getStats(res.locals.db, res.locals.cache);
  res.render('about', { stats });
});

router.get('/book/:slug', async (req, res, next) => {
  try {
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

  // ponytail: O(n) tag scan, fine for <100k, switch to Atlas Search if slow
  let related = [];
  if (book.tags?.length && db) {
    related = await db.collection('books')
      .find({ tags: { $in: book.tags }, slug: { $ne: slug } })
      .project({ slug: 1, title: 1, author: 1, cover: 1, category: 1 })
      .limit(4).toArray().catch(() => []);
  }

  let body = null, toc = [];

  if (book.hasBody && book.body) {
    // ponytail: body stored directly in DB (scraped items) — just use it
    body = mdToHtml(book.body);
  } else if (book.hasBody && book.path) {
    const ck = `body:${slug}`;
    const cached = cache.get(ck);
    if (cached) { body = cached.html; toc = cached.toc; }
    else {
      const savedEtag = cache.get(`body:${slug}:etag`);
      const result = await fetchRaw(`${RAW}/${book.path}`, savedEtag).catch(() => null);
      if (result?.notModified && cached) { body = cached.html; toc = cached.toc; }
      else if (result?.body) {
        const content = stripFrontmatter(result.body);
        toc = extractToc(content);
        body = mdToHtml(content);
        cache.set(ck, { html: body, toc }, 3600);
        if (result.etag) cache.set(`body:${slug}:etag`, result.etag, 7200);
      }
    }
  }

  res.render('book', { book, body, toc, stats, related, translations, error: null });
  } catch (e) { next(e); }
});

router.get('/stats', async (req, res) => {
  const { db, cache } = res.locals;
  const stats = await getStats(db, cache);
  let breakdown = [];
  if (db) {
    try {
      breakdown = await db.collection('books').aggregate([
        { $group: { _id: '$category', count: { $sum: 1 }, withBody: { $sum: { $cond: ['$hasBody', 1, 0] } } } },
        { $sort: { count: -1 } }
      ]).toArray();
    } catch {}
  }
  res.render('stats', { stats, breakdown });
});

router.get('/contribute', async (req, res) => {
  const { db, cache } = res.locals;
  const stats = await getStats(db, cache);
  const cats = await getCategories(db, cache);
  res.render('contribute', { stats, cats });
});

const { ghApi, ghGet } = require('../lib/github');

router.post('/api/contribute', async (req, res) => {
  const { title, author, category, desc, tags, source, language, textContent } = req.body;
  if (!title?.trim() || !category?.trim()) return res.status(400).json({ error: 'Title and category required.' });
  const slug = title.toLowerCase().replace(/[^\w\s-]/g,'').trim().replace(/[\s_]+/g,'-').slice(0,80);
  const tagsArr = (tags||'').split(',').map(t=>t.trim()).filter(Boolean);
  const added = Math.floor(Date.now()/1000);
  const branch = `contribute/${slug}-${added}`;
  const filePath = `books/${category}/${slug}.md`;
  const mdFile = [
    '---',
    `title: "${title.replace(/"/g,'\\"')}"`,
    `author: "${(author||'').replace(/"/g,'\\"')}"`,
    `category: "${category}"`,
    `desc: "${(desc||'').replace(/"/g,'\\"')}"`,
    `tags: [${tagsArr.map(t=>`"${t}"`).join(', ')}]`,
    `language: "${language||'en'}"`,
    `source: "${source||''}"`,
    `added: ${added}`,
    `state: "${textContent?.trim() ? 'full' : 'linked'}"`,
    '---', '',
    textContent||''
  ].join('\n');
  try {
    const ref = await ghGet('git/ref/heads/main');
    const sha = ref.object?.sha;
    if (!sha) return res.status(500).json({ error: 'Could not read repo HEAD.' });
    await ghApi('POST', 'git/refs', { ref: `refs/heads/${branch}`, sha });
    await ghApi('PUT', `contents/${filePath}`, { message: `contribute: add "${title}"`, content: Buffer.from(mdFile).toString('base64'), branch });
    if (req.body.pdfBase64) {
      await ghApi('PUT', `contents/books/${category}/${slug}.pdf`, { message: `contribute: add PDF for "${title}"`, content: req.body.pdfBase64, branch });
    }
    const pr = await ghApi('POST', 'pulls', {
      title: `Contribute: ${title}`,
      body: `**Author:** ${author||'Unknown'}\n**Category:** ${category}\n**Language:** ${language||'en'}\n\n${desc||''}`,
      head: branch, base: 'main'
    });
    res.json({ pr: pr.html_url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
