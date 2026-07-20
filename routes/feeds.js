const express = require('express');
const router = express.Router();

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

router.get('/feed.xml', async (req, res) => {
  const { db, cache } = res.locals;
  const books = db ? await db.collection('books').find({}).sort({ added: -1 }).limit(50).toArray() : [];
  res.set('Content-Type', 'application/rss+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>The Open Stacks</title>
<link>https://theopenstacks.apolochees.me</link>
<description>A free library of radical and political texts</description>
${books.map(b => `<item>
  <title>${esc(b.title)}</title>
  <link>https://theopenstacks.apolochees.me/book/${esc(b.slug)}</link>
  <author>${esc(b.author)}</author>
  <pubDate>${b.added ? new Date(b.added).toUTCString() : ''}</pubDate>
</item>`).join('\n')}
</channel></rss>`);
});

router.get('/feed/new.xml', async (req, res) => {
  const { db } = res.locals;
  const books = db ? await db.collection('books').find({}).sort({ scraped_at: -1 }).limit(20).toArray() : [];
  res.set('Content-Type', 'application/rss+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>The Open Stacks — New Additions</title>
<link>https://theopenstacks.apolochees.me</link>
<description>Recently added texts</description>
${books.map(b => `<item>
  <title>${esc(b.title)}</title>
  <link>https://theopenstacks.apolochees.me/book/${esc(b.slug)}</link>
  <pubDate>${b.scraped_at ? new Date(b.scraped_at).toUTCString() : ''}</pubDate>
</item>`).join('\n')}
</channel></rss>`);
});

router.get('/opds.xml', async (req, res) => {
  const { db } = res.locals;
  const books = db ? await db.collection('books').find({ files: { $exists: true, $ne: [] } }).limit(100).toArray() : [];
  res.set('Content-Type', 'application/atom+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
<title>The Open Stacks</title>
<id>https://theopenstacks.apolochees.me/opds.xml</id>
${books.map(b => `<entry>
  <title>${esc(b.title)}</title>
  <id>urn:slug:${esc(b.slug)}</id>
  <author><name>${esc(b.author)}</name></author>
</entry>`).join('\n')}
</feed>`);
});

module.exports = router;
