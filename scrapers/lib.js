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
  const dec = x => x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&nbsp;/g, ' ');
  return dec(t.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
};

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
          : /libcom\.org/i.test(url) ? ['class="field--name-body"', 'class="node__content"']
          : /crimethinc\.com/i.test(url) ? ['class="content-container"', 'class="entry-content"']
          : ['class="entry-content"', 'class="post-content"', 'class="article-content"', 'class="content"', 'itemprop="articleBody"'];
        selectors.push('<article', '<main');
        for (const sel of selectors) {
          const idx = d.indexOf(sel);
          if (idx === -1) continue;
          const tag = d.slice(d.lastIndexOf('<', idx) + 1, idx).trim().split(/\s/)[0];
          const start = d.indexOf('>', idx) + 1;
          let block = d.slice(start, start + 300000);
          const ci = block.lastIndexOf(`</${tag}>`);
          if (ci > 100) block = block.slice(0, ci);
          const text = block.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/h[1-6]>/gi, '\n\n')
            .replace(/<\/li>/gi, '\n').replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, '\n\n').trim();
          if (text.length > 300) return resolve(text);
        }
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { getDb, closeDb, slugify, upsert, get, strip, fetchBody };
