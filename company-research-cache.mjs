#!/usr/bin/env node

/**
 * company-research-cache.mjs
 *
 * Small helper for reading/writing generated company research cache entries.
 * AI workers still perform the research; this script standardizes the path and
 * freshness metadata so repeated evaluations of the same employer can reuse it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(ROOT, 'data/cache/company-research');
const args = process.argv.slice(2);

function usage(exitCode = 0) {
  console.log(`Usage:
  node company-research-cache.mjs get "Company Name"
  node company-research-cache.mjs put "Company Name" '{"salary":[],"hiring_signals":[]}'
  node company-research-cache.mjs path "Company Name"`);
  process.exit(exitCode);
}

function slugify(input) {
  return String(input || 'unknown')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function cachePath(company) {
  return join(CACHE_DIR, `${slugify(company)}.json`);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

const [cmd, company, inlineJson] = args;
if (!cmd || cmd === '-h' || cmd === '--help') usage(cmd ? 0 : 1);
if (!company) usage(1);

const path = cachePath(company);

if (cmd === 'path') {
  console.log(path);
  process.exit(0);
}

if (cmd === 'get') {
  if (!existsSync(path)) {
    console.log(JSON.stringify({ status: 'miss', company, path }, null, 2));
    process.exit(0);
  }
  const entry = JSON.parse(readFileSync(path, 'utf-8'));
  console.log(JSON.stringify({ status: 'hit', company, path, entry }, null, 2));
  process.exit(0);
}

if (cmd === 'put') {
  const raw = inlineJson || await readStdin();
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON: ${err.message}`);
    process.exit(1);
  }
  const wrapped = {
    company,
    updated_at: new Date().toISOString(),
    ...entry,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(wrapped, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'written', company, path }, null, 2));
  process.exit(0);
}

usage(1);
