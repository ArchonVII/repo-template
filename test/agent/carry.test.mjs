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

test('copyCarryPathsAndVerify restores every captured directory mode before receipt verification', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    const sourcePath = path.join(checkoutRoot, 'owner');
    const destinationPath = path.join(worktreePath, 'owner');
    fs.mkdirSync(path.join(sourcePath, 'private'), { recursive: true });
    fs.writeFileSync(path.join(sourcePath, 'private', 'note.txt'), 'owner\n');
    fs.mkdirSync(destinationPath);
    fs.writeFileSync(path.join(destinationPath, 'stale.txt'), 'stale\n');
    if (process.platform !== 'win32') {
      fs.chmodSync(sourcePath, 0o700);
      fs.chmodSync(path.join(sourcePath, 'private'), 0o750);
    }

    const directoryEntries = buildPathManifest(sourcePath)
      .filter((entry) => entry.type === 'directory');
    if (process.platform !== 'win32') {
      assert.equal(directoryEntries.find((entry) => entry.path === '.').mode, 0o700);
      assert.equal(directoryEntries.find((entry) => entry.path === 'private').mode, 0o750);
    }
    const forcedModes = new Map();
    const chmodCalls = [];
    const realCpSync = fs.cpSync;
    const realLstatSync = fs.lstatSync;
    const realChmodSync = fs.chmodSync;
    const realOpenSync = fs.openSync;
    const realFchmodSync = fs.fchmodSync;
    const descriptorPaths = new Map();

    fs.cpSync = (fromPath, toPath, options) => {
      realCpSync(fromPath, toPath, options);
      for (const entry of directoryEntries) {
        const copiedPath = entry.path === '.'
          ? toPath
          : path.join(toPath, ...entry.path.split('/'));
        forcedModes.set(path.resolve(copiedPath), entry.mode ^ 0o100);
      }
    };
    fs.lstatSync = (targetPath, options) => {
      const stats = realLstatSync(targetPath, options);
      const key = typeof targetPath === 'string' ? path.resolve(targetPath) : null;
      if (!key || !forcedModes.has(key)) return stats;
      return new Proxy(stats, {
        get(target, property) {
          if (property === 'mode') return (target.mode & ~0o7777) | forcedModes.get(key);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    fs.chmodSync = (targetPath, mode) => {
      const key = typeof targetPath === 'string' ? path.resolve(targetPath) : null;
      if (key && forcedModes.has(key)) {
        forcedModes.set(key, mode & 0o7777);
        chmodCalls.push(key);
        return;
      }
      realChmodSync(targetPath, mode);
    };
    fs.openSync = (targetPath, flags, mode) => {
      const descriptor = realOpenSync(targetPath, flags, mode);
      const key = typeof targetPath === 'string' ? path.resolve(targetPath) : null;
      if (key && forcedModes.has(key)) descriptorPaths.set(descriptor, key);
      return descriptor;
    };
    fs.fchmodSync = (descriptor, mode) => {
      const key = descriptorPaths.get(descriptor);
      if (key) {
        forcedModes.set(key, mode & 0o7777);
        chmodCalls.push(key);
      }
      realFchmodSync(descriptor, mode);
    };

    try {
      copyCarryPathsAndVerify({
        checkoutRoot,
        worktreePath,
        carryPaths: ['owner'],
      });
    } finally {
      fs.cpSync = realCpSync;
      fs.lstatSync = realLstatSync;
      fs.chmodSync = realChmodSync;
      fs.openSync = realOpenSync;
      fs.fchmodSync = realFchmodSync;
    }

    assert.deepEqual(
      buildPathManifest(destinationPath),
      buildPathManifest(sourcePath),
    );
    assert.equal(chmodCalls.length, 2);
    assert.equal(path.basename(chmodCalls[0]), 'private');
    assert.equal(path.basename(chmodCalls[1]), 'payload');
    assert.equal(path.dirname(chmodCalls[0]), chmodCalls[1]);
    assert.equal(
      fs.readdirSync(path.dirname(worktreePath)).some((name) => name.startsWith(`.${path.basename(worktreePath)}-carry-copy-`)),
      false,
    );
  });
});

test('copyCarryPathsAndVerify never chmods through a copied symlink ancestor', (context) => {
  if (process.platform === 'win32') {
    context.skip('portable directory permission modes are not observable on Windows');
    return;
  }

  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const sourcePath = path.join(checkoutRoot, 'owner');
    const sourceAncestor = path.join(sourcePath, 'ancestor');
    const destinationPath = path.join(worktreePath, 'owner');
    const outsidePath = path.join(root, 'outside');
    const outsideChild = path.join(outsidePath, 'child');
    fs.mkdirSync(sourcePath);
    fs.mkdirSync(destinationPath);
    fs.writeFileSync(path.join(destinationPath, 'existing.txt'), 'existing destination\n');
    fs.mkdirSync(outsideChild, { recursive: true });
    fs.chmodSync(outsideChild, 0o777);
    fs.symlinkSync(outsidePath, sourceAncestor, 'dir');
    const outsideMode = fs.lstatSync(outsideChild).mode & 0o7777;

    const realCpSync = fs.cpSync;
    let injected = false;
    fs.cpSync = (fromPath, toPath, options) => {
      realCpSync(fromPath, toPath, options);
      if (!injected && path.resolve(fromPath) === path.resolve(sourcePath)) {
        injected = true;
        fs.unlinkSync(sourceAncestor);
        fs.mkdirSync(path.join(sourceAncestor, 'child'), { recursive: true });
        fs.chmodSync(path.join(sourceAncestor, 'child'), 0o700);
      }
    };

    try {
      assert.throws(() => copyCarryPathsAndVerify({
        checkoutRoot,
        worktreePath,
        carryPaths: ['owner'],
      }), /changed|differs/i);
    } finally {
      fs.cpSync = realCpSync;
    }

    assert.equal(injected, true);
    assert.equal(
      fs.lstatSync(outsideChild).mode & 0o7777,
      outsideMode,
      'an unverified copied symlink ancestor must never redirect chmod outside the worktree',
    );
    assert.equal(
      fs.readFileSync(path.join(destinationPath, 'existing.txt'), 'utf8'),
      'existing destination\n',
    );
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.worktree-carry-copy-')),
      false,
    );
  });
});

