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
      throw new Error(`Verified carry does not support symbolic links, junctions, or reparse-point links: ${absolutePath}.`);
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

export function preflightCarryPlan({ checkoutRoot, worktreePath, carryPaths, statusEntries = [] }) {
  assertNoPortableRenameAliases(statusEntries);
  const normalizedPaths = normalizeCarryPathList({ checkoutRoot, carryPaths });
  const checkoutPhysical = fs.realpathSync.native(path.resolve(checkoutRoot));
  const worktreeParentPhysical = fs.realpathSync.native(path.dirname(path.resolve(worktreePath)));
  const worktreePhysical = path.join(worktreeParentPhysical, path.basename(path.resolve(worktreePath)));
  if (sameOrNestedRoot(checkoutPhysical, worktreePhysical)
    || sameOrNestedRoot(worktreePhysical, checkoutPhysical)) {
    throw new Error('The source checkout and destination worktree must be distinct, non-nested directories.');
  }
  const checkoutDevice = fs.lstatSync(checkoutPhysical, { bigint: true }).dev.toString();
  const worktreeParentDevice = fs.lstatSync(worktreeParentPhysical, { bigint: true }).dev.toString();
  if (checkoutDevice !== worktreeParentDevice) {
    throw new Error('Verified carry requires the source checkout and task worktree to share one filesystem; choose a sibling worktree on the same volume.');
  }

  const entries = normalizedPaths.map((carryPath) => {
    assertNoSymlinkAncestors(checkoutPhysical, carryPath, 'source checkout');
    const sourcePath = resolveInside(checkoutPhysical, carryPath);
    if (!lstatIfPresent(sourcePath)) {
      return { path: carryPath, state: { exists: false, manifest: null }, identities: [] };
    }
    const identities = buildIdentityManifest(sourcePath, carryPath);
    return { path: carryPath, state: capturePathState(sourcePath), identities };
  });
  return deepFreeze({
    schemaVersion: 1,
    checkoutRoot: checkoutPhysical,
    worktreePath: worktreePhysical,
    checkoutDevice,
    worktreeParentDevice,
    entries,
  });
}

function assertNoPortableRenameAliases(statusEntries) {
  for (const entry of statusEntries ?? []) {
    if (!String(entry?.status ?? '').includes('R') || !entry.originalPath || !entry.path) continue;
    if (portableComparisonPath(entry.originalPath) === portableComparisonPath(entry.path)
      && entry.originalPath !== entry.path) {
      throw new Error(
        `Case- or Unicode-normalization-only renames cannot be carried safely: ${entry.originalPath} -> ${entry.path}. `
        + 'Revert the rename in the default checkout, start the task, and recreate the rename inside the task worktree.',
      );
    }
  }
}

