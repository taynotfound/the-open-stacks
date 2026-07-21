#!/usr/bin/env node
// Generic RSS scraper — add sources here, runs in run_all.js
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

const SOURCES = [
  { name: "Black Rose/Rosa Negra", url: "https://blackrosefed.org/feed/", slug: "brf", category: "anarchism" },
  { name: "Institute for Anarchist Studies", url: "https://anarchiststudies.org/feed/", slug: "ias", category: "anarchist-theory" },
  { name: "Anarcho-Syndicalist Review", url: "https://syndicalist.us/feed/", slug: "asr", category: "anarchism" },
  { name: "Black Agenda Report", url: "https://blackagendareport.com/rss.xml", slug: "bar", category: "anti-racism" },
  { name: "Counterpunch", url: "https://www.counterpunch.org/feed/", slug: "cp", category: "politics" },
  { name: "Labor Notes", url: "https://labornotes.org/rss.xml", slug: "ln", category: "labour" },
  { name: "Unicorn Riot", url: "https://unicornriot.ninja/feed/", slug: "ur", category: "anarchist-news" },
  { name: "Wrong Kind of Green", url: "https://www.wrongkindofgreen.org/feed/", slug: "wkg", category: "ecology" },
  { name: "The Anarchist Library", url: "https://theanarchistlibrary.org/feed", slug: "tal", category: "anarchist-theory", hasEpub: true },
];

function get(url, rd = 5) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search, timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0' }
    }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && rd > 0)
        return get(new URL(r.headers.location, url).href, rd - 1).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

const strip = s => (s || '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

async function scrapeOne(db, src) {
  const rss = await get(src.url);
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let inserted = 0;
  for (const [, item] of items) {
    const link = strip((item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1] || '').replace(/\?v=\d+/, '');
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const desc = strip((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 300);
    const epubUrl = src.hasEpub ? ((item.match(/<enclosure[^>]+url="([^"]+\.epub)"/) || [])[1] || '') : '';
    const body = !src.hasEpub ? strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 80000) : '';
    const author = strip((item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) || [])[1] || '') || src.name;
    if (!link || !title) continue;
    const slug = src.slug + '-' + slugify(title).slice(0, 68);
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    await upsert(db, {
      slug, title, author, desc: desc || body.slice(0, 300), body: body || '',
      source: link, sourceName: src.name, category: src.category, language: 'eng',
      tags: [src.category, 'news'], hasBody: body.length > 50, atRisk: false,
      cover: '', files: epubUrl ? [{ url: epubUrl, name: 'epub', ext: 'epub' }] : [], images: [], links: [], state: 'active', path: '', pageType: 'external',
    });
    inserted++;
  }
  return inserted;
}

async function scrape() {
  const db = await getDb();
  for (const src of SOURCES) {
    try {
      const n = await scrapeOne(db, src);
      console.log(`[${src.name}] +${n} new`);
    } catch (e) {
      console.error(`[${src.name}] error: ${e.message}`);
    }
  }
  await closeDb();
}

scrape().catch(e => { console.error(e.message); process.exit(1); });
