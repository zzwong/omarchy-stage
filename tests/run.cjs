#!/usr/bin/env node
// Runs every tests/*.test.cjs in its own process and stops at the first
// failure, so CI needs one step and a local run needs one command.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.cjs')).sort();
if (files.length === 0) {
  console.error('no tests found in ' + dir);
  process.exit(1);
}
for (const file of files) {
  try {
    execFileSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  } catch (err) {
    console.error('FAIL ' + file);
    process.exit(err.status || 1);
  }
}
console.log(files.length + ' test file(s) passed');
