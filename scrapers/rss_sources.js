#!/usr/bin/env node
// Generic RSS scraper — add sources here, runs in run_all.js
const { getDb, closeDb, slugify, upsert, get, strip, fetchBody, fetchCover } = require('./lib');
const FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';

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

async function scrapeOne(db, src) {
  const rss = await get(src.url, FF);
  const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let inserted = 0;
  for (const [, item] of items) {
    const link = strip((item.match(/<link>([^<]+)<\/link>/) || item.match(/<guid[^>]*>([^<]+)<\/guid>/) || [])[1] || '').replace(/\?v=\d+/, '');
    const title = strip((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').slice(0, 200);
    const desc = strip((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 300);
    const epubUrl = src.hasEpub ? ((item.match(/<enclosure[^>]+url="([^"]+\.epub)"/) || [])[1] || '') : '';
    const rssBody = !src.hasEpub ? strip((item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').slice(0, 80000) : '';
    const rawAuthor = strip((item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) || [])[1] || '');
    // reject machine-account usernames (no spaces, all-lowercase, contains digits)
    const author = (rawAuthor && rawAuthor.length < 60 && /\s/.test(rawAuthor)) ? rawAuthor : src.name;
    if (!link || !title) continue;
    const slug = src.slug + '-' + slugify(title).slice(0, 68);
    if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
    // fetch full article if RSS body is thin (TAL always has body via src.txt, skip)
    let body = rssBody;
    let cover = strip((item.match(/<enclosure[^>]+url="([^"]+\.(?:jpe?g|png|webp))"/i) || item.match(/<media:content[^>]+url="([^"]+)"/i) || [])[1] || '');
    if (!src.hasEpub && body.length < 500 && link) {
      body = (await fetchBody(link).catch(() => null)) || rssBody;
    }
    if (!cover && link && !src.hasEpub) cover = await fetchCover(link);
    await upsert(db, {
      slug, title, author, desc: (desc || body.slice(0, 300)).replace(/\s+/g, ' ').trim(),
      body,
      source: link, sourceName: src.name, category: src.category, language: 'eng',
      tags: [src.category, 'news'], hasBody: body.length > 50, atRisk: false,
      cover, files: epubUrl ? [{ url: epubUrl, name: 'epub', ext: 'epub' }] : [], images: [], links: [], state: 'active', path: '', pageType: 'external',
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
