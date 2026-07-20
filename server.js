const express = require('express');
const { MongoClient } = require('mongodb');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4200;
const MONGODB_URI = process.env.MONGODB_URI;
const cache = new NodeCache({ stdTTL: 300 });
let db = null;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('open-stacks');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { res.locals.db = db; res.locals.cache = cache; res.locals.req = req; next(); });

app.use('/', require('./routes/pages'));
app.use('/api', require('./routes/api'));
app.use('/api/translate', require('./routes/translate'));
app.use('/', require('./routes/feeds'));

connectDB().then(() => app.listen(PORT, () => console.log(`The Open Stacks running on http://localhost:${PORT}`)));
