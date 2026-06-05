// lib.test.mjs — unit tests for doc-sweep classification core (Tasks 1.1–1.3)
// Spec: docs/agent-process/doc-sweep.md §4.1 (allow-list/exclude) and §4.3 (classifier + claims)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, isSweepable, STALE_MS, classify, coveringClaimStatus } from './lib.mjs';

// ─── Task 1.1: isSweepable (§4.1) ─────────────────────────────────────────

test('isSweepable: allow-listed paths return true', () => {
  for (const p of [
    'docs/archon/ROADMAP.md',
    '.changelog/x.md',
    '.html-artifacts/r.html',
    'docs/assets/d.png',
  ])
    assert.equal(isSweepable(p), true, p);
});

test('isSweepable: carve-outs + hard-excludes (case-insensitive, exclude wins)', () => {
  for (const p of [
    // carve-outs: docs/process/** and docs/architecture/**
    'docs/process/r.md',
    'docs/architecture/adr.md',
    // governance files
    'README.md',
    'AGENTS.md',
    // agent/tool config
    '.claude/noticed.md',
    // code/CI
    'src/i.ts',
    '.github/workflows/ci.yml',
    // manifests
    'package.json',
    'packages/x/package-lock.json',
    // NTFS mixed-case bypass (H2) — must still exclude
    'Docs/Process/r.md',
    '.Claude/x.md',
    'SRC/i.ts',
  ])
    assert.equal(isSweepable(p), false, p);
});

test('norm: backslashes converted to forward slashes', () => {
  assert.equal(norm('docs\\archon\\ROADMAP.md'), 'docs/archon/ROADMAP.md');
  assert.equal(norm('./docs/x.md'), 'docs/x.md');
});

// ─── Task 1.2: classify (§4.3, D8/D10) ───────────────────────────────────────

const NOW = 1_700_000_000_000;
const fresh = NOW - 1000;                // well within 12h
const stale = NOW - STALE_MS - 1000;    // just past 12h

test('classify: primary-default — 12h freshness gate', () => {
  assert.equal(
    classify({ lane: 'primary-default', mtimeMs: fresh, now: NOW }).verdict,
    'leave-log',
    'fresh file on primary-default should leave-log',
  );
  assert.equal(
    classify({ lane: 'primary-default', mtimeMs: stale, now: NOW }).verdict,
    'eligible',
    'stale file on primary-default should be eligible',
  );
});

test('classify: worktree — positive death signal required (D8)', () => {
  // active claim → skip (live)
  assert.equal(
    classify({ lane: 'worktree', mtimeMs: stale, now: NOW, claimStatus: 'active' }).verdict,
    'skip',
    'active claim → skip',
  );
  // expired claim → eligible (positive death signal)
  assert.equal(
    classify({ lane: 'worktree', mtimeMs: stale, now: NOW, claimStatus: 'expired' }).verdict,
    'eligible',
    'expired claim → eligible',
  );
  // absent claim → leave-log (cannot prove dead)
  assert.equal(
    classify({ lane: 'worktree', mtimeMs: stale, now: NOW, claimStatus: 'absent' }).verdict,
    'leave-log',
    'absent claim → leave-log',
  );
  // even a fresh+expired worktree doc is eligible — mtime is NOT the gate (D8)
  assert.equal(
    classify({ lane: 'worktree', mtimeMs: fresh, now: NOW, claimStatus: 'expired' }).verdict,
    'eligible',
    'fresh+expired worktree → eligible (mtime not the gate)',
  );
});

test('classify: detached HEAD never eligible (C3)', () => {
  assert.equal(
    classify({ lane: 'detached', mtimeMs: stale, now: NOW }).verdict,
    'leave-log',
    'detached HEAD → leave-log always',
  );
});

// ─── Task 1.3: coveringClaimStatus (§4.3, fail-safe H3) ──────────────────────

// Helper: build a claim with defaults for the archon/agent/x worktree
const claim = (o) => ({
  repo: 'archon',
  worktree: 'agent/x',
  paths: ['docs/x/'],
  status: 'active',
  ...o,
});

// Common query context
const ctx = { repo: 'archon', worktree: 'agent/x', relPath: 'docs/x/y.md', now: NOW };

test('coveringClaimStatus: active claim returns active', () => {
  assert.equal(coveringClaimStatus([claim()], ctx), 'active');
});

test('coveringClaimStatus: past expiresAt makes active claim expired', () => {
  assert.equal(
    coveringClaimStatus(
      [claim({ status: 'active', expiresAt: new Date(NOW - 1).toISOString() })],
      ctx,
    ),
    'expired',
    'status=active but expiresAt in the past → expired',
  );
});

test('coveringClaimStatus: status=expired yields expired', () => {
  assert.equal(coveringClaimStatus([claim({ status: 'expired' })], ctx), 'expired');
});

test('coveringClaimStatus: empty claims list returns absent', () => {
  assert.equal(coveringClaimStatus([], ctx), 'absent');
});