test('copyCarryPathsAndVerify restores an existing directory when staged promotion fails', () => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const sourcePath = path.join(checkoutRoot, 'owner');
    const destinationPath = path.join(worktreePath, 'owner');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(sourcePath, 'new.txt'), 'new destination\n');
    fs.mkdirSync(destinationPath);
    fs.writeFileSync(path.join(destinationPath, 'existing.txt'), 'existing destination\n');

    const realRenameSync = fs.renameSync;
    let injected = false;
    fs.renameSync = (fromPath, toPath) => {
      if (!injected
        && path.basename(fromPath) === 'payload'
        && path.resolve(toPath) === path.resolve(destinationPath)) {
        injected = true;
        const error = new Error('injected promotion failure');
        error.code = 'EACCES';
        throw error;
      }
      realRenameSync(fromPath, toPath);
    };

    let failure;
    try {
      failure = captureThrown(() => copyCarryPathsAndVerify({
        checkoutRoot,
        worktreePath,
        carryPaths: ['owner'],
      }));
    } finally {
      fs.renameSync = realRenameSync;
    }

    assert.equal(injected, true);
    assert.match(failure.message, /injected promotion failure/i);
    assert.match(failure.message, /prior destination was left unchanged/i);
    assert.equal(
      fs.readFileSync(path.join(destinationPath, 'existing.txt'), 'utf8'),
      'existing destination\n',
    );
    assert.equal(fs.existsSync(path.join(destinationPath, 'new.txt')), false);
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.worktree-carry-copy-')),
      false,
    );
  });
});

