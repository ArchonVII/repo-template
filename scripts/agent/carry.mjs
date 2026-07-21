import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { PRECISE_STATUS_ARGS, parseGitStatusPorcelain } from './lib.mjs';

export function buildPathManifest(rootPath) {
  const entries = [];
  walk(rootPath, '.');
  return entries;

  function walk(absolutePath, relativePath) {
    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      entries.push({
        path: relativePath,
        type: 'symlink',
        mode: stats.mode & 0o7777,
        target: fs.readlinkSync(absolutePath),
      });
      return;
    }
    if (stats.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory', mode: stats.mode & 0o7777 });
      for (const name of fs.readdirSync(absolutePath).sort()) {
        walk(path.join(absolutePath, name), relativePath === '.' ? name : `${relativePath}/${name}`);
      }
      return;
    }
    if (stats.isFile()) {
      entries.push({
        path: relativePath,
        type: 'file',
        mode: stats.mode & 0o7777,
        size: stats.size,
        sha256: hashFileSync(absolutePath),
      });
      return;
    }
    throw new Error(`Unsupported carry path type: ${absolutePath}`);
  }
}

function hashFileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function assertPathCopiesMatch(sourcePath, destinationPath) {
  const sourceState = capturePathState(sourcePath);
  const destinationState = capturePathState(destinationPath);
  if (!pathStatesMatch(sourceState, destinationState)) {
    if (sourceState.exists !== destinationState.exists) {
      throw new Error(`Carry verification failed for ${sourcePath}: source and destination existence differs; source was not cleaned.`);
    }
    throw new Error(`Carry verification failed for ${sourcePath}: destination content differs; source was not cleaned.`);
  }
}

export function copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths }) {
  const normalizedPaths = normalizeCarryPaths({ checkoutRoot, worktreePath, carryPaths });
  assertIndexStateRepresentedInWorktree(checkoutRoot, normalizedPaths);
  const entries = [];
  for (const carryPath of normalizedPaths) {
    assertNoSymlinkAncestors(checkoutRoot, carryPath, 'source checkout');
    assertNoSymlinkAncestors(worktreePath, carryPath, 'destination worktree');
    const sourcePath = resolveInside(checkoutRoot, carryPath);
    const destinationPath = resolveInside(worktreePath, carryPath);
    const stats = lstatIfPresent(sourcePath);
    if (!stats) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.rmSync(destinationPath, { recursive: true, force: true });
      const state = capturePathState(sourcePath);
      assertPathStateMatches(destinationPath, state, carryPath, 'destination worktree');
      entries.push({ path: carryPath, state });
      continue;
    }
    if (stats.isDirectory()) {
      const state = copyDirectoryWithModesAndVerify({
        sourcePath,
        destinationPath,
        worktreePath,
        carryPath,
      });
      entries.push({ path: carryPath, state });
      continue;
    } else if (stats.isFile() || stats.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.rmSync(destinationPath, { recursive: true, force: true });
      fs.cpSync(sourcePath, destinationPath, { force: true, verbatimSymlinks: true });
    } else {
      throw new Error(`Unsupported carry path type: ${sourcePath}`);
    }
    const state = capturePathState(sourcePath);
    assertPathStateMatches(destinationPath, state, carryPath, 'destination worktree');
    entries.push({ path: carryPath, state });
  }
  return {
    schemaVersion: 2,
    entries,
    indexFingerprint: captureIndexFingerprint(checkoutRoot, normalizedPaths),
  };
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt }) {
  const normalizedPaths = normalizeCarryPaths({ checkoutRoot, worktreePath, carryPaths });
  const { entries, indexFingerprint } = validateReceipt(receipt, normalizedPaths);
  assertIndexStateRepresentedInWorktree(checkoutRoot, normalizedPaths);
  assertIndexFingerprintMatches(checkoutRoot, normalizedPaths, indexFingerprint);
  verifyReceiptState({ checkoutRoot, worktreePath, entries });
  const trackedPaths = trackedPathSetsForCarry(checkoutRoot, normalizedPaths);
  const transfer = transferCarrySources({ checkoutRoot, worktreePath, entries });
  let restoreStarted = false;
  try {
    verifyTransferredState({ checkoutRoot, worktreePath, entries, moved: transfer.moved });
    assertIndexFingerprintMatches(checkoutRoot, normalizedPaths, indexFingerprint);
    restoreStarted = true;
    restoreTrackedCheckout(checkoutRoot, trackedPaths);
    const remaining = parseGitStatusPorcelain(git(checkoutRoot, [...PRECISE_STATUS_ARGS], { trim: false }));
    if (remaining.length > 0) {
      throw new Error(`Invoking checkout remains dirty after carry cleanup: ${remaining.slice(0, 3).map((entry) => entry.path).join(', ')}`);
    }
    const ignored = ignoredCarryEntries(checkoutRoot, normalizedPaths);
    if (ignored.length > 0) {
      throw new Error(`Ignored carry paths reappeared during cleanup: ${ignored.slice(0, 3).map((entry) => entry.path).join(', ')}`);
    }
    verifyTransferredDestinations(worktreePath, entries, transfer.moved);
    verifyTransactionBackups(entries, transfer.moved);
    fs.rmSync(transfer.transactionRoot, { recursive: true, force: true });
  } catch (error) {
    // Git can restore a batch only partially. Once that starts, automatic
    // rollback could overwrite a path recreated during the restore; retain all
    // source/destination/transaction locations for explicit recovery instead.
    const recovery = restoreStarted
      ? ` Carried source objects remain in the destination worktree; prior destination copies remain at ${transfer.transactionRoot}. The source checkout was not overwritten and may require manual cleanup.`
      : rollbackTransfer(transfer);
    throw new Error(`${error.message}${recovery}`);
  }
}

