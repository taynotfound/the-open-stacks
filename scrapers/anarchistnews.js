// Anarchist News scraper — WordPress JSON API at anarchistnews.org
// ponytail: WP REST API /wp-json/wp/v2/posts?per_page=100&page=N
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

function get(url) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return get(new URL(r.headers.location, url).href).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}

async function scrape() {
  const db = await getDb();
  let page = 1, total = 0;
  while (true) {
    const url = `https://anarchistnews.org/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,slug,title,content,excerpt,date,categories,tags,author`;
    let resp;
    try { resp = await get(url); } catch (e) { console.error(`[AnarchistNews] fetch error p${page}:`, e.message); break; }
    if (resp.status === 400 || resp.status === 404) break; // past last page
    let posts;
    try { posts = JSON.parse(resp.body); } catch { break; }
    if (!Array.isArray(posts) || posts.length === 0) break;

    let inserted = 0;
    for (const p of posts) {
      const slug = slugify('an-' + p.slug);
      const title = stripHtml(p.title?.rendered || '').slice(0, 200);
      const bodyRaw = p.content?.rendered || '';
      const bodyText = stripHtml(bodyRaw).slice(0, 100000);
      const desc = stripHtml(p.excerpt?.rendered || bodyText).slice(0, 300);
      if (!title || bodyText.length < 50) continue;

      await upsert(db, {
        slug, title, author: 'Anarchist News',
        desc, body: bodyText, source: `https://anarchistnews.org/?p=${p.id}`,
        sourceName: 'anarchistnews.org', category: 'anarchist-news', language: 'en',
        tags: ['anarchism', 'news'], hasBody: true, atRisk: false,
        cover: '', files: [], images: [], links: [], state: 'active', path: '', pageType: 'external',
        added: Math.floor(new Date(p.date).getTime() / 1000),
      });
      inserted++;
    }
    console.log(`[AnarchistNews] p${page}: +${inserted} new`);
    total += inserted;
    if (inserted === 0 && page > 1) { console.log('[AnarchistNews] no new items, stopping'); break; }
    if (posts.length < 100) break;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[AnarchistNews] TOTAL: +${total}`);
  await closeDb();
}

scrape().catch(e => { console.error(e); process.exit(1); });
