// CrimethInc scraper — .markdown files from sitemap (clean plaintext, no HTML parsing)
// ponytail: sitemap.xml.gz → grep .markdown URLs → fetch each
const https = require('https');
const zlib = require('zlib');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(new URL(r.headers.location, url).href).then(res).catch(rej);
      const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej).on('timeout', rej);
  });
}

async function getSitemapUrls() {
  const buf = await get('https://crimethinc.com/sitemap.xml.gz');
  const xml = zlib.gunzipSync(buf).toString();
  return [...xml.matchAll(/<loc>(https:\/\/crimethinc\.com\/\d{4}\/[^<]+\.markdown)<\/loc>/g)].map(m => m[1]);
}

async function scrape() {
  const db = await getDb();
  const col = db.collection('books');
  const urls = await getSitemapUrls();
  console.log(`[CrimethInc] ${urls.length} markdown URLs`);
  let inserted = 0;
  for (const mdUrl of urls) {
    // slug from URL: 2024/01/01/some-title.markdown → cwc-2024-01-01-some-title
    const slug = slugify('cwc-' + mdUrl.replace('https://crimethinc.com/','').replace(/\.markdown$/,'').replace(/\//g,'-'));
    if (await col.findOne({ slug }, { projection: { _id: 1 } })) continue;
    const raw = await get(mdUrl).then(b => b.toString()).catch(() => null);
    if (!raw || raw.length < 100) continue;
    // crimethinc markdown: first line is usually the title as "# Title" or YAML front matter
    let title = '', body = raw;
    const h1 = raw.match(/^#\s+(.+)/m);
    const yamlTitle = raw.match(/^title:\s*(.+)/m);
    title = (yamlTitle || h1) ? (yamlTitle||h1)[1].replace(/['"]/g,'').trim() : slug;
    // strip YAML front matter if present
    if (raw.startsWith('---')) body = raw.replace(/^---[\s\S]*?---\n?/, '');
    const bodyText = body.trim().slice(0, 100000);
    if (bodyText.length < 50) continue;
    const isText = mdUrl.includes('-feature-') || mdUrl.includes('/texts/');
    await upsert(db, {
      slug, title: title.slice(0, 200), author: 'CrimethInc.',
      desc: bodyText.slice(0, 300), body: bodyText,
      source: mdUrl.replace('.markdown',''), sourceName: 'CrimethInc.',
      category: isText ? 'theory' : 'anarchist-news', language: 'en',
      tags: ['anarchism', 'crimethinc'], hasBody: true, atRisk: false,
      cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
    if (inserted % 50 === 0) console.log(`[CrimethInc] +${inserted} so far…`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[CrimethInc] TOTAL: +${inserted}`);
  await closeDb();
}

scrape().catch(e => { console.error(e); process.exit(1); });
