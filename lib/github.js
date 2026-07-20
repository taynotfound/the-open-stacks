// Shared GitHub API helper — used by pages.js and translate.js
const https = require('https');
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'taynotfound/open-stacks-library';

function ghApi(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const r = https.request({
      hostname: 'api.github.com', path: `/repos/${REPO}/${path}`, method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'OpenStacks/1.0', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    r.on('error', reject); r.write(body); r.end();
  });
}

function ghGet(path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: 'api.github.com', path: `/repos/${REPO}/${path}`, headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'OpenStacks/1.0' } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }
    ).on('error', reject);
  });
}

module.exports = { ghApi, ghGet, TOKEN, REPO };
