import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

import {
  assertPathCopiesMatch,
  buildPathManifest,
  cleanupVerifiedCarry,
  copyCarryPathsAndVerify,
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

test('buildPathManifest records portable permission modes', () => {
  withTempRoots(({ checkoutRoot }) => {
    const directoryPath = path.join(checkoutRoot, 'owner');
    const filePath = path.join(directoryPath, 'script.sh');
    fs.mkdirSync(directoryPath);
    fs.writeFileSync(filePath, '#!/bin/sh\n');

    const manifest = buildPathManifest(directoryPath);
    const directoryEntry = manifest.find((entry) => entry.path === '.');
    const fileEntry = manifest.find((entry) => entry.path === 'script.sh');

    assert.equal(directoryEntry.mode, fs.lstatSync(directoryPath).mode & 0o7777);
    assert.equal(fileEntry.mode, fs.lstatSync(filePath).mode & 0o7777);
  });
});

test('buildPathManifest records a symlink permission mode when symlinks are available', (context) => {
  withTempRoots(({ checkoutRoot }) => {
    const targetPath = path.join(checkoutRoot, 'target.txt');
    const linkPath = path.join(checkoutRoot, 'target-link');
    fs.writeFileSync(targetPath, 'target\n');
    try {
      fs.symlinkSync(targetPath, linkPath, 'file');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        context.skip(`symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const [entry] = buildPathManifest(linkPath);
    assert.equal(entry.type, 'symlink');
    assert.equal(entry.mode, fs.lstatSync(linkPath).mode & 0o7777);
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

    const receipt = copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['deleted.txt'],
    });

    assert.equal(fs.existsSync(path.join(worktreePath, 'deleted.txt')), false);
    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths: ['deleted.txt'], receipt });
    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'deleted.txt'), 'utf8'), 'baseline\n');
  });
});

test('copyCarryPathsAndVerify carries both sides of a staged rename and restores the source checkout', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, 'old-name.txt'), 'renamed\n');
    git(checkoutRoot, ['add', 'old-name.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.writeFileSync(path.join(worktreePath, 'old-name.txt'), 'renamed\n');
    fs.renameSync(
      path.join(checkoutRoot, 'old-name.txt'),
      path.join(checkoutRoot, 'new-name.txt'),
    );
    git(checkoutRoot, ['add', '--all']);

    const carryPaths = ['old-name.txt', 'new-name.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    assert.equal(fs.existsSync(path.join(worktreePath, 'old-name.txt')), false);
    assert.equal(fs.readFileSync(path.join(worktreePath, 'new-name.txt'), 'utf8'), 'renamed\n');

    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt });
    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'old-name.txt'), 'utf8'), 'renamed\n');
    assert.equal(fs.existsSync(path.join(checkoutRoot, 'new-name.txt')), false);
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

test('cleanupVerifiedCarry preserves a destination chmod made after copy verification', () => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, 'owner.sh'), '#!/bin/sh\necho baseline\n');
    git(checkoutRoot, ['add', 'owner.sh']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    const sourcePath = path.join(checkoutRoot, 'owner.sh');
    const destinationPath = path.join(worktreePath, 'owner.sh');
    fs.writeFileSync(sourcePath, '#!/bin/sh\necho carried\n');
    fs.chmodSync(sourcePath, 0o666);
    const receipt = copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.sh'],
    });
    const sourceMode = fs.lstatSync(sourcePath).mode & 0o7777;
    const originalMode = fs.lstatSync(destinationPath).mode & 0o7777;
    const changedMode = process.platform === 'win32'
      ? originalMode & ~0o222
      : originalMode ^ 0o100;
    assert.notEqual(changedMode, originalMode);
    fs.chmodSync(destinationPath, changedMode);
    assert.equal(fs.lstatSync(destinationPath).mode & 0o7777, changedMode);

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.sh'],
      receipt,
    }), /changed after carry verification: owner\.sh \(destination worktree\)/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), '#!/bin/sh\necho carried\n');
    assert.equal(fs.lstatSync(sourcePath).mode & 0o7777, sourceMode);
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), '#!/bin/sh\necho carried\n');
    assert.equal(fs.lstatSync(destinationPath).mode & 0o7777, changedMode);
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.checkout-carry-cleanup-')),
      false,
    );
    fs.chmodSync(destinationPath, originalMode);
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

    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt });

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

test('cleanupVerifiedCarry preserves a file changed after copy verification', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, 'owner.txt'), 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.writeFileSync(path.join(checkoutRoot, 'owner.txt'), 'carried\n');
    const receipt = copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.txt'],
    });
    fs.writeFileSync(path.join(checkoutRoot, 'owner.txt'), 'late owner edit\n');

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.txt'],
      receipt,
    }), /changed after carry verification/i);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'owner.txt'), 'utf8'), 'late owner edit\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner.txt'), 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry preserves a deletion path recreated after absence verification', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, 'deleted.txt'), 'baseline\n');
    git(checkoutRoot, ['add', 'deleted.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.rmSync(path.join(checkoutRoot, 'deleted.txt'));
    const receipt = copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['deleted.txt'],
    });
    fs.writeFileSync(path.join(checkoutRoot, 'deleted.txt'), 'late recreation\n');

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths: ['deleted.txt'],
      receipt,
    }), /changed after carry verification/i);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'deleted.txt'), 'utf8'), 'late recreation\n');
    assert.equal(fs.existsSync(path.join(worktreePath, 'deleted.txt')), false);
  });
});

test('cleanupVerifiedCarry validates every path before cleaning any source', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, 'first.txt'), 'first baseline\n');
    fs.writeFileSync(path.join(checkoutRoot, 'second.txt'), 'second baseline\n');
    git(checkoutRoot, ['add', 'first.txt', 'second.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.writeFileSync(path.join(checkoutRoot, 'first.txt'), 'first carried\n');
    fs.writeFileSync(path.join(checkoutRoot, 'second.txt'), 'second carried\n');
    const carryPaths = ['first.txt', 'second.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    fs.writeFileSync(path.join(checkoutRoot, 'second.txt'), 'second late edit\n');

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths,
      receipt,
    }), /changed after carry verification/i);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'first.txt'), 'utf8'), 'first carried\n');
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'second.txt'), 'utf8'), 'second late edit\n');
  });
});

test('copyCarryPathsAndVerify rejects staged bytes not represented by the worktree', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'staged-only task input\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    fs.writeFileSync(sourcePath, 'baseline\n');

    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.txt'],
    }), /Git index and worktree states differ/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'baseline\n');
    assert.equal(git(checkoutRoot, ['show', ':owner.txt']), 'staged-only task input');
    assert.equal(fs.existsSync(path.join(worktreePath, 'owner.txt')), false);
  });
});

test('cleanupVerifiedCarry rejects a Git index changed after receipt creation', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'carried\n');
    const carryPaths = ['owner.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    git(checkoutRoot, ['add', 'owner.txt']);

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths,
      receipt,
    }), /Git index changed after carry verification/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'carried\n');
    assert.equal(git(checkoutRoot, ['show', ':owner.txt']), 'carried');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner.txt'), 'utf8'), 'carried\n');
  });
});

test('copyCarryPathsAndVerify rejects a staged deletion recreated in the worktree', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.rmSync(sourcePath);
    git(checkoutRoot, ['add', 'owner.txt']);
    fs.writeFileSync(sourcePath, 'recreated worktree version\n');

    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.txt'],
    }), /Git index and worktree states differ/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'recreated worktree version\n');
    assert.equal(git(checkoutRoot, ['ls-files', '--stage', '--', 'owner.txt']), '');
    assert.equal(fs.existsSync(path.join(worktreePath, 'owner.txt')), false);
  });
});

test('carry receipts normalize path spelling and ordering while rejecting overlapping roots', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    fs.writeFileSync(path.join(checkoutRoot, 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(checkoutRoot, 'b.txt'), 'b\n');
    fs.mkdirSync(path.join(checkoutRoot, 'nested'));
    fs.writeFileSync(path.join(checkoutRoot, 'nested', 'child.txt'), 'child\n');

    const receipt = copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['b.txt', '.\\a.txt'],
    });
    assert.deepEqual(receipt.entries.map((entry) => entry.path), ['a.txt', 'b.txt']);

    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['nested', 'nested/child.txt'],
    }), /may not overlap/i);
  });
});

test('copyCarryPathsAndVerify rejects identical and nested roots before touching source bytes', () => {
  withTempRoots(({ checkoutRoot }) => {
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    fs.writeFileSync(sourcePath, 'owner bytes\n');

    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath: checkoutRoot,
      carryPaths: ['owner.txt'],
    }), /distinct, non-nested directories/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'owner bytes\n');

    const nestedWorktree = path.join(checkoutRoot, 'nested-worktree');
    fs.mkdirSync(nestedWorktree);
    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath: nestedWorktree,
      carryPaths: ['owner.txt'],
    }), /distinct, non-nested directories/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'owner bytes\n');
  });
});

test('carry rejects portable case aliases and .git metadata aliases before copying', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    fs.writeFileSync(path.join(checkoutRoot, 'owner.txt'), 'owner\n');
    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['owner.txt', 'OWNER.txt'],
    }), /duplicate or case-aliased/i);
    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['.Git/config'],
    }), /may not include \.git metadata/i);
    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['Owner', 'owner/child.txt'],
    }), /may not overlap/i);
    assert.equal(fs.existsSync(path.join(worktreePath, 'owner.txt')), false);
  });
});

test('carry rejects portable Unicode-normalization aliases before copying', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    fs.writeFileSync(path.join(checkoutRoot, 'Caf\u00e9.txt'), 'owner\n');
    fs.mkdirSync(path.join(checkoutRoot, 'Caf\u00e9'));

    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['Caf\u00e9.txt', 'Cafe\u0301.txt'],
    }), /duplicate or case-aliased/i);
    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['Caf\u00e9', 'Cafe\u0301/child.txt'],
    }), /may not overlap/i);
    assert.equal(fs.existsSync(path.join(worktreePath, 'Caf\u00e9.txt')), false);
  });
});

test('carry rejects a symlink or reparse-point ancestor', (context) => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const outsidePath = path.join(root, 'outside');
    fs.mkdirSync(outsidePath);
    fs.writeFileSync(path.join(outsidePath, 'owner.txt'), 'outside\n');
    try {
      fs.symlinkSync(outsidePath, path.join(checkoutRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        context.skip(`symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(() => copyCarryPathsAndVerify({
      checkoutRoot,
      worktreePath,
      carryPaths: ['linked/owner.txt'],
    }), /traverses a symlink or reparse point/i);
    assert.equal(fs.existsSync(path.join(worktreePath, 'linked', 'owner.txt')), false);
    assert.equal(fs.readFileSync(path.join(outsidePath, 'owner.txt'), 'utf8'), 'outside\n');
  });
});

test('cleanupVerifiedCarry rejects a changed directory child without cleaning the source tree', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.mkdirSync(path.join(checkoutRoot, 'owner'));
    fs.writeFileSync(path.join(checkoutRoot, 'owner', 'note.txt'), 'baseline\n');
    git(checkoutRoot, ['add', 'owner/note.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);

    fs.writeFileSync(path.join(checkoutRoot, 'owner', 'note.txt'), 'carried\n');
    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    fs.writeFileSync(path.join(checkoutRoot, 'owner', 'note.txt'), 'late child edit\n');

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths,
      receipt,
    }), /changed after carry verification/i);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'owner', 'note.txt'), 'utf8'), 'late child edit\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner', 'note.txt'), 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry rolls an in-flight promoted-source edit back without losing bytes', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    const destinationPath = path.join(worktreePath, 'owner.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'carried\n');
    const carryPaths = ['owner.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realRenameSync = fs.renameSync;
    let injected = false;
    fs.renameSync = (fromPath, toPath) => {
      realRenameSync(fromPath, toPath);
      if (!injected && path.resolve(fromPath) === sourcePath && path.resolve(toPath) === destinationPath) {
        injected = true;
        fs.writeFileSync(destinationPath, 'in-flight owner edit\n');
      }
    };
    try {
      assert.throws(() => cleanupVerifiedCarry({
        checkoutRoot,
        worktreePath,
        carryPaths,
        receipt,
      }), /transferred source/i);
    } finally {
      fs.renameSync = realRenameSync;
    }

    assert.equal(injected, true);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'in-flight owner edit\n');
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry preserves every recovery location when rollback collides', () => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    const destinationPath = path.join(worktreePath, 'owner.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'carried\n');
    const carryPaths = ['owner.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realRenameSync = fs.renameSync;
    let injected = false;
    fs.renameSync = (fromPath, toPath) => {
      realRenameSync(fromPath, toPath);
      if (!injected && path.resolve(fromPath) === sourcePath && path.resolve(toPath) === destinationPath) {
        injected = true;
        fs.writeFileSync(destinationPath, 'in-flight owner edit\n');
        fs.writeFileSync(sourcePath, 'late source recreation\n');
      }
    };
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({
        checkoutRoot,
        worktreePath,
        carryPaths,
        receipt,
      }));
    } finally {
      fs.renameSync = realRenameSync;
    }
    assert.match(failure.message, /manual recovery is required/i);

    const transactionRoots = fs.readdirSync(root)
      .filter((name) => name.startsWith('.checkout-carry-cleanup-'));
    assert.equal(transactionRoots.length, 1, failure?.message);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'late source recreation\n');
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'in-flight owner edit\n');
    assert.equal(
      fs.readFileSync(path.join(root, transactionRoots[0], 'owner.txt'), 'utf8'),
      'carried\n',
    );
  });
});