test('copyCarryPathsAndVerify cleans private staging after an immediate copy failure', () => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const sourcePath = path.join(checkoutRoot, 'owner');
    const destinationPath = path.join(worktreePath, 'owner');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(sourcePath, 'new.txt'), 'source remains\n');

    const realCpSync = fs.cpSync;
    let injected = false;
    fs.cpSync = (fromPath, toPath, options) => {
      if (!injected && path.resolve(fromPath) === path.resolve(sourcePath)) {
        injected = true;
        const error = new Error('injected copy failure');
        error.code = 'EIO';
        throw error;
      }
      realCpSync(fromPath, toPath, options);
    };

    let failure;
    try {
      failure = captureThrown(() => copyCarryPathsAndVerify({
        checkoutRoot,
        worktreePath,
        carryPaths: ['owner'],
      }));
    } finally {
      fs.cpSync = realCpSync;
    }

    assert.equal(injected, true);
    assert.match(failure.message, /injected copy failure/i);
    assert.match(failure.message, /prior destination was left unchanged/i);
    assert.equal(fs.readFileSync(path.join(sourcePath, 'new.txt'), 'utf8'), 'source remains\n');
    assert.equal(fs.existsSync(destinationPath), false);
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.worktree-carry-copy-')),
      false,
    );
  });
});

test('copyCarryPathsAndVerify retains both copies when the promoted directory changes', () => {
  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    const sourcePath = path.join(checkoutRoot, 'owner');
    const destinationPath = path.join(worktreePath, 'owner');
    fs.mkdirSync(sourcePath);
    fs.writeFileSync(path.join(sourcePath, 'new.txt'), 'new destination\n');
    fs.mkdirSync(destinationPath);
    fs.writeFileSync(path.join(destinationPath, 'existing.txt'), 'existing destination\n');

    const realRenameSync = fs.renameSync;
    let injected = false;
    fs.renameSync = (fromPath, toPath) => {
      realRenameSync(fromPath, toPath);
      if (!injected
        && path.basename(fromPath) === 'payload'
        && path.resolve(toPath) === path.resolve(destinationPath)) {
        injected = true;
        fs.writeFileSync(path.join(destinationPath, 'new.txt'), 'changed after promotion\n');
      }
    };

    let failure;
    try {
      failure = captureThrown(() => copyCarryPathsAndVerify({
        checkoutRoot,
        worktreePath,
        carryPaths: ['owner'],
      }));
    } finally {
      fs.renameSync = realRenameSync;
    }

    assert.equal(injected, true);
    assert.match(failure.message, /changed after carry verification/i);
    assert.match(failure.message, /recovery state remains/i);
    assert.equal(
      fs.readFileSync(path.join(destinationPath, 'new.txt'), 'utf8'),
      'changed after promotion\n',
    );
    const [transactionName] = fs.readdirSync(root)
      .filter((name) => name.startsWith('.worktree-carry-copy-'));
    assert.ok(transactionName, failure.message);
    assert.equal(
      fs.readFileSync(path.join(root, transactionName, 'destination-backup', 'existing.txt'), 'utf8'),
      'existing destination\n',
    );
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

test('cleanupVerifiedCarry isolates carried files from uncarried hard links', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const outsidePath = path.join(checkoutRoot, 'outside.txt');
    const carriedPath = path.join(checkoutRoot, 'owner', 'carried.txt');
    const siblingPath = path.join(checkoutRoot, 'owner', 'sibling.txt');
    const destinationPath = path.join(worktreePath, 'owner', 'carried.txt');
    const destinationSibling = path.join(worktreePath, 'owner', 'sibling.txt');
    fs.writeFileSync(outsidePath, 'protected source\n');
    git(checkoutRoot, ['add', 'outside.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.mkdirSync(path.dirname(carriedPath));
    fs.linkSync(outsidePath, carriedPath);
    fs.linkSync(carriedPath, siblingPath);

    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt });

    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.lstatSync(destinationPath).nlink, 1);
    assert.equal(fs.lstatSync(destinationSibling).nlink, 1);
    fs.writeFileSync(destinationPath, 'task edit\n');
    assert.equal(
      fs.readFileSync(outsidePath, 'utf8'),
      'protected source\n',
      'the task copy must not remain linked to an uncarried protected-checkout file',
    );
    assert.equal(fs.readFileSync(destinationSibling, 'utf8'), 'protected source\n');
    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
  });
});