function capturePathState(filePath) {
  if (!lstatIfPresent(filePath)) return { exists: false, manifest: null };
  return { exists: true, manifest: buildPathManifest(filePath) };
}

function copyDirectoryWithModesAndVerify({ sourcePath, destinationPath, worktreePath, carryPath }) {
  const transactionRoot = fs.mkdtempSync(path.join(
    path.dirname(worktreePath),
    `.${path.basename(worktreePath)}-carry-copy-`,
  ));
  const stagedPath = path.join(transactionRoot, 'payload');
  const backupPath = path.join(transactionRoot, 'destination-backup');
  let destinationBackedUp = false;
  let promoted = false;

  try {
    fs.cpSync(sourcePath, stagedPath, { recursive: true, force: true, verbatimSymlinks: true });
    const state = capturePathState(sourcePath);
    assertPathStateMatchesIgnoringDirectoryModes(stagedPath, state, carryPath);
    restoreDirectoryModes(stagedPath, state.manifest);
    assertPathStateMatches(stagedPath, state, carryPath, 'staged carry copy');

    assertNoSymlinkAncestors(worktreePath, carryPath, 'destination worktree');
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    assertNoSymlinkAncestors(worktreePath, carryPath, 'destination worktree');
    if (lstatIfPresent(destinationPath)) {
      fs.renameSync(destinationPath, backupPath);
      destinationBackedUp = true;
    }
    fs.renameSync(stagedPath, destinationPath);
    promoted = true;
    assertPathStateMatches(destinationPath, state, carryPath, 'destination worktree');

    if (destinationBackedUp) removePrivateTreeNoFollow(backupPath);
    removePrivateTreeNoFollow(transactionRoot);
    return state;
  } catch (error) {
    let recovery;
    try {
      recovery = recoverDirectoryCopy({
        transactionRoot,
        backupPath,
        destinationPath,
        worktreePath,
        carryPath,
        destinationBackedUp,
        promoted,
      });
    } catch (recoveryError) {
      recovery = ` Recovery inspection failed (${recoveryError.code || recoveryError.message}); state remains at ${destinationPath} and ${transactionRoot}.`;
    }
    throw new Error(`${error.message}${recovery}`);
  }
}