function buildIdentityManifest(rootPath, carryPath) {
  const entries = [];
  walk(rootPath, '.');
  return entries;

  function walk(absolutePath, relativePath) {
    const stats = fs.lstatSync(absolutePath, { bigint: true });
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Carry preflight rejects symbolic links, junctions, and reparse-point links: ${carryPath}`
        + (relativePath === '.' ? '' : ` (${relativePath})`)
        + '. Replace the link with an isolated regular file or directory before retrying.',
      );
    }
    if (stats.isDirectory()) {
      entries.push(identityEntry(relativePath, 'directory', stats));
      for (const name of fs.readdirSync(absolutePath).sort(compareText)) {
        walk(path.join(absolutePath, name), relativePath === '.' ? name : `${relativePath}/${name}`);
      }
      return;
    }
    if (stats.isFile()) {
      if (stats.nlink !== 1n) {
        throw new Error(
          `Carry preflight rejects regular files with multiple hard links: ${carryPath}`
          + (relativePath === '.' ? '' : ` (${relativePath})`)
          + '. Replace it with an isolated copy before retrying.',
        );
      }
      entries.push(identityEntry(relativePath, 'file', stats));
      return;
    }
    throw new Error(`Unsupported carry path type: ${absolutePath}`);
  }
}

function identityEntry(relativePath, type, stats) {
  return {
    path: relativePath,
    type,
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    links: stats.nlink.toString(),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function carryPlanDigest(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function validateCarryPlan({ plan, checkoutRoot, worktreePath, carryPaths, statusEntries = [] }) {
  if (!plan || plan.schemaVersion !== 1 || !Array.isArray(plan.entries)) {
    throw new Error('Carry requires the immutable preflight plan created before task-lane setup.');
  }
  const actual = preflightCarryPlan({ checkoutRoot, worktreePath, carryPaths, statusEntries });
  if (carryPlanDigest(plan) !== carryPlanDigest(actual)) {
    throw new Error('Carry path changed after carry verification; preflight state no longer matches and the source/task lane were left unchanged.');
  }
  return actual;
}

export function copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths, plan }) {
  const validatedPlan = validateCarryPlan({ plan, checkoutRoot, worktreePath, carryPaths });
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
      assertRegularFilesAreIsolated(destinationPath, state, carryPath, 'destination worktree');
      entries.push({ path: carryPath, state });
      continue;
    } else if (stats.isFile() || stats.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.rmSync(destinationPath, { recursive: true, force: true });
      // A fresh copy deliberately breaks any hard-link relationship with the
      // protected checkout or with another carried path.
      fs.cpSync(sourcePath, destinationPath, { force: true, verbatimSymlinks: true });
    } else {
      throw new Error(`Unsupported carry path type: ${sourcePath}`);
    }
    const state = capturePathState(sourcePath);
    assertPathStateMatches(destinationPath, state, carryPath, 'destination worktree');
    assertRegularFilesAreIsolated(destinationPath, state, carryPath, 'destination worktree');
    entries.push({ path: carryPath, state });
  }
  return {
    schemaVersion: 3,
    entries,
    indexFingerprint: captureIndexFingerprint(checkoutRoot, normalizedPaths),
    planDigest: carryPlanDigest(validatedPlan),
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

export function cleanupVerifiedCarry({ checkoutRoot, worktreePath, carryPaths, receipt, plan }) {
  const normalizedPaths = normalizeCarryPaths({ checkoutRoot, worktreePath, carryPaths });
  const validatedPlan = validateCarryPlan({ plan, checkoutRoot, worktreePath, carryPaths });
  const { entries, indexFingerprint } = validateReceipt(receipt, normalizedPaths, validatedPlan);
  assertIndexStateRepresentedInWorktree(checkoutRoot, normalizedPaths);
  assertIndexFingerprintMatches(checkoutRoot, normalizedPaths, indexFingerprint);
  verifyReceiptState({ checkoutRoot, worktreePath, entries });
  const trackedPaths = trackedPathSetsForCarry(checkoutRoot, normalizedPaths);
  assertTrackedRestoreGitVersion(checkoutRoot, trackedPaths.restorePaths);
  const transfer = transferCarrySources({ checkoutRoot, worktreePath, entries, plan: validatedPlan });
  let restoreStarted = false;
  try {
    verifyTransferredState({ checkoutRoot, worktreePath, entries, moved: transfer.moved });
    assertIndexFingerprintMatches(checkoutRoot, normalizedPaths, indexFingerprint);
    restoreStarted = true;
    restoreTrackedCheckout(checkoutRoot, trackedPaths);
    restoreSourceModes(checkoutRoot, entries, trackedPaths.headEntries);
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
    promoteTransferredSources({ worktreePath, entries, transfer });
    verifyPromotedSources({ worktreePath, entries, transfer });
    disposeVerifiedTransaction(transfer);
  } catch (error) {
    // Git can restore a batch only partially. Once that starts, automatic
    // rollback could overwrite a path recreated during the restore; retain all
    // source/destination/transaction locations for explicit recovery instead.
    const recovery = restoreStarted
      ? describeRetainedRecovery(transfer)
      : rollbackTransfer(transfer);
    throw new Error(`${error.message}${recovery}`);
  }
}

function disposeVerifiedTransaction(transfer) {
  try {
    removePrivateTreeNoFollow(transfer.transactionRoot);
  } catch (error) {
    const survivors = [];
    for (const item of transfer.moved) {
      if (lstatIfPresent(item.sourceBackupPath)) survivors.push(item.sourceBackupPath);
      if (lstatIfPresent(item.destinationCopyBackupPath)) survivors.push(item.destinationCopyBackupPath);
    }
    if (lstatIfPresent(transfer.transactionRoot) && survivors.length === 0) {
      survivors.push(transfer.transactionRoot);
    }
    console.warn(
      `[verified-carry] Carry completed, but redundant transaction cleanup was incomplete (${error.code || error.message}). `
      + `The promoted task data and restored source checkout are complete. Cleanup residue remains at: ${survivors.join(', ')}.`,
    );
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
    assertRegularFilesAreIsolated(destinationPath, state, carryPath, 'destination worktree');

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
    chmodDirectoryNoFollow(directoryPath, entry.mode);
  }
}

function restoreSourceModes(checkoutRoot, entries, headEntries) {
  const headPaths = headEntries.map((entry) => entry.path);
  restoreSourceDirectoryModes(checkoutRoot, entries, headPaths);
  const headModes = new Map(headEntries.map((entry) => [entry.path, entry.mode]));
  for (const entry of entries) {
    if (!entry.state.exists) continue;
    for (const manifestEntry of entry.state.manifest) {
      if (manifestEntry.type !== 'file') continue;
      const repoPath = manifestEntry.path === '.'
        ? entry.path
        : `${entry.path}/${manifestEntry.path}`;
      const headMode = headModes.get(repoPath);
      if (headMode !== '100644' && headMode !== '100755') continue;
      assertNoSymlinkAncestors(checkoutRoot, repoPath, 'source checkout');
      chmodFileNoFollow(
        resolveInside(checkoutRoot, repoPath),
        deriveRestoredFileMode(manifestEntry.mode, headMode),
      );
    }
  }
}

function restoreSourceDirectoryModes(checkoutRoot, entries, headPaths) {
  if (process.platform === 'win32') return;
  for (const entry of entries) {
    if (!entry.state.exists || entry.state.manifest?.[0]?.type !== 'directory') continue;
    const planned = entry.state.manifest
      .filter((manifestEntry) => manifestEntry.type === 'directory')
      .map((manifestEntry) => ({
        ...manifestEntry,
        repoPath: manifestEntry.path === '.'
          ? entry.path
          : `${entry.path}/${manifestEntry.path}`,
      }))
      .filter((manifestEntry) => headPaths.some((headPath) => headPath.startsWith(`${manifestEntry.repoPath}/`)))
      .sort((left, right) => directoryDepth(right.repoPath) - directoryDepth(left.repoPath)
        || compareText(left.repoPath, right.repoPath));
    for (const directory of planned) {
      assertNoSymlinkAncestors(checkoutRoot, directory.repoPath, 'source checkout');
      chmodDirectoryNoFollow(resolveInside(checkoutRoot, directory.repoPath), directory.mode);
    }
  }
}

export function deriveRestoredFileMode(carriedMode, headMode, platform = process.platform) {
  if (platform === 'win32') return carriedMode;
  return (carriedMode & ~0o111) | (headMode === '100755' ? 0o100 : 0);
}

function chmodFileNoFollow(filePath, mode) {
  const { O_RDONLY, O_NOFOLLOW } = fs.constants;
  if (process.platform !== 'win32' && Number.isInteger(O_NOFOLLOW)) {
    const descriptor = fs.openSync(filePath, O_RDONLY | O_NOFOLLOW);
    try {
      const before = fs.fstatSync(descriptor);
      if (!before.isFile() || before.isSymbolicLink?.()) {
        throw new Error(`Carry destination changed while restoring a regular-file mode: ${filePath}.`);
      }
      if ((before.mode & 0o7777) !== mode) fs.fchmodSync(descriptor, mode);
      const restored = fs.fstatSync(descriptor);
      if (!restored.isFile() || (restored.mode & 0o7777) !== mode) {
        throw new Error(`Carry source regular-file mode was not restored: ${filePath}.`);
      }
    } finally {
      fs.closeSync(descriptor);
    }
    return;
  }

  if (process.platform !== 'win32') {
    throw new Error(`Safe no-follow regular-file mode restoration is unavailable: ${filePath}.`);
  }
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Carry destination changed while restoring a regular-file mode: ${filePath}.`);
  }
  if ((stats.mode & 0o7777) !== mode) fs.chmodSync(filePath, mode);
  const restored = fs.lstatSync(filePath);
  if (!restored.isFile() || restored.isSymbolicLink() || (restored.mode & 0o7777) !== mode) {
    throw new Error(`Carry source regular-file mode was not restored: ${filePath}.`);
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
      const before = fs.fstatSync(descriptor);
      if (!before.isDirectory()) {
        throw new Error(`Carry destination changed while restoring a directory mode: ${directoryPath}.`);
      }
      if ((before.mode & 0o7777) !== mode) fs.fchmodSync(descriptor, mode);
      const restored = fs.fstatSync(descriptor);
      if (!restored.isDirectory() || (restored.mode & 0o7777) !== mode) {
        throw new Error(`Carry destination directory mode was not restored: ${directoryPath}.`);
      }
    } finally {
      fs.closeSync(descriptor);
    }
    return;
  }

  if (process.platform !== 'win32') {
    throw new Error(`Safe no-follow directory mode restoration is unavailable: ${directoryPath}.`);
  }

  // Windows does not expose portable Unix directory modes. Reject a
  // reparse-point swap immediately before applying the best available check.
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Carry destination changed while restoring a directory mode: ${directoryPath}.`);
  }
  if ((stats.mode & 0o7777) !== mode) fs.chmodSync(directoryPath, mode);
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

function assertRegularFilesAreIsolated(rootPath, expectedState, carryPath, location) {
  if (!expectedState.exists) return;
  for (const entry of expectedState.manifest) {
    if (entry.type !== 'file') continue;
    const filePath = entry.path === '.'
      ? rootPath
      : path.join(rootPath, ...entry.path.split('/'));
    assertNoSymlinkAncestors(rootPath, entry.path, location);
    const stats = fs.lstatSync(filePath, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw new Error(`Carry destination regular file is not isolated from hard links: ${carryPath} (${location}, ${entry.path}).`);
    }
  }
}

function validateReceipt(receipt, normalizedPaths, plan) {
  if (receipt?.schemaVersion !== 3
    || !Array.isArray(receipt.entries)
    || !/^[a-f0-9]{64}$/.test(receipt.indexFingerprint ?? '')
    || receipt.planDigest !== carryPlanDigest(plan)) {
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
    const destinationPath = resolveInside(worktreePath, entry.path);
    assertPathStateMatches(destinationPath, entry.state, entry.path, 'destination worktree');
    assertRegularFilesAreIsolated(destinationPath, entry.state, entry.path, 'destination worktree');
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

function transferCarrySources({ checkoutRoot, worktreePath, entries, plan }) {
  const transactionRoot = fs.mkdtempSync(path.join(
    path.dirname(checkoutRoot),
    `.${path.basename(checkoutRoot)}-carry-cleanup-`,
  ));
  const sourceBackupRoot = path.join(transactionRoot, 'source');
  const destinationCopyRoot = path.join(transactionRoot, 'destination-copy');
  const planByPath = new Map(plan.entries.map((entry) => [entry.path, entry]));
  const moved = [];
  try {
    for (const entry of entries) {
      assertNoSymlinkAncestors(checkoutRoot, entry.path, 'source checkout');
      assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
      const sourcePath = resolveInside(checkoutRoot, entry.path);
      const destinationPath = resolveInside(worktreePath, entry.path);
      const sourceBackupPath = resolveInside(sourceBackupRoot, entry.path);
      const destinationCopyBackupPath = resolveInside(destinationCopyRoot, entry.path);
      const item = {
        ...entry,
        planEntry: planByPath.get(entry.path),
        sourcePath,
        destinationPath,
        sourceBackupPath,
        destinationCopyBackupPath,
        sourceMoved: false,
        destinationCopyBackedUp: false,
        originalPromoted: false,
      };
      moved.push(item);
      if (lstatIfPresent(sourcePath)) {
        fs.mkdirSync(path.dirname(sourceBackupPath), { recursive: true });
        fs.renameSync(sourcePath, sourceBackupPath);
        item.sourceMoved = true;
      }
    }
    return { transactionRoot, moved, checkoutRoot, worktreePath };
  } catch (error) {
    const recovery = rollbackTransfer({ transactionRoot, moved, checkoutRoot });
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
      ? capturePathState(item.sourceBackupPath)
      : { exists: false, manifest: null };
    if (!pathStatesMatch(transferredState, entry.state)) {
      throw new Error(`Carry path changed after carry verification: ${entry.path} (transferred source).`);
    }
    if (item.sourceMoved) assertIdentityManifestMatches(item.sourceBackupPath, item.planEntry.identities, entry.path, 'transferred source');
    const destinationState = capturePathState(item.destinationPath);
    if (!pathStatesMatch(destinationState, entry.state)) {
      throw new Error(`Carry destination changed after carry verification: ${entry.path} (destination worktree).`);
    }
  }
}

function verifyTransactionBackups(entries, moved) {
  const movedByPath = new Map(moved.map((item) => [item.path, item]));
  for (const entry of entries) {
    const item = movedByPath.get(entry.path);
    const backupState = item.sourceMoved
      ? capturePathState(item.sourceBackupPath)
      : { exists: false, manifest: null };
    if (!pathStatesMatch(backupState, entry.state)) {
      throw new Error(`Carried source changed during cleanup: ${entry.path} (transaction backup).`);
    }
    if (item.sourceMoved) assertIdentityManifestMatches(item.sourceBackupPath, item.planEntry.identities, entry.path, 'transaction backup');
  }
}

function promoteTransferredSources({ worktreePath, entries, transfer }) {
  const movedByPath = new Map(transfer.moved.map((item) => [item.path, item]));
  for (const entry of entries) {
    const item = movedByPath.get(entry.path);
    if (!entry.state.exists) continue;
    if (!item.sourceMoved || !lstatIfPresent(item.sourceBackupPath)) {
      throw new Error(`Original carried object is missing before destination promotion: ${entry.path}.`);
    }
    assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
    assertPathStateMatches(item.destinationPath, entry.state, entry.path, 'verified destination copy');
    assertRegularFilesAreIsolated(item.destinationPath, entry.state, entry.path, 'verified destination copy');
    fs.mkdirSync(path.dirname(item.destinationCopyBackupPath), { recursive: true });
    fs.renameSync(item.destinationPath, item.destinationCopyBackupPath);
    item.destinationCopyBackedUp = true;
    fs.renameSync(item.sourceBackupPath, item.destinationPath);
    item.originalPromoted = true;
    assertPathStateMatches(item.destinationPath, entry.state, entry.path, 'promoted original');
    assertIdentityManifestMatches(item.destinationPath, item.planEntry.identities, entry.path, 'promoted original');
  }
}

function verifyPromotedSources({ worktreePath, entries, transfer }) {
  const movedByPath = new Map(transfer.moved.map((item) => [item.path, item]));
  for (const entry of entries) {
    const item = movedByPath.get(entry.path);
    if (!entry.state.exists) {
      if (lstatIfPresent(item.destinationPath)) {
        throw new Error(`Carried deletion reappeared during promotion: ${entry.path}.`);
      }
      continue;
    }
    assertNoSymlinkAncestors(worktreePath, entry.path, 'destination worktree');
    if (!item.originalPromoted || !item.destinationCopyBackedUp) {
      throw new Error(`Carry promotion did not complete for ${entry.path}.`);
    }
    assertPathStateMatches(item.destinationPath, entry.state, entry.path, 'promoted original');
    assertIdentityManifestMatches(item.destinationPath, item.planEntry.identities, entry.path, 'promoted original');
    assertPathStateMatches(item.destinationCopyBackupPath, entry.state, entry.path, 'verified destination backup');
    assertRegularFilesAreIsolated(item.destinationCopyBackupPath, entry.state, entry.path, 'verified destination backup');
  }
}

function assertIdentityManifestMatches(rootPath, expected, carryPath, location) {
  const actual = buildIdentityManifest(rootPath, carryPath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Carry filesystem identity changed after preflight: ${carryPath} (${location}).`);
  }
}

