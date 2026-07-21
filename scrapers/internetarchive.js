// Internet Archive scraper — anarchism/anarchist texts via search API
// ponytail: fetches metadata only, no full text (IA full text is OCR, quality varies)
const https = require('https');
const { getDb, closeDb, slugify, upsert } = require('./lib');

const QUERIES = ['anarchism', 'anarchist'];
const PER_PAGE = 100;

function get(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' }, timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location).then(res).catch(rej);
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function scrapeQuery(db, query) {
  let start = 0, inserted = 0, emptyRuns = 0;
  while (emptyRuns < 2) {
    const url = `https://archive.org/advancedsearch.php?q=subject:${query}+mediatype:texts&fl=identifier,title,creator,description,language,subject,date&rows=${PER_PAGE}&start=${start}&output=json`;
    let json; try { json = JSON.parse(await get(url)); } catch { break; }
    const docs = json.response?.docs || [];
    if (!docs.length) break;
    let pageNew = 0;
    for (const doc of docs) {
      const id = doc.identifier;
      if (!id) continue;
      const slug = `ia-${slugify(id).slice(0, 80)}`;
      if (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) continue;
      const title = (Array.isArray(doc.title) ? doc.title[0] : doc.title || id).slice(0, 200);
      const author = (Array.isArray(doc.creator) ? doc.creator[0] : doc.creator || '').slice(0, 200);
      const desc = (Array.isArray(doc.description) ? doc.description[0] : doc.description || '').replace(/<[^>]+>/g, '').slice(0, 500);
      const lang = (Array.isArray(doc.language) ? doc.language[0] : doc.language || 'eng').toLowerCase().slice(0, 3);
      const source = `https://archive.org/details/${id}`;
      await upsert(db, {
        slug, title, author, desc, body: '', source, sourceName: 'Internet Archive',
        category: 'anarchism', language: lang || 'eng',
        tags: ['anarchism', 'archive'], hasBody: false, atRisk: false,
        cover: `https://archive.org/services/img/${id}`,
        files: [], // ponytail: real filenames fetched live via /api/ia-files/:id — guessing {id}.pdf 404s
        images: [], links: [], state: 'active', path: '', pageType: 'external',
      });
      inserted++; pageNew++;
    }
    console.log(`[IA] ${query} start=${start}: +${pageNew}`);
    if (pageNew === 0) emptyRuns++; else emptyRuns = 0;
    if (docs.length < PER_PAGE) break;
    start += PER_PAGE;
    await new Promise(r => setTimeout(r, 500));
  }
  return inserted;
}

(async () => {
  const db = await getDb();
  let total = 0;
  for (const q of QUERIES) {
    total += await scrapeQuery(db, q);
    console.log(`[IA] ${q} done`);
  }
  console.log(`[IA] TOTAL: +${total}`);
  await closeDb();
})();
