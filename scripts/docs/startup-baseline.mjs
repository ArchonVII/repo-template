// Generate repo-template's startup contract from its doc floor plus a pinned
// projection of archon-setup's capability manifest (repo-template#159).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGeneratorArgs, readDocMap } from './lib.mjs';

export const CAPABILITY_SNAPSHOT_PATH = join('.agent', 'archon-capabilities.json');
export const STARTUP_BASELINE_PATH = join('.agent', 'startup-baseline.json');
export const LEGACY_STARTUP_PATHS = ['docs/superpowers/plans/'];
const VERSION_BASE = '2026-07-15-c3-generated';

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
}

export function validateCapabilitySnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1) throw new Error('capability snapshot schemaVersion must be 1');
  assertString(snapshot.source?.repository, 'capability snapshot source.repository');
  if (!/^[0-9a-f]{40}$/.test(snapshot.source?.commit || '')) {
    throw new Error('capability snapshot source.commit must be a full git SHA');
  }
  assertString(snapshot.source?.featuresPath, 'capability snapshot source.featuresPath');
  assertString(snapshot.source?.profilesPath, 'capability snapshot source.profilesPath');
  assertString(snapshot.effectiveProfile, 'capability snapshot effectiveProfile');
  if (snapshot.profile?.id !== snapshot.effectiveProfile || !Array.isArray(snapshot.profile?.features)) {
    throw new Error('capability snapshot profile must match effectiveProfile and declare features[]');
  }
  if (!Array.isArray(snapshot.features)) throw new Error('capability snapshot features must be an array');

  const selected = new Set(snapshot.profile.features);
  if (selected.size !== snapshot.profile.features.length) throw new Error('capability snapshot profile features must be unique');
  const projected = new Map();
  for (const feature of snapshot.features) {
    assertString(feature?.id, 'capability feature id');
    if (projected.has(feature.id)) throw new Error(`duplicate capability feature: ${feature.id}`);
    if (!Array.isArray(feature.installs)) throw new Error(`capability feature ${feature.id} installs must be an array`);
    for (const install of feature.installs) {
      assertString(install?.path, `capability feature ${feature.id} install path`);
      if (install.contract !== 'required') {
        throw new Error(`capability projection must contain required installs only (${feature.id}: ${install.path})`);
      }
    }
    projected.set(feature.id, feature);
  }
  for (const id of selected) {
    if (!projected.has(id)) throw new Error(`capability snapshot is missing selected feature: ${id}`);
  }
  for (const id of projected.keys()) {
    if (!selected.has(id)) throw new Error(`capability snapshot contains unselected feature: ${id}`);
  }
  return snapshot;
}

export function readCapabilitySnapshot(root) {
  const path = join(root, CAPABILITY_SNAPSHOT_PATH);
  return validateCapabilitySnapshot(JSON.parse(readFileSync(path, 'utf8')));
}

export function deriveExpectedDirectories(required) {
  const directories = new Set();
  for (const path of required) {
    const parts = path.split('/');
    if (parts.length >= 3 && (parts[0] === 'docs' || parts[0] === 'scripts')) {
      directories.add(`${parts[0]}/${parts[1]}/`);
    }
  }
  return [...directories].sort();
}

export function generateStartupBaseline({ docMap, capabilities }) {
  validateCapabilitySnapshot(capabilities);
  const selected = new Set(capabilities.profile.features);
  const required = new Set(docMap.required?.base || []);
  for (const feature of capabilities.features) {
    if (!selected.has(feature.id)) continue;
    for (const install of feature.installs) required.add(install.path);
  }
  const requiredPaths = [...required].sort();
  const expectedDirectories = deriveExpectedDirectories(requiredPaths);
  const legacy = [...LEGACY_STARTUP_PATHS];
  const digest = createHash('sha256')
    .update(JSON.stringify({ required: requiredPaths, expectedDirectories, legacy }))
    .digest('hex')
    .slice(0, 12);
  return {
    version: `${VERSION_BASE}+${digest}`,
    required: requiredPaths,
    expectedDirectories,
    legacy,
  };
}

export function serializeStartupBaseline(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

export function runStartupBaseline({ root, check = false }) {
  const path = join(root, STARTUP_BASELINE_PATH);
  const before = readFileSync(path, 'utf8');
  const generated = serializeStartupBaseline(generateStartupBaseline({
    docMap: readDocMap(root),
    capabilities: readCapabilitySnapshot(root),
  }));
  const changed = before.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n');
  if (changed && !check) writeFileSync(path, generated, 'utf8');
  return { changed };
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const args = parseGeneratorArgs(process.argv.slice(2));
  const result = runStartupBaseline(args);
  if (args.check && result.changed) {
    console.error('.agent/startup-baseline.json is stale — run: npm run docs:baseline');
    process.exitCode = 1;
  } else if (args.check) {
    console.log('docs:baseline --check passed — startup baseline current.');
  } else {
    console.log(`${result.changed ? 'regenerated' : 'current'}  .agent/startup-baseline.json`);
  }
}
