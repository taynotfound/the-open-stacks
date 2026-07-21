const https = require('https');
const express = require('express');
const { MongoClient } = require('mongodb');
const NodeCache = require('node-cache');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4200;
const MONGODB_URI = process.env.MONGODB_URI;
const cache = new NodeCache({ stdTTL: 300 });
// ponytail: single persistent client, driver handles pool + reconnects
const client = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxIdleTimeMS: 270000, // ponytail: close idle connections before Atlas's 30min idle timeout kills them
});
const db = client.db('open-stacks');

async function connectDB() {
  await client.connect();
  db.collection('books').createIndex({ title: 'text', author: 'text', desc: 'text', tags: 'text', body: 'text' }).catch(() => {});
  console.log('Connected to MongoDB');
  // ponytail: ping every 4min to keep Atlas connection alive
  setInterval(() => db.command({ ping: 1 }).catch(() => {}), 4 * 60 * 1000);
  // fill missing covers/metadata once on boot
  const { fillCovers } = require('./routes/api');
  const _fc = () => fillCovers(db).then(r => console.log('fill-covers:', r)).catch(() => {});
  _fc();
  setInterval(_fc, 15 * 60 * 1000); // ponytail: 15min, dial back once backfill done
  // run scrapers daily
  if (!process.env.VERCEL) {
  const { execFile } = require('child_process');
  const WEBHOOK = 'https://discord.com/api/webhooks/1527697124471476315/cRRtYP7XXrcD0BOeLI3ZclDIb0psPimSyeLQoJSAyXYkQ4qjZLBWQDDMuJtDdcVh5rt6';
  function postWebhook(content) {
    const body = JSON.stringify({ username: 'open-stacks scraper', content });
    const u = new URL(WEBHOOK);
    https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => r.resume()).on('error', ()=>{}).end(body);
  }
  const runScrapers = () => {
    const t = Date.now();
    execFile('node', ['scrapers/run_all.js'], { cwd: __dirname, timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      const lines = (stdout + stderr).split('\n').filter(Boolean);
      const added = lines.filter(l => /insert|new|added/i.test(l)).length;
      const errs  = lines.filter(l => /error|fail/i.test(l));
      let msg = `📚 **scrape done** in ${elapsed}s`;
      if (added) msg += ` — ${added} new items`;
      if (errs.length) msg += `\n⚠️ errors: ${errs.slice(0,3).join('; ')}`;
      if (err) msg += `\n🔴 exit: ${err.message}`;
      postWebhook(msg);
    });
  };
  runScrapers();
  setInterval(runScrapers, 20 * 60 * 1000);
  } // end !VERCEL
} // end connectDB

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => { res.locals.db = db; res.locals.cache = cache; res.locals.req = req; next(); });

app.use('/', require('./routes/pages'));
app.use('/api', require('./routes/api'));
app.use('/api/translate', require('./routes/translate'));
app.use('/', require('./routes/feeds'));

// 404
app.use(async (req, res) => {
  const stats = res.locals.cache?.get('stats') || {};
  res.status(404).render('error', { status: 404, title: 'Not Found', message: "This page doesn't exist or was moved. Try searching the library.", stats });
});

// 500
app.use(async (err, req, res, next) => {
  console.error(err.stack);
  const stats = res.locals.cache?.get('stats') || {};
  res.status(500).render('error', { status: 500, title: 'Something went wrong', message: "An internal error occurred. It's been logged — try again in a moment.", stats });
});

connectDB();
if (require.main === module) {
  app.listen(PORT, () => console.log(`The Open Stacks running on http://localhost:${PORT}`));
}
module.exports = app;
