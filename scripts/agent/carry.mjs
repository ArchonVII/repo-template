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
      entries.push({ path: relativePath, type: 'symlink', target: fs.readlinkSync(absolutePath) });
      return;
    }
    if (stats.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory' });
      for (const name of fs.readdirSync(absolutePath).sort()) {
        walk(path.join(absolutePath, name), relativePath === '.' ? name : `${relativePath}/${name}`);
      }
      return;
    }
    if (stats.isFile()) {
      entries.push({
        path: relativePath,
        type: 'file',
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
  const sourceManifest = buildPathManifest(sourcePath);
  let destinationManifest;
  try {
    destinationManifest = buildPathManifest(destinationPath);
  } catch (error) {
    throw new Error(`Carry verification failed for ${sourcePath}: ${error.message}`);
  }
  if (JSON.stringify(sourceManifest) !== JSON.stringify(destinationManifest)) {
    throw new Error(`Carry verification failed for ${sourcePath}: destination content differs; source was not cleaned.`);
  }
}

export function copyCarryPathsAndVerify({ checkoutRoot, worktreePath, carryPaths }) {
  for (const carryPath of carryPaths) {
    const sourcePath = resolveInside(checkoutRoot, carryPath);
    const destinationPath = resolveInside(worktreePath, carryPath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.rmSync(destinationPath, { recursive: true, force: true });
    const stats = fs.lstatSync(sourcePath);
    if (stats.isDirectory()) {
      fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true, verbatimSymlinks: true });
    } else if (stats.isFile() || stats.isSymbolicLink()) {
      fs.cpSync(sourcePath, destinationPath, { force: true, verbatimSymlinks: true });
    } else {
      throw new Error(`Unsupported carry path type: ${sourcePath}`);
    }
    assertPathCopiesMatch(sourcePath, destinationPath);
  }
}

export function removeCarrySources({ checkoutRoot, carryPaths }) {
  for (const carryPath of [...carryPaths].sort((left, right) => right.length - left.length)) {
    fs.rmSync(resolveInside(checkoutRoot, carryPath), { recursive: true, force: true });
  }
}

export function cleanupVerifiedCarry({ checkoutRoot, carryPaths }) {
  const restorePaths = trackedPathsForCarry(checkoutRoot, carryPaths);
  removeCarrySources({ checkoutRoot, carryPaths });
  if (restorePaths.length > 0) {
    git(checkoutRoot, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...restorePaths]);
  }
  const remaining = parseGitStatusPorcelain(git(checkoutRoot, [...PRECISE_STATUS_ARGS], { trim: false }));
  if (remaining.length > 0) {
    throw new Error(`Invoking checkout remains dirty after carry cleanup: ${remaining.slice(0, 3).map((entry) => entry.path).join(', ')}`);
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

function trackedPathsForCarry(checkoutRoot, carryPaths) {
  const current = splitNul(git(checkoutRoot, ['ls-files', '-z', '--', ...carryPaths], { trim: false }));
  const atHead = splitNul(git(checkoutRoot, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...carryPaths], { trim: false }));
  return [...new Set([...current, ...atHead])].sort();
}

function git(cwd, args, options = {}) {
  const output = execFileSync('git', args, { cwd, encoding: 'utf8' });
  return options.trim === false ? output : output.trim();
}

function splitNul(raw) {
  return raw.split('\0').filter(Boolean);
}
