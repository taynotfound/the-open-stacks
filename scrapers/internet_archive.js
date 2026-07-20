// Internet Archive bulk scraper — anarchism + radical subjects
// API: archive.org/advancedsearch.php — full JSON, no scraping needed
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

const SUBJECTS = ['anarchism', 'anarchist', 'antifascism', 'syndicalism', 'libertarian socialism'];
const PAGE = 500;

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}

async function scrapeSubject(db, subject) {
  let page = 1, inserted = 0, updated = 0;
  while (true) {
    const url = `https://archive.org/advancedsearch.php?q=subject:(${encodeURIComponent(subject)})&fl=identifier,title,creator,description,subject,language,date,mediatype&rows=${PAGE}&page=${page}&output=json`;
    let raw, data;
    try { raw = await get(url); data = JSON.parse(raw); } catch (e) { console.error(`[IA] page ${page} parse error: ${e.message}, skipping`); page++; continue; }
    const docs = data?.response?.docs || [];
    if (!docs.length) break;

    for (const d of docs) {
      const title = d.title || d.identifier;
      const slug = slugify(`ia-${d.identifier || title}`);
      const tags = [].concat(d.subject || []).map(s => s.toLowerCase().trim()).filter(Boolean).slice(0, 10);
      const doc = {
        slug, title,
        author: [].concat(d.creator || []).join(', ') || 'Unknown',
        desc: (d.description || '').slice(0, 500),
        source: `https://archive.org/details/${d.identifier}`,
        sourceName: 'Internet Archive',
        // ponytail: mediatype from IA API, audio/video get own category
        category: ['audio','etree'].includes(d.mediatype) ? 'audio' : d.mediatype === 'movies' ? 'video' : 'theory-and-politics',
        language: ([].concat(d.language || 'en')[0]).toLowerCase().slice(0, 2),
        tags, hasBody: false, atRisk: false, cover: '', files: [], images: [], links: [],
        state: 'active', path: '', pageType: 'external',
      };
      const isNew = await upsert(db, doc);
      isNew ? inserted++ : updated++;
    }
    console.log(`[IA] subject="${subject}" page=${page} docs=${docs.length}`);
    if (docs.length < PAGE) break;
    page++;
    await new Promise(r => setTimeout(r, 500)); // polite
  }
  return { inserted, updated };
}

(async () => {
  const db = await getDb();
  let total = { inserted: 0, updated: 0 };
  for (const s of SUBJECTS) {
    const r = await scrapeSubject(db, s);
    total.inserted += r.inserted; total.updated += r.updated;
    console.log(`[IA] "${s}" done: +${r.inserted} new, ${r.updated} updated`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`[IA] TOTAL: +${total.inserted} new, ${total.updated} updated`);
  await closeDb();
})();
