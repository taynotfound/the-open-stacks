// Spunk Library scraper — Apache dir listings → sp######.txt only, pushed to GitHub
const https = require('https');
const iconv = require('iconv-lite');
const { getDb, closeDb, slugify, upsert } = require('./lib');
const { ghApi, ghGet } = require('../lib/github');

const BASE = 'https://www.spunk.org/texts/';
const CATS = ['pubs', 'misc', 'politics', 'history', 'arts', 'intro', 'people', 'places', 'work', 'fight'];

function getRaw(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return getRaw(r.headers.location).then(res).catch(rej);
      const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}
const get = url => getRaw(url).then(b => iconv.decode(b, 'latin1'));

async function pushGH(path, content) {
  let sha; try { sha = (await ghGet(`contents/${path}`)).sha; } catch {}
  await ghApi('PUT', `contents/${path}`, {
    message: `scrape: spunk ${path}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

async function scrapeDir(db, url, cat, depth = 0) {
  if (depth > 3) return 0;
  let html; try { html = await get(url); } catch { return 0; }
  // subdirs: relative links ending in /
  const subdirs = [...html.matchAll(/href="([^"]+\/)"/g)].map(m => new URL(m[1], url).href).filter(u => u.startsWith(BASE));
  // actual texts: sp######.txt (not index.html)
  const texts = [...html.matchAll(/href="(sp\d+\.txt)"/g)].map(m => new URL(m[1], url).href);

  let inserted = 0;
  for (const u of subdirs) { inserted += await scrapeDir(db, u, cat, depth + 1); await new Promise(r => setTimeout(r, 300)); }

  for (const link of texts) {
    const fname = link.split('/').pop().replace('.txt', '');
    const slug = `spunk-${fname}`;
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;

    let raw; try { raw = await get(link); } catch { continue; }
    const text = raw.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 100) continue; // skip empty/404 files

    // title = first non-empty line, max 120 chars
    const title = text.split('\n').map(l => l.trim()).find(l => l.length > 4 && l.length < 200) || fname;

    const ghPath = `spunk/${cat}/${fname}.md`;
    const md = `# ${title}\n\n**Source:** ${link}\n\n---\n\n${text}`;
    try { await pushGH(ghPath, md); } catch (e) { console.error(`[Spunk] gh push failed: ${e.message}`); continue; }

    await upsert(db, {
      slug, title: title.slice(0, 200), author: 'Spunk Library',
      desc: text.slice(0, 300), body: '',
      source: link, sourceName: 'Spunk Library', category: cat,
      language: 'eng', tags: ['anarchism', cat, 'spunk'],
      hasBody: true, atRisk: true, cover: '',
      files: [], images: [], links: [], state: 'active',
      path: ghPath, pageType: 'external',
    });
    inserted++;
    await new Promise(r => setTimeout(r, 600));
  }
  return inserted;
}

(async () => {
  const db = await getDb();
  let total = 0;
  for (const cat of CATS) {
    const n = await scrapeDir(db, `${BASE}${cat}/`, cat);
    console.log(`[Spunk] ${cat}: +${n}`);
    total += n;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[Spunk] TOTAL: +${total}`);
  await closeDb();
})();