function recoverDirectoryCopy({
  transactionRoot,
  backupPath,
  destinationPath,
  worktreePath,
  carryPath,
  destinationBackedUp,
  promoted,
}) {
  if (promoted) {
    return ` The promoted destination was preserved at ${destinationPath}; recovery state remains at ${transactionRoot}.`;
  }

  const problems = [];
  if (destinationBackedUp) {
    try {
      assertNoSymlinkAncestors(worktreePath, carryPath, 'destination worktree');
      if (lstatIfPresent(destinationPath)) {
        problems.push('destination path became occupied');
      } else if (!lstatIfPresent(backupPath)) {
        problems.push('destination backup is missing');
      } else {
        fs.renameSync(backupPath, destinationPath);
        destinationBackedUp = false;
      }
    } catch (error) {
      problems.push(`destination restore failed: ${error.code || error.message}`);
    }
  }

  if (problems.length === 0) {
    try {
      removePrivateTreeNoFollow(transactionRoot);
      return ' The prior destination was left unchanged.';
    } catch (error) {
      problems.push(`transaction cleanup failed: ${error.code || error.message}`);
    }
  }

  return ` Recovery state remains at ${destinationPath} and ${transactionRoot}; manual recovery is required for: ${problems.join(', ')}.`;
}

function removePrivateTreeNoFollow(entryPath) {
  const stats = lstatIfPresent(entryPath);
  if (!stats) return;
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fs.unlinkSync(entryPath);
    return;
  }

  const mode = stats.mode & 0o7777;
  if ((mode & 0o700) !== 0o700) chmodDirectoryNoFollow(entryPath, mode | 0o700);
  for (const name of fs.readdirSync(entryPath)) {
    removePrivateTreeNoFollow(path.join(entryPath, name));
  }
  fs.rmdirSync(entryPath);
}

function restoreDirectoryModes(destinationRoot, manifest) {
  if (!Array.isArray(manifest)) return;
  const directories = manifest
    .filter((entry) => entry.type === 'directory')
    .sort((left, right) => directoryDepth(right.path) - directoryDepth(left.path)
      || compareText(left.path, right.path));
  for (const entry of directories) {
    const directoryPath = entry.path === '.'
      ? destinationRoot
      : path.join(destinationRoot, ...entry.path.split('/'));
    assertNoSymlinkAncestors(destinationRoot, entry.path, 'staged carry copy');
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Carry destination changed while restoring directory modes: ${entry.path}.`);
    }
    if ((stats.mode & 0o7777) === entry.mode) continue;
    chmodDirectoryNoFollow(directoryPath, entry.mode);
  }
}

function directoryDepth(relativePath) {
  return relativePath === '.' ? 0 : relativePath.split('/').length;
}

function chmodDirectoryNoFollow(directoryPath, mode) {
  const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = fs.constants;
  if (Number.isInteger(O_DIRECTORY) && Number.isInteger(O_NOFOLLOW)) {
    const descriptor = fs.openSync(directoryPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    try {
      if (!fs.fstatSync(descriptor).isDirectory()) {
        throw new Error(`Carry destination changed while restoring a directory mode: ${directoryPath}.`);
      }
      fs.fchmodSync(descriptor, mode);
    } finally {
      fs.closeSync(descriptor);
    }
    return;
  }

  // Windows does not expose O_DIRECTORY/O_NOFOLLOW and does not represent
  // portable Unix directory modes. Avoid chmod unless lstat observed a real
  // mode difference, and reject a reparse-point swap immediately beforehand.
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Carry destination changed while restoring a directory mode: ${directoryPath}.`);
  }
  fs.chmodSync(directoryPath, mode);
}

function pathStatesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathStatesMatchIgnoringDirectoryModes(left, right) {
  if (left.exists !== right.exists) return false;
  if (!left.exists) return left.manifest === null && right.manifest === null;
  if (!Array.isArray(left.manifest)
    || !Array.isArray(right.manifest)
    || left.manifest.length !== right.manifest.length) return false;

  return left.manifest.every((leftEntry, index) => {
    const rightEntry = right.manifest[index];
    if (leftEntry.path !== rightEntry.path || leftEntry.type !== rightEntry.type) return false;
    if (leftEntry.type !== 'directory') return JSON.stringify(leftEntry) === JSON.stringify(rightEntry);
    const { mode: leftMode, ...leftRest } = leftEntry;
    const { mode: rightMode, ...rightRest } = rightEntry;
    return Number.isInteger(leftMode)
      && Number.isInteger(rightMode)
      && JSON.stringify(leftRest) === JSON.stringify(rightRest);
  });
}

