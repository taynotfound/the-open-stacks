const express = require('express');
const https = require('https');
const router = express.Router();
const { ghApi, ghGet } = require('../lib/github');

function post(url, data, headers={}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname, path: opts.pathname + opts.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'OpenStacks/1.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

// MyMemory
router.post('/mymemory', async (req, res) => {
  try {
    const { text, sourceLang } = req.body;
    if (!text || !sourceLang) return res.status(400).json({ error: 'Missing text or sourceLang' });
    const chunks = splitChunks(text, 450); // MyMemory limit ~500 chars per call
    const parts = [];
    for (const chunk of chunks) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${sourceLang}|en`;
      const r = await get(url);
      const d = JSON.parse(r.body);
      if (d.responseStatus !== 200) throw new Error(d.responseDetails || 'MyMemory error');
      parts.push(d.responseData.translatedText);
    }
    res.json({ translated: parts.join('\n\n') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DeepL free API — requires DEEPL_KEY env, falls back gracefully
router.post('/deepl', async (req, res) => {
  const key = process.env.DEEPL_KEY;
  if (!key) return res.status(503).json({ error: 'DeepL not configured' });
  try {
    const { text, sourceLang } = req.body;
    const r = await post('https://api-free.deepl.com/v2/translate', {
      text: [text], source_lang: sourceLang.toUpperCase(), target_lang: 'EN'
    }, { Authorization: `DeepL-Auth-Key ${key}` });
    const d = JSON.parse(r.body);
    if (d.message) throw new Error(d.message);
    res.json({ translated: d.translations[0].text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Google Translate unofficial (no key, works via browser-like request to translate.googleapis.com)
router.post('/', async (req, res) => {
  try {
    const { q, source, target = 'en' } = req.body;
    if (!q || !source) return res.status(400).json({ error: 'Missing q or source' });
    const chunks = splitChunks(q, 3500);
    const parts = [];
    for (const chunk of chunks) {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(chunk)}`;
      const r = await get(url);
      if (r.status !== 200) throw new Error(`Google ${r.status}`);
      const d = JSON.parse(r.body);
      const translated = d[0].map(s => s[0]).join('');
      parts.push(translated);
    }
    res.json({ translated: parts.join('\n\n') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function splitChunks(text, max) {
  const paras = text.split(/\n{2,}/);
  const chunks = []; let cur = '';
  for (const p of paras) {
    if (cur.length + p.length > max && cur) { chunks.push(cur.trim()); cur = ''; }
    // hard-split single paragraphs that exceed max
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) chunks.push(p.slice(i, i + max));
    } else {
      cur += (cur ? '\n\n' : '') + p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

// Contribute a completed translation as a PR
router.post('/contribute', async (req, res) => {
  const { slug, category, title, targetLang, translatedText } = req.body;
  if (!slug || !category || !translatedText || !targetLang)
    return res.status(400).json({ error: 'Missing required fields' });
  const branch = `translate/${slug}-${targetLang}-${Date.now()}`;
  const filePath = `books/${category}/${slug}.${targetLang}.md`;
  const mdContent = `---\ntranslatedFrom: en\ntranslatedTo: ${targetLang}\nsource_slug: ${slug}\n---\n\n${translatedText}`;
  try {
    const ref = await ghGet('git/ref/heads/main');
    const sha = ref.object?.sha;
    if (!sha) return res.status(500).json({ error: 'Could not read repo HEAD' });
    await ghApi('POST', 'git/refs', { ref: `refs/heads/${branch}`, sha });
    await ghApi('PUT', `contents/${filePath}`, {
      message: `translate: add ${targetLang} translation of "${title || slug}"`,
      content: Buffer.from(mdContent).toString('base64'), branch
    });
    const pr = await ghApi('POST', 'pulls', {
      title: `Translation [${targetLang}]: ${title || slug}`,
      body: `Machine-assisted translation to \`${targetLang}\` of [${title || slug}](books/${category}/${slug}.md).\n\nPlease review for accuracy before merging.`,
      head: branch, base: 'main'
    });
    res.json({ pr: pr.html_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