test('cleanupVerifiedCarry rejects a destination hard-linked after receipt creation', () => {
  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourcePath = path.join(checkoutRoot, 'owner.txt');
    const destinationPath = path.join(worktreePath, 'owner.txt');
    const lateLinkPath = path.join(worktreePath, 'late-link.txt');
    fs.writeFileSync(sourcePath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(sourcePath, 'carried\n');
    const carryPaths = ['owner.txt'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    fs.linkSync(destinationPath, lateLinkPath);

    assert.throws(() => cleanupVerifiedCarry({
      checkoutRoot,
      worktreePath,
      carryPaths,
      receipt,
    }), /hard link|isolated/i);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'carried\n');
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'carried\n');
    assert.equal(fs.readFileSync(lateLinkPath, 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry restores source directory modes before reporting success', (context) => {
  if (process.platform === 'win32') {
    context.skip('portable directory permission modes are not observable on Windows');
    return;
  }

  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceRoot = path.join(checkoutRoot, 'owner');
    const sourcePrivate = path.join(sourceRoot, 'private');
    const trackedPath = path.join(sourcePrivate, 'note.txt');
    fs.mkdirSync(sourcePrivate, { recursive: true });
    fs.writeFileSync(trackedPath, 'baseline\n');
    git(checkoutRoot, ['add', 'owner/private/note.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.chmodSync(sourceRoot, 0o700);
    fs.chmodSync(sourcePrivate, 0o710);
    fs.writeFileSync(trackedPath, 'carried\n');

    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt });

    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.lstatSync(sourceRoot).mode & 0o7777, 0o700);
    assert.equal(fs.lstatSync(sourcePrivate).mode & 0o7777, 0o710);
    assert.equal(fs.lstatSync(path.join(worktreePath, 'owner')).mode & 0o7777, 0o700);
    assert.equal(fs.lstatSync(path.join(worktreePath, 'owner', 'private')).mode & 0o7777, 0o710);
  });
});

test('cleanupVerifiedCarry restores a HEAD file without chmodding the carried directory that replaced it', (context) => {
  if (process.platform === 'win32') {
    context.skip('source directory mode restoration is POSIX-only');
    return;
  }

  withTempRoots(({ checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceRoot = path.join(checkoutRoot, 'owner');
    const changedPath = path.join(sourceRoot, 'node');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(changedPath, 'baseline file\n');
    git(checkoutRoot, ['add', 'owner/node']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.chmodSync(sourceRoot, 0o700);
    fs.rmSync(changedPath);
    fs.mkdirSync(changedPath);
    fs.writeFileSync(path.join(changedPath, 'scratch.txt'), 'carried directory\n');

    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt });

    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.readFileSync(changedPath, 'utf8'), 'baseline file\n');
    assert.equal(fs.lstatSync(sourceRoot).mode & 0o7777, 0o700);
    assert.equal(
      fs.readFileSync(path.join(worktreePath, 'owner', 'node', 'scratch.txt'), 'utf8'),
      'carried directory\n',
    );
  });
});

test('cleanupVerifiedCarry detects a source-directory mode that fchmod did not restore', (context) => {
  if (process.platform === 'win32') {
    context.skip('source directory mode restoration is POSIX-only');
    return;
  }

  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceRoot = path.join(checkoutRoot, 'owner');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, 'note.txt'), 'baseline\n');
    git(checkoutRoot, ['add', 'owner/note.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.chmodSync(sourceRoot, 0o700);
    fs.writeFileSync(path.join(sourceRoot, 'note.txt'), 'carried\n');
    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });

    const realFchmodSync = fs.fchmodSync;
    let injected = false;
    fs.fchmodSync = () => { injected = true; };
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt }));
    } finally {
      fs.fchmodSync = realFchmodSync;
    }

    assert.equal(injected, true);
    assert.match(failure.message, /directory mode was not restored/i);
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner', 'note.txt'), 'utf8'), 'carried\n');
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.checkout-carry-cleanup-')),
      true,
    );
  });
});