function assertPathStateMatchesIgnoringDirectoryModes(filePath, expectedState, carryPath) {
  if (!pathStatesMatchIgnoringDirectoryModes(capturePathState(filePath), expectedState)) {
    throw new Error(`Carry path changed while staging the directory copy: ${carryPath}.`);
  }
}

function assertPathStateMatches(filePath, expectedState, carryPath, location) {
  if (!pathStatesMatch(capturePathState(filePath), expectedState)) {
    throw new Error(`Carry path changed after carry verification: ${carryPath} (${location}).`);
  }
}

function validateReceipt(receipt, normalizedPaths) {
  if (receipt?.schemaVersion !== 2
    || !Array.isArray(receipt.entries)
    || !/^[a-f0-9]{64}$/.test(receipt.indexFingerprint ?? '')) {
    throw new Error('Carry cleanup requires the verification receipt returned by copyCarryPathsAndVerify.');
  }
  const byPath = new Map();
  for (const entry of receipt.entries) {
    if (!entry || typeof entry.path !== 'string' || !validPathState(entry.state) || byPath.has(entry.path)) {
      throw new Error('Carry cleanup received an invalid verification receipt.');
    }
    byPath.set(entry.path, entry);
  }
  if (byPath.size !== normalizedPaths.length || normalizedPaths.some((carryPath) => !byPath.has(carryPath))) {
    throw new Error('Carry cleanup receipt does not cover the requested carry paths exactly.');
  }
  return {
    entries: normalizedPaths.map((carryPath) => byPath.get(carryPath)),
    indexFingerprint: receipt.indexFingerprint,
  };
}

function validPathState(state) {
  return state
    && typeof state.exists === 'boolean'
    && (state.exists ? Array.isArray(state.manifest) : state.manifest === null);
}

function verifyReceiptState({ checkoutRoot, worktreePath, entries }) {
  for (const entry of entries) {
    assertNoSymlinkAncestors(checkoutRoot, entry.path, 'source checkout');
    assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
    assertPathStateMatches(resolveInside(checkoutRoot, entry.path), entry.state, entry.path, 'source checkout');
    assertPathStateMatches(resolveInside(worktreePath, entry.path), entry.state, entry.path, 'destination worktree');
  }
}

function assertIndexStateRepresentedInWorktree(checkoutRoot, carryPaths) {
  if (!isGitCheckout(checkoutRoot)) return;
  const stagedPaths = new Set(changedGitPaths(checkoutRoot, carryPaths, ['--cached']));
  const worktreePaths = new Set(changedGitPaths(checkoutRoot, carryPaths));
  const stagedDeletions = changedGitPaths(checkoutRoot, carryPaths, ['--cached', '--diff-filter=D']);
  const divergent = [...stagedPaths].filter((filePath) => worktreePaths.has(filePath));
  for (const deletedPath of stagedDeletions) {
    if (lstatIfPresent(resolveInside(checkoutRoot, deletedPath))) divergent.push(deletedPath);
  }
  const uniqueDivergent = [...new Set(divergent)].sort(compareText);
  if (uniqueDivergent.length > 0) {
    throw new Error(
      `Carry cannot safely move paths whose Git index and worktree states differ: ${uniqueDivergent.slice(0, 3).join(', ')}. Preserve both versions and make them match before retrying.`,
    );
  }
}

function changedGitPaths(checkoutRoot, carryPaths, extraArgs = []) {
  const output = git(checkoutRoot, [
    '--literal-pathspecs',
    'diff',
    ...extraArgs,
    '--no-renames',
    '--name-only',
    '-z',
    '--',
    ...carryPaths,
  ], { trim: false });
  return splitNul(output);
}

function captureIndexFingerprint(checkoutRoot, carryPaths) {
  if (!isGitCheckout(checkoutRoot)) return null;
  const indexEntries = git(checkoutRoot, [
    '--literal-pathspecs',
    'ls-files',
    '--stage',
    '-z',
    '--',
    ...carryPaths,
  ], { trim: false });
  return crypto.createHash('sha256').update(indexEntries).digest('hex');
}