test('cleanupVerifiedCarry never overwrites a source path recreated immediately before baseline restore', () => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    const destinationPath = path.join(worktreePath, 'owner.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'carried\n');
    const carryPaths = ['owner.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realExecFileSync = childProcess.execFileSync;
    let injected = false;
    childProcess.execFileSync = (command, args = [], options = {}) => {
      if (!injected && command === 'git' && args.includes('restore') && args.includes('--staged')) {
        injected = true;
        fs.writeFileSync(sourcePath, 'late source recreation\n');
      }
      return realExecFileSync(command, args, options);
    };
    syncBuiltinESMExports();
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({
        checkoutRoot,
        worktreePath,
        carryPaths,
        receipt,
      }));
    } finally {
      childProcess.execFileSync = realExecFileSync;
      syncBuiltinESMExports();
    }

    assert.equal(injected, true);
    assert.match(failure.message, /already exists|checkout-index/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'late source recreation\n');
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'carried\n');
    const transactionRoots = fs.readdirSync(root)
      .filter((name) => name.startsWith('.checkout-carry-cleanup-'));
    assert.equal(transactionRoots.length, 1);
    assert.equal(
      fs.readFileSync(path.join(root, transactionRoots[0], 'owner.txt'), 'utf8'),
      'carried\n',
    );
  });
});

