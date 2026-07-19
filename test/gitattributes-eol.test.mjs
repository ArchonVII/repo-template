import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function assertLfOnly(file) {
  const body = fs.readFileSync(file, 'utf8');
  assert.match(body, /\n/, `${file} should contain line endings`);
  assert.doesNotMatch(body, /\r/, `${file} should contain LF line endings only`);
}

function assertCrlfOnly(file) {
  const body = fs.readFileSync(file, 'utf8');
  assert.match(body, /\r\n/, `${file} should contain CRLF line endings`);
  assert.doesNotMatch(body.replaceAll('\r\n', ''), /[\r\n]/, `${file} should contain CRLF line endings only`);
}

test('gitattributes keep working-tree line endings deterministic with core.autocrlf=true', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-template-eol-'));
  const seed = path.join(tempRoot, 'seed');
  const checkout = path.join(tempRoot, 'checkout');

  try {
    fs.mkdirSync(seed);
    git(seed, ['init', '-b', 'main']);
    git(seed, ['config', 'user.email', 'eol-test@example.test']);
    git(seed, ['config', 'user.name', 'EOL Test']);
    git(seed, ['config', 'core.autocrlf', 'false']);

    fs.copyFileSync(path.join(ROOT, '.gitattributes'), path.join(seed, '.gitattributes'));
    fs.mkdirSync(path.join(seed, '.githooks'));
    for (const [relativePath, body] of [
      ['README.md', 'first\nsecond\n'],
      ['script.mjs', 'export const value = 1;\nexport default value;\n'],
      ['script.sh', '#!/usr/bin/env bash\necho ok\n'],
      ['.githooks/pre-commit', '#!/usr/bin/env bash\nexit 0\n'],
      ['script.ps1', "Write-Output 'first'\nWrite-Output 'second'\n"],
      ['script.bat', '@echo off\necho ok\n'],
      ['script.cmd', '@echo off\necho ok\n'],
    ]) {
      fs.writeFileSync(path.join(seed, relativePath), body);
    }

    git(seed, ['add', '.']);
    git(seed, ['commit', '-m', 'test: seed line endings']);
    git(tempRoot, ['-c', 'core.autocrlf=true', 'clone', seed, checkout]);

    assert.equal(
      git(checkout, ['-c', 'core.autocrlf=true', 'status', '--porcelain=1']),
      '',
      'fresh checkout should be clean',
    );

    for (const relativePath of ['.gitattributes', 'README.md', 'script.mjs', 'script.sh', '.githooks/pre-commit']) {
      assertLfOnly(path.join(checkout, relativePath));
    }
    for (const relativePath of ['script.ps1', 'script.bat', 'script.cmd']) {
      assertCrlfOnly(path.join(checkout, relativePath));
    }

    fs.appendFileSync(path.join(checkout, 'script.mjs'), 'export const next = 2;\n');
    assertLfOnly(path.join(checkout, 'script.mjs'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