function assertIndexFingerprintMatches(checkoutRoot, carryPaths, expectedFingerprint) {
  const actualFingerprint = captureIndexFingerprint(checkoutRoot, carryPaths);
  if (actualFingerprint !== expectedFingerprint) {
    throw new Error('The Git index changed after carry verification; source and destination were left for inspection.');
  }
}

function isGitCheckout(checkoutRoot) {
  return lstatIfPresent(path.join(checkoutRoot, '.git')) !== null;
}

function transferCarrySources({ checkoutRoot, worktreePath, entries }) {
  const transactionRoot = fs.mkdtempSync(path.join(
    path.dirname(checkoutRoot),
    `.${path.basename(checkoutRoot)}-carry-cleanup-`,
  ));
  const moved = [];
  try {
    for (const entry of entries) {
      assertNoSymlinkAncestors(checkoutRoot, entry.path, 'source checkout');
      assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
      const sourcePath = resolveInside(checkoutRoot, entry.path);
      const destinationPath = resolveInside(worktreePath, entry.path);
      const backupPath = resolveInside(transactionRoot, entry.path);
      const item = {
        ...entry,
        sourcePath,
        destinationPath,
        backupPath,
        destinationBackedUp: false,
        sourceMoved: false,
      };
      moved.push(item);
      if (lstatIfPresent(destinationPath)) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.renameSync(destinationPath, backupPath);
        item.destinationBackedUp = true;
      }
      if (lstatIfPresent(sourcePath)) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.renameSync(sourcePath, destinationPath);
        item.sourceMoved = true;
      }
    }
    return { transactionRoot, moved, checkoutRoot, worktreePath };
  } catch (error) {
    const recovery = rollbackTransfer({ transactionRoot, moved, checkoutRoot, worktreePath });
    throw new Error(`Carry cleanup could not transfer the verified sources. ${error.message}${recovery}`);
  }
}

function verifyTransferredState({ checkoutRoot, worktreePath, entries, moved }) {
  const movedByPath = new Map(moved.map((item) => [item.path, item]));
  for (const entry of entries) {
    assertNoSymlinkAncestors(checkoutRoot, entry.path, 'source checkout');
    assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
    const item = movedByPath.get(entry.path);
    if (lstatIfPresent(resolveInside(checkoutRoot, entry.path))) {
      throw new Error(`Carry path changed after carry verification: ${entry.path} (source path reappeared during transfer).`);
    }
    const transferredState = item.sourceMoved
      ? capturePathState(item.destinationPath)
      : { exists: false, manifest: null };
    if (!pathStatesMatch(transferredState, entry.state)) {
      throw new Error(`Carry path changed after carry verification: ${entry.path} (transferred source).`);
    }
    const backupState = item.destinationBackedUp
      ? capturePathState(item.backupPath)
      : { exists: false, manifest: null };
    if (!pathStatesMatch(backupState, entry.state)) {
      throw new Error(`Carry destination changed after carry verification: ${entry.path} (transaction backup).`);
    }
  }
}

function verifyTransactionBackups(entries, moved) {
  const movedByPath = new Map(moved.map((item) => [item.path, item]));
  for (const entry of entries) {
    const item = movedByPath.get(entry.path);
    const backupState = item.destinationBackedUp
      ? capturePathState(item.backupPath)
      : { exists: false, manifest: null };
    if (!pathStatesMatch(backupState, entry.state)) {
      throw new Error(`Carry destination changed during cleanup: ${entry.path} (transaction backup).`);
    }
  }
}