test('cleanupVerifiedCarry never restores a source mode through a swapped symlink', (context) => {
  if (process.platform === 'win32') {
    context.skip('source directory mode restoration is POSIX-only');
    return;
  }

  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceRoot = path.join(checkoutRoot, 'owner');
    const sourcePrivate = path.join(sourceRoot, 'private');
    const outsidePath = path.join(root, 'outside');
    fs.mkdirSync(sourcePrivate, { recursive: true });
    fs.writeFileSync(path.join(sourcePrivate, 'note.txt'), 'baseline\n');
    fs.mkdirSync(outsidePath);
    fs.writeFileSync(path.join(outsidePath, 'marker.txt'), 'outside\n');
    fs.chmodSync(outsidePath, 0o777);
    git(checkoutRoot, ['add', 'owner/private/note.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.chmodSync(sourceRoot, 0o700);
    fs.chmodSync(sourcePrivate, 0o710);
    fs.writeFileSync(path.join(sourcePrivate, 'note.txt'), 'carried\n');
    const carryPaths = ['owner'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    const outsideMode = fs.lstatSync(outsidePath).mode & 0o7777;

    const realOpenSync = fs.openSync;
    let injected = false;
    fs.openSync = (targetPath, flags, mode) => {
      if (!injected && path.resolve(targetPath) === path.resolve(sourcePrivate)) {
        injected = true;
        fs.rmSync(sourcePrivate, { recursive: true });
        fs.symlinkSync(outsidePath, sourcePrivate, 'dir');
      }
      return realOpenSync(targetPath, flags, mode);
    };
    let failure;
    try {
      failure = captureThrown(() => cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt }));
    } finally {
      fs.openSync = realOpenSync;
    }

    assert.equal(injected, true);
    assert.ok(failure);
    assert.equal(fs.lstatSync(sourcePrivate).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(outsidePath).mode & 0o7777, outsideMode);
    assert.equal(fs.readFileSync(path.join(outsidePath, 'marker.txt'), 'utf8'), 'outside\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'owner', 'private', 'note.txt'), 'utf8'), 'carried\n');
  });
});

test('cleanupVerifiedCarry streams large tracked path sets without exceeding Windows argv', (context) => {
  if (process.platform !== 'win32') {
    context.skip('Windows command-line limits are the regression boundary');
    return;
  }

  withTempRoots(({ root, checkoutRoot, worktreePath }) => {
    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'carry-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Carry Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    const sourceRoot = path.join(checkoutRoot, 'payload');
    fs.mkdirSync(sourceRoot);
    const names = Array.from({ length: 700 }, (_, index) => `${String(index).padStart(4, '0')}-${'x'.repeat(64)}.txt`);
    for (const name of names) fs.writeFileSync(path.join(sourceRoot, name), 'baseline\n');
    git(checkoutRoot, ['add', '--all']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    fs.writeFileSync(path.join(sourceRoot, names[0]), 'carried\n');

    const carryPaths = ['payload'];
    const receipt = copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths });
    cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt });

    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
    assert.equal(fs.readFileSync(path.join(sourceRoot, names[0]), 'utf8'), 'baseline\n');
    assert.equal(fs.readFileSync(path.join(worktreePath, 'payload', names[0]), 'utf8'), 'carried\n');
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.checkout-carry-cleanup-')),
      false,
    );
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
      if (!injected
        && path.resolve(fromPath) === sourcePath
        && toPath.includes(`${path.sep}source${path.sep}`)) {
        injected = true;
        fs.writeFileSync(toPath, 'in-flight owner edit\n');
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
      if (!injected
        && path.resolve(fromPath) === sourcePath
        && toPath.includes(`${path.sep}source${path.sep}`)) {
        injected = true;
        fs.writeFileSync(toPath, 'in-flight owner edit\n');
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
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'carried\n');
    assert.equal(
      fs.readFileSync(path.join(root, transactionRoots[0], 'source', 'owner.txt'), 'utf8'),
      'in-flight owner edit\n',
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
      fs.readFileSync(path.join(root, transactionRoots[0], 'source', 'owner.txt'), 'utf8'),
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
      if (!injected
        && path.resolve(fromPath) === sourcePath
        && toPath.includes(`${path.sep}source${path.sep}`)) {
        injected = true;
        fs.writeFileSync(toPath, 'in-flight owner edit\n');
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
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'carried\n');
    const transactionRoots = fs.readdirSync(root)
      .filter((name) => name.startsWith('.checkout-carry-cleanup-'));
    assert.equal(transactionRoots.length, 1);
    assert.equal(
      fs.readFileSync(path.join(root, transactionRoots[0], 'source', 'owner', 'tracked.txt'), 'utf8'),
      'in-flight owner edit\n',
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
