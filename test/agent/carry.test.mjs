import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  assertPathCopiesMatch,
  buildPathManifest,
  cleanupVerifiedCarry,
  copyCarryPathsAndVerify,
  removeCarrySources,
} from '../../scripts/agent/carry.mjs';

function withTempRoots(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-template-carry-'));
  const checkoutRoot = path.join(root, 'checkout');
  const worktreePath = path.join(root, 'worktree');
  fs.mkdirSync(checkoutRoot);
  fs.mkdirSync(worktreePath);
  try {
    return run({ root, checkoutRoot, worktreePath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('copyCarryPathsAndVerify copies multiple files and a directory with spaces exactly', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    fs.mkdirSync(path.join(checkoutRoot, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(checkoutRoot, '.claude', 'napkin.md'), 'napkin\n');
    fs.writeFileSync(path.join(checkoutRoot, '.claude', 'noticed.md'), 'noticed\n');
    fs.mkdirSync(path.join(checkoutRoot, 'docs', 'CI log download'), { recursive: true });
    fs.writeFileSync(path.join(checkoutRoot, 'docs', 'CI log download', '0_check.txt'), 'check\n');

    copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['.claude/napkin.md', '.claude/noticed.md', 'docs/CI log download'],
    });

    for (const carryPath of ['.claude/napkin.md', '.claude/noticed.md', 'docs/CI log download']) {
      assert.deepEqual(
        buildPathManifest(path.join(worktreePath, carryPath)),
        buildPathManifest(path.join(checkoutRoot, carryPath)),
      );
    }
  });
});

test('copyCarryPathsAndVerify carries a tracked deletion into the worktree', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, 'deleted.txt'), 'baseline\n');
    git(checkoutRoot, ['add', 'deleted.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.writeFileSync(path.join(worktreePath, 'deleted.txt'), 'baseline\n');
    fs.rmSync(path.join(checkoutRoot, 'deleted.txt'));

    copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['deleted.txt'],
    });

    assert.equal(fs.existsSync(path.join(worktreePath, 'deleted.txt')), false);
    cleanupVerifiedCarry({ checkoutRoot, carryPaths: ['deleted.txt'] });
    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'deleted.txt'), 'utf8'), 'baseline\n');
  });
});

test('removeCarrySources removes only the explicit verified roots', () => {
  withTempRoots(({ checkoutRoot }) => {
    fs.mkdirSync(path.join(checkoutRoot, 'inputs'), { recursive: true });
    fs.writeFileSync(path.join(checkoutRoot, 'inputs', 'carried.txt'), 'carry\n');
    fs.writeFileSync(path.join(checkoutRoot, 'keep.txt'), 'keep\n');

    removeCarrySources({ checkoutRoot, carryPaths: ['inputs'] });

    assert.equal(fs.existsSync(path.join(checkoutRoot, 'inputs')), false);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'keep.txt'), 'utf8'), 'keep\n');
  });
});

test('copy verification detects an altered destination while leaving the source intact', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    fs.writeFileSync(path.join(checkoutRoot, 'input.txt'), 'source\n');
    copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['input.txt'],
    });
    fs.writeFileSync(path.join(worktreePath, 'input.txt'), 'corrupt\n');
    assert.throws(() => assertPathCopiesMatch(
      path.join(checkoutRoot, 'input.txt'),
      path.join(worktreePath, 'input.txt'),
    ), /verification failed/i);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'input.txt'), 'utf8'), 'source\n');
  });
});

test('cleanupVerifiedCarry restores tracked content and removes carried untracked and ignored files', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(checkoutRoot, 'tracked.txt'), 'baseline\n');
    git(checkoutRoot, ['add', '.gitignore', 'tracked.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.writeFileSync(path.join(checkoutRoot, 'tracked.txt'), 'modified\n');
    fs.writeFileSync(path.join(checkoutRoot, 'untracked.txt'), 'untracked\n');
    fs.writeFileSync(path.join(checkoutRoot, 'ignored.txt'), 'ignored\n');
    fs.writeFileSync(path.join(checkoutRoot, 'staged-new.txt'), 'staged\n');
    git(checkoutRoot, ['add', 'staged-new.txt']);
    const carryPaths = ['tracked.txt', 'untracked.txt', 'ignored.txt', 'staged-new.txt'];

    copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    cleanupVerifiedCarry({ checkoutRoot, carryPaths });

    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'tracked.txt'), 'utf8'), 'baseline\n');
    assert.equal(fs.existsSync(path.join(checkoutRoot, 'untracked.txt')), false);
    assert.equal(fs.existsSync(path.join(checkoutRoot, 'ignored.txt')), false);
    assert.equal(fs.existsSync(path.join(checkoutRoot, 'staged-new.txt')), false);
    assert.equal(fs.readFileSync(path.join(worktreePath, 'tracked.txt'), 'utf8'), 'modified\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'untracked.txt'), 'utf8'), 'untracked\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'ignored.txt'), 'utf8'), 'ignored\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'staged-new.txt'), 'utf8'), 'staged\n');
  });
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