function describeRetainedRecovery(transfer) {
  const locations = [];
  for (const item of transfer.moved) {
    if (!item.state.exists) {
      locations.push(`${item.path}: carried deletion remains absent in the task; inspect ${item.sourcePath}`);
    } else if (item.originalPromoted) {
      locations.push(`${item.path}: original at ${item.destinationPath}; verified copy at ${item.destinationCopyBackupPath}`);
    } else if (item.destinationCopyBackedUp) {
      locations.push(`${item.path}: original at ${item.sourceBackupPath}; verified copy at ${item.destinationCopyBackupPath}`);
    } else {
      locations.push(`${item.path}: original at ${item.sourceBackupPath}; verified copy at ${item.destinationPath}`);
    }
  }
  return ` Carry cleanup stopped after source restoration. No recovery copy was deleted. ${locations.join('; ')}. `
    + `Transaction state remains at ${transfer.transactionRoot}; the source checkout requires inspection before manual cleanup.`;
}

function rollbackTransfer({ transactionRoot, moved, checkoutRoot }) {
  const problems = [];
  for (const item of [...moved].reverse()) {
    const sourceSafe = rollbackPathIsSafe(checkoutRoot, item.path, 'source checkout', problems);
    if (item.sourceMoved) {
      if (!sourceSafe) {
        // Preserve the source backup in place when an ancestor could redirect a rename.
      } else if (!lstatIfPresent(item.sourceBackupPath)) {
        problems.push(`${item.path} (transferred source missing)`);
      } else if (lstatIfPresent(item.sourcePath)) {
        problems.push(`${item.path} (source path reappeared)`);
      } else {
        try {
          fs.mkdirSync(path.dirname(item.sourcePath), { recursive: true });
          fs.renameSync(item.sourceBackupPath, item.sourcePath);
        } catch (error) {
          problems.push(`${item.path} (source restore failed: ${error.code || error.message})`);
        }
      }
    }
  }
  if (problems.length === 0) {
    try {
      removePrivateTreeNoFollow(transactionRoot);
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
    const state = capturePathState(item.destinationPath);
    if (!pathStatesMatch(state, entry.state)) {
      throw new Error(`Carry path changed after carry verification: ${entry.path} (destination changed during cleanup).`);
    }
    assertRegularFilesAreIsolated(item.destinationPath, entry.state, entry.path, 'destination worktree');
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
  const paths = normalizeCarryPathList({ checkoutRoot, carryPaths });
  for (const carryPath of paths) {
    assertNoSymlinkAncestors(checkoutRoot, carryPath, 'source checkout');
    assertNoSymlinkAncestors(worktreePath, carryPath, 'destination worktree');
  }
  return paths;
}

function normalizeCarryPathList({ checkoutRoot, carryPaths }) {
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
    const comparisonPath = portableComparisonPath(relativePath);
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
        throw new Error(
          `Carry paths contain duplicate or case-aliased/Unicode-normalization-aliased entries: ${earlier.path}, ${current.path}. `
          + 'Case-only renames must be reverted in the default checkout and recreated inside the task worktree.',
        );
      }
      if (current.comparisonPath.startsWith(`${earlier.comparisonPath}/`)
        || earlier.comparisonPath.startsWith(`${current.comparisonPath}/`)) {
        throw new Error(`Carry paths may not overlap: ${earlier.path}, ${current.path}.`);
      }
    }
  }

  return normalized.map((entry) => entry.path);
}

