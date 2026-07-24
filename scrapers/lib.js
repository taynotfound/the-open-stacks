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
  const dec = x => x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&nbsp;/g, ' ');
  // decode → strip → decode: feeds ship entity-encoded HTML, one pass leaves markup behind
  t = dec(t).replace(/<[^>]+>/g, ' ');
  return dec(t).replace(/\uFFFD+/g, '').replace(/\s+/g, ' ').trim();
};

// find index of the closing tag that matches the opening at position 0, accounting for nesting
function findClose(html, tag) {
  const o = `<${tag}`, c = `</${tag}>`;
  let depth = 1, pos = 0;
  while (depth > 0 && pos < html.length) {
    const oi = html.indexOf(o, pos);
    const ci = html.indexOf(c, pos);
    if (ci === -1) break;
    if (oi !== -1 && oi < ci) { depth++; pos = oi + o.length; }
    else { depth--; pos = ci + c.length; if (depth === 0) return ci; }
  }
  return -1;
}

// Fetch main article text from a URL — site-specific selectors, falls back to <article>/<main>
function fetchBody(url, timeout = 10000) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'TheOpenStacks/1.0', Accept: 'text/html' }, timeout }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBody(new URL(res.headers.location, url).href, timeout).then(resolve);
      if (res.statusCode !== 200) return resolve(null);
      let d = ''; res.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); });
      res.on('end', () => {
        d = d.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
        const selectors = /anarchistlibrar/i.test(url) ? ['id="main-text"', 'class="muse-format-content"']
          : /libcom\.org|anarchistnews\.org/i.test(url) ? ['field--type-text-with-summary', 'field--name-body', 'node__content']
          : /crimethinc\.com/i.test(url) ? ['class="content-container"', 'class="entry-content"']
          : ['class="entry-content"', 'class="post-content"', 'class="article-content"', 'class="content"', 'itemprop="articleBody"'];
        selectors.push('<article', '<main');
        for (const sel of selectors) {
          const idx = d.indexOf(sel);
          if (idx === -1) continue;
          const tag = d.slice(d.lastIndexOf('<', idx) + 1, idx).trim().split(/\s/)[0];
          const start = d.indexOf('>', idx) + 1;
          let block = d.slice(start, start + 300000);
          const ci = findClose(block, tag);
          // use nesting-aware close if found close enough (< 20kb), else fall back to first sibling close tag
          const bound = (ci > 0 && ci < 20000) ? ci : block.indexOf(`</${tag}>`);
          if (bound > 0) block = block.slice(0, bound);
          const text = block.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/h[1-6]>/gi, '\n\n')
            .replace(/<\/li>/gi, '\n').replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, '\n\n').trim();
          if (text.length > 300) {
              // strip Drupal author/date header injected into body on anarchistnews
              const clean = /anarchistnews\.org/i.test(url)
                ? text.replace(/^by [^\n]+\n[\s\S]{0,60}?\d{4}[\s\S]*?\n(\n)+/, '').trim()
                : text;
              return resolve(clean.length > 100 ? clean : text);
            }
        }
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { getDb, closeDb, slugify, upsert, get, strip, fetchBody: fetchBodyWithFallback, fetchBodyRaw: fetchBody, fetchCover };

// og:image from article HTML; jina markdown's first image as 403 fallback
async function fetchCover(url) {
  try {
    const html = await get(url, 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0').catch(() => null);
    const og = html && (html.match(/property="og:image"[^>]+content="([^"]+)"/) || html.match(/content="([^"]+)"[^>]+property="og:image"/));
    if (og) return og[1];
    const md = await get('https://r.jina.ai/' + url);
    return (md.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:jpe?g|png|webp)[^)\s]*)\)/i) || [])[1] || '';
  } catch { return ''; }
}

// Jina reader fallback for sites that 403 direct fetches (e.g. counterpunch.org)
async function fetchBodyWithFallback(url, timeout = 10000) {
  const direct = await fetchBody(url, timeout);
  if (direct) return direct;
  try {
    const md = await get('https://r.jina.ai/' + url);
    if (!md || md.length < 500) return null;
    // strip jina header block and markdown image/link noise
    const idx = md.indexOf('Markdown Content:');
    let text = (idx >= 0 ? md.slice(idx + 17) : md)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n').trim();
    return text.length > 300 ? text : null;
  } catch { return null; }
}