function rollbackTransfer({ transactionRoot, moved, checkoutRoot, worktreePath }) {
  const problems = [];
  for (const item of [...moved].reverse()) {
    const sourceSafe = rollbackPathIsSafe(checkoutRoot, item.path, 'source checkout', problems);
    const destinationSafe = rollbackPathIsSafe(worktreePath, item.path, 'destination worktree', problems);
    if (item.sourceMoved) {
      if (!sourceSafe || !destinationSafe) {
        // Preserve every object in place when an ancestor could redirect a rename.
      } else if (!lstatIfPresent(item.destinationPath)) {
        problems.push(`${item.path} (transferred source missing)`);
      } else if (lstatIfPresent(item.sourcePath)) {
        problems.push(`${item.path} (source path reappeared)`);
      } else {
        try {
          fs.mkdirSync(path.dirname(item.sourcePath), { recursive: true });
          fs.renameSync(item.destinationPath, item.sourcePath);
        } catch (error) {
          problems.push(`${item.path} (source restore failed: ${error.code || error.message})`);
        }
      }
    }
    if (item.destinationBackedUp && lstatIfPresent(item.backupPath)) {
      if (!destinationSafe) {
        // The transaction copy remains available for manual recovery.
      } else if (lstatIfPresent(item.destinationPath)) {
        problems.push(`${item.path} (destination path occupied)`);
      } else {
        try {
          fs.mkdirSync(path.dirname(item.destinationPath), { recursive: true });
          fs.renameSync(item.backupPath, item.destinationPath);
        } catch (error) {
          problems.push(`${item.path} (destination restore failed: ${error.code || error.message})`);
        }
      }
    }
  }
  if (problems.length === 0) {
    try {
      fs.rmSync(transactionRoot, { recursive: true, force: true });
      return ' Source and destination paths were restored.';
    } catch (error) {
      problems.push(`transaction cleanup failed: ${error.code || error.message}`);
    }
  }
  return ` Recovery state remains at the source/destination paths and ${transactionRoot}; manual recovery is required for: ${problems.join(', ')}.`;
}

function rollbackPathIsSafe(rootPath, carryPath, location, problems) {
  try {
    assertNoSymlinkAncestors(rootPath, carryPath, location);
    return true;
  } catch (error) {
    problems.push(`${carryPath} (${location} unsafe: ${error.message})`);
    return false;
  }
}

function verifyTransferredDestinations(worktreePath, entries, moved) {
  const movedByPath = new Map(moved.map((item) => [item.path, item]));
  for (const entry of entries) {
    assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
    const item = movedByPath.get(entry.path);
    const state = item.sourceMoved
      ? capturePathState(item.destinationPath)
      : { exists: false, manifest: null };
    if (!pathStatesMatch(state, entry.state)) {
      throw new Error(`Carry path changed after carry verification: ${entry.path} (destination changed during cleanup).`);
    }
  }
}

function resolveInside(rootPath, repoRelativePath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, repoRelativePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe carry path: ${repoRelativePath}`);
  }
  return resolvedPath;
}

function normalizeCarryPaths({ checkoutRoot, worktreePath, carryPaths }) {
  assertDistinctRoots(checkoutRoot, worktreePath);
  if (!Array.isArray(carryPaths) || carryPaths.length === 0) {
    throw new Error('Carry requires at least one path.');
  }
  const normalized = carryPaths.map((carryPath) => {
    if (typeof carryPath !== 'string' || carryPath.trim() === '') {
      throw new Error('Carry paths must be non-empty strings.');
    }
    const nativePath = carryPath.replace(/[\\/]+/g, path.sep);
    const absolutePath = resolveInside(checkoutRoot, nativePath);
    const relativePath = path.relative(path.resolve(checkoutRoot), absolutePath)
      .split(path.sep)
      .join('/');
    // Reject aliases portably rather than binding safety to the current host.
    // A branch prepared on a case-sensitive disk may later be consumed on a
    // default Windows or macOS volume where those spellings identify one path.
    const comparisonPath = relativePath
      .split('/')
      .map((component) => component.normalize('NFC').toLowerCase().normalize('NFC'))
      .join('/');
    if (comparisonPath === '.git' || comparisonPath.startsWith('.git/')) {
      throw new Error('Carry paths may not include .git metadata.');
    }
    return { path: relativePath, comparisonPath };
  }).sort((left, right) => compareText(left.comparisonPath, right.comparisonPath));

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex += 1) {
      const earlier = normalized[earlierIndex];
      if (current.comparisonPath === earlier.comparisonPath) {
        throw new Error(`Carry paths contain duplicate or case-aliased entries: ${earlier.path}, ${current.path}.`);
      }
      if (current.comparisonPath.startsWith(`${earlier.comparisonPath}/`)
        || earlier.comparisonPath.startsWith(`${current.comparisonPath}/`)) {
        throw new Error(`Carry paths may not overlap: ${earlier.path}, ${current.path}.`);
      }
    }
  }

  const paths = normalized.map((entry) => entry.path);
  for (const carryPath of paths) {
    assertNoSymlinkAncestors(checkoutRoot, carryPath, 'source checkout');
    assertNoSymlinkAncestors(worktreePath, carryPath, 'destination worktree');
  }
  return paths;
}

function assertDistinctRoots(checkoutRoot, worktreePath) {
  const checkoutPhysical = fs.realpathSync.native(path.resolve(checkoutRoot));
  const worktreePhysical = fs.realpathSync.native(path.resolve(worktreePath));
  if (sameOrNestedRoot(checkoutPhysical, worktreePhysical)
    || sameOrNestedRoot(worktreePhysical, checkoutPhysical)) {
    throw new Error('The source checkout and destination worktree must be distinct, non-nested directories.');
  }
}

function sameOrNestedRoot(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return !relativePath
    || (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`));
}