test('coveringClaimStatus: non-matching repo returns absent', () => {
  assert.equal(
    coveringClaimStatus([claim({ repo: 'other' })], ctx),
    'absent',
    'claim for a different repo should not cover',
  );
});

test('coveringClaimStatus: ambiguous path-glob fails safe to active (H3)', () => {
  // A claim matching repo+worktree+active but with an unparseable paths array
  // (pathCovers throws) → treat as covering+active to block (fail-safe).
  // We simulate parse failure by making pathCovers throw via an unusual value.
  // The fail-safe in coveringClaimStatus catches and uses c.status === 'active'.
  assert.equal(
    coveringClaimStatus([claim({ paths: ['[bad-glob'] })], ctx),
    'active',
    'unparseable path-glob for active claim → fail safe = active',
  );
});

test('coveringClaimStatus: brace glob fails CLOSED, not open (over-block) [follow-up A]', () => {
  // {a,b} brace expansion is unsupported. The OLD code escaped the braces and matched
  // only the LITERAL "docs/{a,b}/..." — so a claim meant to cover docs/a/** and docs/b/**
  // would silently fail to cover, blocking nothing (fail OPEN → could clobber a live agent).
  // The fix: an unsupported brace glob throws → the coveringClaimStatus fail-safe (H3) treats
  // an active claim as covering → 'active' (block). ctx.relPath = 'docs/x/y.md' deliberately
  // does NOT literal-match the brace pattern, proving the verdict comes from the fail-safe.
  // Source: spec §4.3 fail-safe + "brace-glob fail-closed" hardening follow-up.
  const braceClaim = claim({ paths: ['docs/{a,b}/'] }); // status defaults to 'active'
  assert.equal(
    coveringClaimStatus([braceClaim], ctx),
    'active',
    'active claim with a brace glob must fail closed to active (block)',
  );
});

// ─── Gap 1: coveringClaimStatus via branch alias (D3b) ───────────────────────

test('coveringClaimStatus: branch alias accepted in place of worktree field', () => {
  // Claim omits worktree, sets branch equal to the doc ctx worktree — must match.
  const claimViaBranch = {
    repo: 'archon',
    // no worktree field
    branch: 'agent/x',
    paths: ['docs/x/'],
    status: 'active',
  };
  assert.equal(
    coveringClaimStatus([claimViaBranch], ctx),
    'active',
    'branch field matching ctx.worktree → active',
  );
});

// ─── Gap 2: coveringClaimStatus wrong worktree → absent ──────────────────────

test('coveringClaimStatus: right repo but wrong worktree/branch returns absent', () => {
  // Claim repo matches but neither worktree nor branch matches ctx.worktree.
  const wrongWorktree = claim({ worktree: 'agent/other', branch: undefined });
  assert.equal(
    coveringClaimStatus([wrongWorktree], ctx),
    'absent',
    'wrong worktree with right repo → absent',
  );
});

// ─── Gap 3: isSweepable hard-excludes with zero coverage ─────────────────────

test('isSweepable: hard-excluded governance/tool-config/script paths always false', () => {
  for (const p of [
    'CLAUDE.md',
    'GEMINI.md',
    'scripts/build.mjs',
    '.githooks/pre-commit',
    '.codex/x.md',
    '.gemini/x.md',
    '.agent/schema/x.json',
  ])
    assert.equal(isSweepable(p), false, p);
});

// ─── I4: Docusaurus source/config under docs/ → false; .md/.mdx still true ───

test('isSweepable: Docusaurus config/source files inside docs/ → false (I4)', () => {
  for (const p of [
    'docs/docusaurus.config.ts',
    'docs/sidebars.ts',
    'docs/src/components/kbd.tsx',
    'docs/babel.config.js',
    'docs/data.json',
    'docs/src/pages/index.jsx',
    'docs/static/img/logo.ts', // .ts extension → excluded by extension rule
  ])
    assert.equal(isSweepable(p), false, `expected false for ${p}`);
});

test('isSweepable: .md and .mdx under docs/ remain sweepable (I4 must not block them)', () => {
  for (const p of [
    'docs/guide.md',
    'docs/guide.mdx',
    'docs/archon/ROADMAP.md',
    'docs/blog/2026-01-01.mdx',
  ])
    assert.equal(isSweepable(p), true, `expected true for ${p}`);
});

// ─── Gap 4: isSweepable image extensions → true ──────────────────────────────

test('isSweepable: image extensions return true regardless of directory', () => {
  for (const p of [
    // inside docs/ — hits both the docs/ allow-list and the image-extension rule
    'docs/assets/a.jpg',
    'docs/assets/a.jpeg',
    'docs/assets/a.gif',
    'docs/assets/a.webp',
    'docs/assets/a.svg',
    // outside docs/ — exercises the image-extension allow-list path independently
    'assets/banner.svg',
    'logo.gif',
  ])
    assert.equal(isSweepable(p), true, p);
});
