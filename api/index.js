// Vercel serverless entry — ponytail: cold-start reconnects MongoDB each invocation; add connection caching if latency matters
const app = require('../server');
module.exports = app;