test('cleanupVerifiedCarry never restores tracked leaves through a recreated directory junction', (context) => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const outsidePath = path.join(root, 'outside');
    const probePath = path.join(root, 'symlink-probe');
    fs.mkdirSync(outsidePath);
    try {
      fs.symlinkSync(outsidePath, probePath, process.platform === 'win32' ? 'junction' : 'dir');
      fs.unlinkSync(probePath);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        context.skip(`symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceRoot = path.join(checkoutRoot, 'owner');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, 'tracked.txt'), 'baseline\n');
    git(checkoutRoot, ['add', 'owner/tracked.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(path.join(sourceRoot, 'tracked.txt'), 'carried\n');
    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realExecFileSync = childProcess.execFileSync;
    let injected = false;
    childProcess.execFileSync = (command, args = [], options = {}) => {
      if (!injected && command === 'git' && args.includes('restore') && args.includes('--staged')) {
        injected = true;
        fs.symlinkSync(outsidePath, sourceRoot, process.platform === 'win32' ? 'junction' : 'dir');
      }
      return realExecFileSync(command, args, options);
    };
    syncBuiltinESMExports();
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({
        checkoutRoot,
        worktreePath,
        carryPaths,
        receipt,
      }));
    } finally {
      childProcess.execFileSync = realExecFileSync;
      syncBuiltinESMExports();
    }

    assert.equal(injected, true);
    assert.match(failure.message, /traverses a symlink or reparse point/i);
    assert.equal(fs.existsSync(path.join(outsidePath, 'tracked.txt')), false);
    assert.equal(fs.lstatSync(sourceRoot).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner', 'tracked.txt'), 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry never rolls a nested path back through a recreated junction', (context) => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const outsidePath = path.join(root, 'outside');
    const probePath = path.join(root, 'symlink-probe');
    fs.mkdirSync(outsidePath);
    try {
      fs.symlinkSync(outsidePath, probePath, process.platform === 'win32' ? 'junction' : 'dir');
      fs.unlinkSync(probePath);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        context.skip(`symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceParent = path.join(checkoutRoot, 'owner');
    const sourcePath = path.join(sourceParent, 'tracked.txt');
    const destinationPath = path.join(worktreePath, 'owner', 'tracked.txt');
    fs.mkdirSync(sourceParent);
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner/tracked.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'carried\n');
    const carryPaths = ['owner/tracked.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realRenameSync = fs.renameSync;
    let injected = false;
    fs.renameSync = (fromPath, toPath) => {
      realRenameSync(fromPath, toPath);
      if (!injected && path.resolve(fromPath) === sourcePath && path.resolve(toPath) === destinationPath) {
        injected = true;
        fs.writeFileSync(destinationPath, 'in-flight owner edit\n');
        fs.rmSync(sourceParent, { recursive: true });
        fs.symlinkSync(outsidePath, sourceParent, process.platform === 'win32' ? 'junction' : 'dir');
      }
    };
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({
        checkoutRoot,
        worktreePath,
        carryPaths,
        receipt,
      }));
    } finally {
      fs.renameSync = realRenameSync;
    }

    assert.equal(injected, true);
    assert.match(failure.message, /manual recovery is required/i);
    assert.equal(fs.existsSync(path.join(outsidePath, 'tracked.txt')), false);
    assert.equal(fs.lstatSync(sourceParent).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'in-flight owner edit\n');
    const transactionRoots = fs.readdirSync(root)
      .filter((name) => name.startsWith('.checkout-carry-cleanup-'));
    assert.equal(transactionRoots.length, 1);
    assert.equal(
      fs.readFileSync(path.join(root, transactionRoots[0], 'owner', 'tracked.txt'), 'utf8'),
      'carried\n',
    );
  });
});

