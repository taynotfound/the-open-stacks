// Crimethinc scraper — crimethinc.com articles via sitemap
// ponytail: sitemap at /sitemap.xml -> filter /en/blog/ and /en/texts/ paths
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(new URL(r.headers.location, url).href).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}

async function scrapeArticle(db, url) {
  const slug = slugify('cwc-' + url.replace('https://crimethinc.com/','').replace(/\//g,'-').replace(/-$/,''));
  if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) return false;

  const html = await get(url).catch(() => null);
  if (!html) return false;

  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1];
  if (!title) return false;
  const titleText = stripHtml(title).slice(0, 200);

  // crimethinc uses <article> or .content-body
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<div[^>]*class="[^"]*body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!articleMatch) return false;
  const bodyText = stripHtml(articleMatch[1]).slice(0, 100000);
  if (bodyText.length < 100) return false;

  const desc = bodyText.slice(0, 300);
  const isText = url.includes('/texts/');

  await upsert(db, {
    slug, title: titleText, author: 'CrimethInc.',
    desc, body: bodyText, source: url,
    sourceName: 'CrimethInc.', category: isText ? 'theory' : 'anarchist-news', language: 'en',
    tags: ['anarchism', isText ? 'theory' : 'news'], hasBody: true, atRisk: false,
    cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
  });
  return true;
}

async function scrape() {
  const db = await getDb();

  // Use the article sitemap
  const sitemapIndex = await get('https://crimethinc.com/sitemap.xml').catch(() => '');
  const sitemapUrls = [...sitemapIndex.matchAll(/<loc>([^<]+sitemap[^<]+)<\/loc>/g)].map(m=>m[1]);

  let total = 0;
  for (const sitemapUrl of sitemapUrls) {
    if (!sitemapUrl.includes('article') && !sitemapUrl.includes('text') && !sitemapUrl.includes('blog')) continue;
    const sm = await get(sitemapUrl).catch(() => '');
    const urls = [...sm.matchAll(/<loc>(https:\/\/crimethinc\.com\/en\/(blog|texts)\/[^<]+)<\/loc>/g)].map(m=>m[1]);
    console.log(`[CrimethInc] ${sitemapUrl}: ${urls.length} URLs`);
    let inserted = 0;
    for (const url of urls) {
      const isNew = await scrapeArticle(db, url).catch(() => false);
      if (isNew) inserted++;
      await new Promise(r => setTimeout(r, 600));
    }
    total += inserted;
    console.log(`[CrimethInc] +${inserted} from ${sitemapUrl}`);
    if (inserted === 0) break; // already have everything
  }
  console.log(`[CrimethInc] TOTAL: +${total}`);
  await closeDb();
}

scrape().catch(e => { console.error(e); process.exit(1); });