function portableComparisonPath(relativePath) {
  return String(relativePath)
    .replace(/\\/g, '/')
    .split('/')
    .map((component) => component.normalize('NFC').toLowerCase().normalize('NFC'))
    .join('/');
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
  const headEntries = parseHeadTreeEntries(git(checkoutRoot, ['--literal-pathspecs', 'ls-tree', '-r', '-z', 'HEAD', '--', ...carryPaths], { trim: false }));
  const headPaths = headEntries.map((entry) => entry.path).sort(compareText);
  const restorePaths = [...new Set([...indexPaths, ...headPaths])].sort(compareText);
  return { restorePaths, headPaths, headEntries };
}

function parseHeadTreeEntries(output) {
  return splitNul(output).map((record) => {
    const match = /^(\d{6})\s+\S+\s+[0-9a-f]+\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error(`Could not parse HEAD tree entry for verified carry: ${record}`);
    return { mode: match[1], path: match[2] };
  }).sort((left, right) => compareText(left.path, right.path));
}

function assertTrackedRestoreGitVersion(checkoutRoot, restorePaths) {
  if (restorePaths.length === 0) return;
  const versionOutput = git(checkoutRoot, ['--version']);
  const match = /^git version (\d+)\.(\d+)(?:\.\d+)?/i.exec(versionOutput);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (!match || major < 2 || (major === 2 && minor < 25)) {
    throw new Error(
      `Verified carry cleanup for tracked paths requires Git 2.25 or newer; found ${versionOutput || 'an unknown version'}. Source and destination were left unchanged.`,
    );
  }
}

