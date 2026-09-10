import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const START_TASK = fileURLToPath(new URL('../../scripts/agent/start-task.mjs', import.meta.url));

test('start-task carries a tracked deletion into the worktree and restores the default checkout', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    fs.rmSync(path.join(checkoutRoot, 'deleted.txt'));

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'deletion-smoke', '--carry', 'deleted.txt'],
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(worktreePath('deletion-smoke'), 'deleted.txt')), false);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'deleted.txt'), 'utf8'), 'baseline\n');
    assert.equal(git(checkoutRoot, ['status', '--porcelain=1']), '');
  });
});

test('start-task rechecks status after GitHub lookup and rejects a cross-boundary rename before side effects', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      mutation: 'cross-boundary-rename',
      args: ['202', '--agent', 'test', '--slug', 'rename-boundary', '--carry', 'outside'],
    });

    assert.notEqual(result.status, 0, 'one-sided rename coverage must fail');
    assert.match(result.stderr, /working tree is dirty/i);
    assert.equal(git(checkoutRoot, ['branch', '--list', 'agent/test/202-rename-boundary']), '');
    assert.equal(fs.existsSync(worktreePath('rename-boundary')), false);
    assert.equal(git(checkoutRoot, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
    assert.equal(fs.existsSync(path.join(checkoutRoot, 'inside', 'name.txt')), false);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'outside', 'name.txt'), 'utf8'), 'rename me\n');
    const status = git(checkoutRoot, ['status', '--porcelain=1']);
    assert.match(status, /^R\s+inside\/name\.txt -> outside\/name\.txt$/);
  });
});

test('start-task rejects a case-only rename before creating a branch or worktree', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    fs.writeFileSync(path.join(checkoutRoot, 'Owner.txt'), 'rename casing\n');
    git(checkoutRoot, ['add', 'Owner.txt']);
    git(checkoutRoot, ['commit', '-m', 'test: add case rename fixture']);
    git(checkoutRoot, ['push', 'origin', 'main']);
    git(checkoutRoot, ['mv', 'Owner.txt', 'owner-temp.txt']);
    git(checkoutRoot, ['mv', 'owner-temp.txt', 'owner.txt']);

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'case-only-rename', '--carry', 'Owner.txt', '--carry', 'owner.txt'],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /case|Unicode|alias/i);
    assert.equal(git(checkoutRoot, ['branch', '--list', 'agent/test/202-case-only-rename']), '');
    assert.equal(fs.existsSync(worktreePath('case-only-rename')), false);
    assert.match(git(checkoutRoot, ['status', '--porcelain=1']), /^R\s+Owner\.txt -> owner\.txt$/);
  });
});

