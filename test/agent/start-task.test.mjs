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