function restoreTrackedCheckout(checkoutRoot, { restorePaths, headPaths }) {
  if (restorePaths.length > 0) {
    git(checkoutRoot, [
      '--literal-pathspecs',
      'restore',
      '--source=HEAD',
      '--staged',
      '--pathspec-from-file=-',
      '--pathspec-file-nul',
    ], { input: nulTerminatedPaths(restorePaths) });
  }
  if (headPaths.length > 0) {
    prepareHeadPathParents(checkoutRoot, headPaths);
    // Deliberately omit --force: a path recreated after the transaction swap
    // must make cleanup fail instead of being overwritten by HEAD content.
    git(checkoutRoot, [
      '--literal-pathspecs',
      'checkout-index',
      '-u',
      '--stdin',
      '-z',
    ], { input: nulTerminatedPaths(headPaths) });
  }
}

function nulTerminatedPaths(paths) {
  return Buffer.from(`${paths.join('\0')}\0`, 'utf8');
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
  const execOptions = { cwd, encoding: 'utf8' };
  if (Object.hasOwn(options, 'input')) execOptions.input = options.input;
  const output = execFileSync('git', args, execOptions);
  return options.trim === false ? output : output.trim();
}

function splitNul(raw) {
  return raw.split('\0').filter(Boolean);
}