test('start-task rejects a carried symlink before creating a branch or worktree', (context) => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    const targetPath = path.join(checkoutRoot, 'outside', 'keep.txt');
    const linkPath = path.join(checkoutRoot, 'owner-link.txt');
    try {
      fs.symlinkSync(targetPath, linkPath, 'file');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        context.skip(`symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'unsafe-link', '--carry', 'owner-link.txt'],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic link|symlink|junction|reparse/i);
    assert.equal(git(checkoutRoot, ['branch', '--list', 'agent/test/202-unsafe-link']), '');
    assert.equal(fs.existsSync(worktreePath('unsafe-link')), false);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'keep\n');
  });
});

test('start-task rejects a hard-linked carry input before creating a branch or worktree', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    const targetPath = path.join(checkoutRoot, 'outside', 'keep.txt');
    const linkPath = path.join(checkoutRoot, 'owner-hard.txt');
    fs.linkSync(targetPath, linkPath);

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'unsafe-hardlink', '--carry', 'owner-hard.txt'],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /multiple hard links|isolated copy/i);
    assert.equal(git(checkoutRoot, ['branch', '--list', 'agent/test/202-unsafe-hardlink']), '');
    assert.equal(fs.existsSync(worktreePath('unsafe-hardlink')), false);
    assert.equal(fs.lstatSync(targetPath).nlink, 2);
    assert.equal(fs.readFileSync(linkPath, 'utf8'), 'keep\n');
  });
});

test('start-task carry failure guidance preserves both source and destination evidence', () => {
  const source = fs.readFileSync(START_TASK, 'utf8');
  assert.match(source, /Do not overwrite either location/i);
  assert.match(source, /inspect the source checkout/i);
  assert.match(source, /destination worktree/i);
  assert.doesNotMatch(source, /recover the source from there/i);
});

test('start-task rejects carry paths that its own setup steps would overwrite', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    const metadataPath = path.join(checkoutRoot, '.agent', 'current-task.json');
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, '{"owner":"preserve me"}\n');
    fs.appendFileSync(path.join(checkoutRoot, '.git', 'info', 'exclude'), '.agent/current-task.json\n');

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'reserved-output', '--carry', '.agent/current-task.json'],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conflicts with setup-owned output/i);
    assert.equal(fs.readFileSync(metadataPath, 'utf8'), '{"owner":"preserve me"}\n');
    assert.equal(git(checkoutRoot, ['branch', '--list', 'agent/test/202-reserved-output']), '');
    assert.equal(fs.existsSync(worktreePath('reserved-output')), false);
  });
});

test('start-task rejects portable case aliases of setup-owned paths', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    const metadataPath = path.join(checkoutRoot, '.agent', 'current-task.json');
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, '{"owner":"preserve case alias"}\n');
    fs.appendFileSync(path.join(checkoutRoot, '.git', 'info', 'exclude'), '.agent/current-task.json\n');

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'reserved-case', '--carry', '.Agent/current-task.json'],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conflicts with setup-owned output/i);
    assert.equal(fs.readFileSync(metadataPath, 'utf8'), '{"owner":"preserve case alias"}\n');
    assert.equal(fs.existsSync(worktreePath('reserved-case')), false);
  });
});

test('start-task revalidates carry after npm lifecycle scripts before cleaning source', () => {
  withFixture(({ checkoutRoot, ghPreloadPath, worktreePath }) => {
    fs.writeFileSync(path.join(checkoutRoot, 'owner.txt'), 'baseline\n');
    fs.writeFileSync(path.join(checkoutRoot, 'package.json'), JSON.stringify({
      name: 'carry-install-probe',
      version: '1.0.0',
      scripts: {
        install: "node -e \"require('fs').writeFileSync('owner.txt','install overwrite\\n')\"",
      },
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(checkoutRoot, 'package-lock.json'), JSON.stringify({
      name: 'carry-install-probe',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'carry-install-probe',
          version: '1.0.0',
          hasInstallScript: true,
        },
      },
    }, null, 2) + '\n');
    git(checkoutRoot, ['add', 'owner.txt', 'package.json', 'package-lock.json']);
    git(checkoutRoot, ['commit', '-m', 'test: add install probe']);
    git(checkoutRoot, ['push', 'origin', 'main']);
    fs.writeFileSync(path.join(checkoutRoot, 'owner.txt'), 'carried owner bytes\n');

    const result = runStartTask({
      checkoutRoot,
      ghPreloadPath,
      args: ['202', '--agent', 'test', '--slug', 'install-mutation', '--carry', 'owner.txt'],
    });

    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /destination worktree.*changed after carry verification/is);
    assert.equal(fs.readFileSync(path.join(checkoutRoot, 'owner.txt'), 'utf8'), 'carried owner bytes\n');
    assert.equal(
      fs.readFileSync(path.join(worktreePath('install-mutation'), 'owner.txt'), 'utf8'),
      'install overwrite\n',
    );
  });
});

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'start-task-carry-'));
  const checkoutRoot = path.join(root, 'project');
  const originPath = path.join(root, 'origin.git');
  try {
    fs.mkdirSync(checkoutRoot, { recursive: true });
    fs.mkdirSync(path.join(checkoutRoot, 'inside'), { recursive: true });
    fs.mkdirSync(path.join(checkoutRoot, 'outside'), { recursive: true });
    fs.writeFileSync(path.join(checkoutRoot, 'deleted.txt'), 'baseline\n');
    fs.writeFileSync(path.join(checkoutRoot, 'inside', 'name.txt'), 'rename me\n');
    fs.writeFileSync(path.join(checkoutRoot, 'outside', 'keep.txt'), 'keep\n');

    git(checkoutRoot, ['init', '-b', 'main']);
    git(checkoutRoot, ['config', 'user.email', 'start-task-test@example.test']);
    git(checkoutRoot, ['config', 'user.name', 'Start Task Test']);
    git(checkoutRoot, ['config', 'core.autocrlf', 'false']);
    git(checkoutRoot, ['add', '--all']);
    git(checkoutRoot, ['commit', '-m', 'test: baseline']);
    git(root, ['init', '--bare', originPath]);
    git(checkoutRoot, ['remote', 'add', 'origin', originPath]);
    git(checkoutRoot, ['push', '--set-upstream', 'origin', 'main']);
    const ghPreloadPath = writeGhPreload(root);

    run({
      checkoutRoot,
      ghPreloadPath,
      worktreePath: (slug) => path.join(root, `project-202-${slug}`),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

function runStartTask({ checkoutRoot, ghPreloadPath, args, mutation }) {
  const env = { ...process.env };
  env.START_TASK_TEST_REPO = checkoutRoot;
  if (mutation) env.START_TASK_TEST_MUTATION = mutation;
  return spawnSync(process.execPath, ['--import', pathToFileURL(ghPreloadPath).href, START_TASK, ...args], {
    cwd: checkoutRoot,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
}

function writeGhPreload(root) {
  const preloadPath = path.join(root, 'gh-preload.mjs');
  fs.writeFileSync(preloadPath, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const realExecFileSync = childProcess.execFileSync;',
    'childProcess.execFileSync = (command, args = [], options = {}) => {',
    "  if (command !== 'gh') return realExecFileSync(command, args, options);",
    "  if (args[0] === 'issue' && args[1] === 'view') {",
    "    return JSON.stringify({ number: 202, title: 'Carry test', url: 'https://example.test/issues/202', state: 'OPEN' });",
    '  }',
    "  if (args[0] === 'repo' && args[1] === 'view') {",
    "    if (process.env.START_TASK_TEST_MUTATION === 'cross-boundary-rename') {",
    '      const repoRoot = process.env.START_TASK_TEST_REPO;',
    "      fs.renameSync(path.join(repoRoot, 'inside', 'name.txt'), path.join(repoRoot, 'outside', 'name.txt'));",
    "      realExecFileSync('git', ['add', '--all'], { cwd: repoRoot });",
    '    }',
    "    return 'main\\n';",
    '  }',
    "  throw new Error(`Unexpected gh arguments: ${args.join(' ')}`);",
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  return preloadPath;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