test('cleanupVerifiedCarry treats carry-derived names as literal Git paths', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const carriedPath = path.join(checkoutRoot, 'owner[1].txt');
    const unrelatedPath = path.join(checkoutRoot, 'owner1.txt');
    fs.writeFileSync(carriedPath, 'baseline carried\n');
    fs.writeFileSync(unrelatedPath, 'baseline unrelated\n');
    git(checkoutRoot, ['--literal-pathspecs', 'add', 'owner[1].txt', 'owner1.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(carriedPath, 'carried\n');
    const carryPaths = ['owner[1].txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    fs.writeFileSync(unrelatedPath, 'late unrelated edit\n');
    git(checkoutRoot, ['--literal-pathspecs', 'add', 'owner1.txt']);

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths,
      receipt,
    }), /checkout remains dirty/i);
    assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), 'late unrelated edit\n');
    assert.equal(git(checkoutRoot, ['diff', '--cached', '--name-only']), 'owner1.txt');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner[1].txt'), 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry detects an ignored path recreated during cleanup', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(checkoutRoot, '.gitignore'), 'ignored.txt\n');
    git(checkoutRoot, ['add', '.gitignore']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    const sourcePath = path.join(checkoutRoot, 'ignored.txt');
    fs.writeFileSync(sourcePath, 'carried ignored bytes\n');
    const carryPaths = ['ignored.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realExecFileSync = childProcess.execFileSync;
    let injected = false;
    childProcess.execFileSync = (command, args = [], options = {}) => {
      if (!injected && command === 'git' && args[0] === 'status' && args.includes('--untracked-files=all')) {
        injected = true;
        fs.writeFileSync(sourcePath, 'late ignored recreation\n');
      }
      return realExecFileSync(command, args, options);
    };
    syncBuiltinESMExports();
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({
        checkoutRoot,
        worktreePath,
        carryPaths,
        receipt,
      }));
    } finally {
      childProcess.execFileSync = realExecFileSync;
      syncBuiltinESMExports();
    }

    assert.equal(injected, true);
    assert.match(failure.message, /ignored carry paths reappeared/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'late ignored recreation\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'ignored.txt'), 'utf8'), 'carried ignored bytes\n');
  });
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function captureThrown(run) {
  let failure;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'Expected function to throw.');
  return failure;
}
