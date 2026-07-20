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
}

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
