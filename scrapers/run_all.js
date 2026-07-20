#!/usr/bin/env node
// run all scrapers: node scrapers/run_all.js [--all]
const { execFileSync } = require('child_process');
const args = process.argv.slice(2);
const scrapers = ['ainfos.js', 'spunk.js'];
for (const s of scrapers) {
  console.log(`\n=== ${s} ===`);
  try {
    execFileSync('node', [`scrapers/${s}`, ...args], { cwd: require('path').join(__dirname, '..'), stdio: 'inherit' });
  } catch (e) {
    console.error(`${s} failed: ${e.message}`);
  }
}
