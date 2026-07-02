import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Parity guard (#138, the RT-A slice of github-workflows#81): the vendored
// validator must stay byte-identical (LF-normalized, so core.autocrlf checkouts
// hash the same) to the canonical copy in ArchonVII/github-workflows. A hand
// edit here silently forks local preflight rules from CI rules — the root
// cause of the multi-round PR-format failure loops. Refresh = copy the file
// from upstream + update scripts/pr-contract.vendor.json in one commit.
const vendorManifestPath = fileURLToPath(new URL('../scripts/pr-contract.vendor.json', import.meta.url));
const vendoredPath = fileURLToPath(new URL('../scripts/pr-contract.mjs', import.meta.url));

test('vendored pr-contract.mjs matches its vendor manifest hash', () => {
  const manifest = JSON.parse(readFileSync(vendorManifestPath, 'utf8'));
  const normalized = readFileSync(vendoredPath, 'utf8').replace(/\r\n/g, '\n');
  const actual = createHash('sha256').update(normalized).digest('hex');
  assert.equal(
    actual,
    manifest.sha256LfNormalized,
    `scripts/pr-contract.mjs (${actual}) does not match scripts/pr-contract.vendor.json `
      + `(${manifest.sha256LfNormalized}). Do not hand-edit the vendored validator — `
      + `fix it in ${manifest.upstreamRepo} first, then re-vendor and update the manifest together.`,
  );
});

test('vendor manifest names the canonical upstream', () => {
  const manifest = JSON.parse(readFileSync(vendorManifestPath, 'utf8'));
  assert.equal(manifest.upstreamRepo, 'ArchonVII/github-workflows');
  assert.equal(manifest.upstreamPath, 'scripts/pr-contract.mjs');
  assert.match(manifest.sha256LfNormalized, /^[0-9a-f]{64}$/);
});
