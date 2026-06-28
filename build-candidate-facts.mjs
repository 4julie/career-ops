#!/usr/bin/env node

/**
 * build-candidate-facts.mjs
 *
 * Builds a compact, generated cache from user-layer career-ops files so batch
 * workers can triage roles without rereading the full CV, article digest, and
 * profile on every offer. The output is user data and must stay gitignored.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'data/cache/candidate-facts.json');
const args = new Set(process.argv.slice(2));
const QUIET = args.has('--quiet');
const CHECK = args.has('--check');

function readText(rel) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

function readYaml(rel) {
  const text = readText(rel);
  if (!text.trim()) return {};
  try {
    return yaml.load(text) || {};
  } catch (err) {
    return { _parse_error: err.message };
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function clean(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-*]\s*/, '')
    .trim();
}

function sectionHeadings(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,3}\s+(.+)/)?.[1])
    .filter(Boolean)
    .slice(0, 30);
}

function metricLines(markdown, limit = 45) {
  const metricLike = /(\$|%|\b\d+[kKmMbB+]?\b|AUM|revenue|pipeline|migration|database|client|enterprise|AI|LLM|product|solution|implementation|stakeholder|risk|training|enablement)/i;
  return markdown
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line.length >= 25 && line.length <= 240 && metricLike.test(line))
    .slice(0, limit);
}

function flattenTitles(archetypes = []) {
  const titles = [];
  for (const archetype of archetypes) {
    for (const title of asArray(archetype?.titles)) {
      if (!titles.includes(title)) titles.push(title);
    }
  }
  return titles;
}

function buildFacts() {
  const profile = readYaml('config/profile.yml');
  const profileMd = readText('modes/_profile.md');
  const cv = readText('cv.md');
  const digest = readText('article-digest.md');

  const target = profile.target_roles || {};
  const preferences = profile.preferences || {};
  const narrative = profile.narrative || {};

  return {
    generated_at: new Date().toISOString(),
    source_files: {
      profile_yml: existsSync(join(ROOT, 'config/profile.yml')),
      profile_md: existsSync(join(ROOT, 'modes/_profile.md')),
      cv_md: existsSync(join(ROOT, 'cv.md')),
      article_digest_md: existsSync(join(ROOT, 'article-digest.md')),
    },
    candidate: {
      name: profile.candidate?.full_name || null,
      location: profile.candidate?.location || profile.location?.city || null,
      country: profile.location?.country || null,
      timezone: profile.location?.timezone || null,
    },
    targets: {
      primary_roles: asArray(target.primary),
      archetypes: asArray(target.archetypes).map((a) => ({
        name: a?.name,
        zone: a?.zone,
        fit: a?.fit,
        enjoyment: a?.enjoyment,
        caveat: a?.caveat,
        titles: asArray(a?.titles),
      })),
      all_titles: flattenTitles(target.archetypes),
      filters: target.search_filters || {},
    },
    compensation: profile.compensation || {},
    location_policy: profile.location || {},
    narrative: {
      headline: narrative.headline || null,
      exit_story: narrative.exit_story || null,
      superpowers: asArray(narrative.superpowers),
      proof_points: asArray(narrative.proof_points).map((p) => ({
        name: p?.name,
        hero_metric: p?.hero_metric,
      })),
    },
    preferences: {
      avoid: asArray(preferences.work_style?.avoid),
      must_include: asArray(preferences.work_style?.must_include),
      role_fit_model: preferences.role_fit_model || {},
      capability_domains: asArray(preferences.capability_domains).map((d) => ({
        name: d?.name,
        strength: d?.strength,
        enjoy: d?.enjoy,
        note: d?.note,
      })),
    },
    evidence_index: {
      cv_headings: sectionHeadings(cv),
      cv_metric_lines: metricLines(cv, 35),
      digest_metric_lines: metricLines(digest, 45),
      profile_customization_headings: sectionHeadings(profileMd),
    },
  };
}

const facts = buildFacts();

if (CHECK) {
  if (!QUIET) console.log(JSON.stringify(facts, null, 2));
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(facts, null, 2)}\n`);

if (!QUIET) {
  console.log(`Wrote ${OUT}`);
  console.log(`Evidence lines: cv=${facts.evidence_index.cv_metric_lines.length}, digest=${facts.evidence_index.digest_metric_lines.length}`);
}
