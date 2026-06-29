import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Regression for archon-setup#294 / repo-template#128: the baseline .githooks
// shell files must be tracked with the executable bit (git mode 100755). When
// they ship as 100644, `install-githooks.sh` points core.hooksPath at .githooks
// but git skips/cannot exec them on Unix/Linux/mac (CI + non-Windows dev) — the
// commit-msg/pre-commit policy guards silently no-op. git-for-windows runs hooks
// by shebang regardless of mode, which is why the defect is latent. The fix is a
// tracked mode change (`git update-index --chmod=+x`), so it must be locked here
// rather than relying on a filesystem chmod that Windows checkouts cannot carry.
test('every .githooks shell file is tracked executable (100755) (archon-setup#294)', () => {
  const out = execFileSync('git', ['ls-files', '-s', '--', '.githooks'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const nonExecutable = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // `git ls-files -s` format: `<mode> <oid> <stage>\t<path>`.
    const [meta, path] = line.split('\t');
    const mode = meta.split(' ')[0];
    // Hook entrypoints have no extension; helpers end in .sh. Both are executed
    // (directly by git, or sourced/invoked by the entrypoints) and must be +x.
    const isHookEntrypoint = /^\.githooks\/(commit-msg|pre-commit|pre-push|post-merge|post-checkout|prepare-commit-msg)$/.test(path);
    const isShellScript = path.endsWith('.sh');
    if (isHookEntrypoint || isShellScript) {
      if (mode !== '100755') nonExecutable.push(`${mode} ${path}`);
    }
  }

  assert.deepEqual(
    nonExecutable,
    [],
    `these .githooks shell files must be tracked 100755 (run \`git update-index --chmod=+x\`): ${nonExecutable.join(', ')}`,
  );
});