function assertNoSymlinkAncestors(rootPath, carryPath, location) {
  const components = carryPath.split('/');
  let currentPath = path.resolve(rootPath);
  for (const component of components.slice(0, -1)) {
    currentPath = path.join(currentPath, component);
    const stats = lstatIfPresent(currentPath);
    if (!stats) break;
    if (stats.isSymbolicLink()) {
      throw new Error(`Unsafe carry path traverses a symlink or reparse point in the ${location}: ${carryPath}.`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Unsafe carry path traverses a non-directory in the ${location}: ${carryPath}.`);
    }
  }
}

function trackedPathSetsForCarry(checkoutRoot, carryPaths) {
  const indexPaths = splitNul(git(checkoutRoot, ['--literal-pathspecs', 'ls-files', '-z', '--', ...carryPaths], { trim: false })).sort(compareText);
  const headPaths = splitNul(git(checkoutRoot, ['--literal-pathspecs', 'ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...carryPaths], { trim: false })).sort(compareText);
  const restorePaths = [...new Set([...indexPaths, ...headPaths])].sort(compareText);
  return { restorePaths, headPaths };
}

function restoreTrackedCheckout(checkoutRoot, { restorePaths, headPaths }) {
  if (restorePaths.length > 0) {
    git(checkoutRoot, ['--literal-pathspecs', 'restore', '--source=HEAD', '--staged', '--', ...restorePaths]);
  }
  if (headPaths.length > 0) {
    prepareHeadPathParents(checkoutRoot, headPaths);
    // Deliberately omit --force: a path recreated after the transaction swap
    // must make cleanup fail instead of being overwritten by HEAD content.
    git(checkoutRoot, ['--literal-pathspecs', 'checkout-index', '--', ...headPaths]);
  }
}

function prepareHeadPathParents(checkoutRoot, headPaths) {
  for (const headPath of headPaths) {
    // Validate before mkdir so an already-present junction cannot redirect the
    // directory creation, then validate again before Git writes the leaf.
    assertNoSymlinkAncestors(checkoutRoot, headPath, 'source checkout');
    fs.mkdirSync(path.dirname(resolveInside(checkoutRoot, headPath)), { recursive: true });
    assertNoSymlinkAncestors(checkoutRoot, headPath, 'source checkout');
  }
}

function ignoredCarryEntries(checkoutRoot, carryPaths) {
  const output = git(checkoutRoot, [
    '--literal-pathspecs',
    'status',
    '--porcelain=1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching',
    '--',
    ...carryPaths,
  ], { trim: false });
  return parseGitStatusPorcelain(output).filter((entry) => entry.status === '!!');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function git(cwd, args, options = {}) {
  const output = execFileSync('git', args, { cwd, encoding: 'utf8' });
  return options.trim === false ? output : output.trim();
}

function splitNul(raw) {
  return raw.split('\0').filter(Boolean);
}
