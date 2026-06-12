#!/usr/bin/env bash
#
# install-githooks.sh — Idempotently point this clone at .githooks/.
#
# Sets `core.hooksPath = .githooks` so the commit-msg + pre-commit
# baselines (F18) run for every commit in this repo. Safe to re-run.
#
# Usage:
#   ./.githooks/scripts/install-githooks.sh
#
# Authority: docs/adr/001-primary-checkout-worktree-policy.md and AGENTS.md
# "Owner Maintenance Lane".

set -euo pipefail

# Resolve repo root from this script's location so the install works
# regardless of cwd.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

cd "${repo_root}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[install-githooks] Not inside a git work tree (cwd=${repo_root}); aborting." >&2
    exit 1
fi

target=".githooks"

if [[ ! -d "${target}" ]]; then
    echo "[install-githooks] Expected ${target}/ directory at repo root; aborting." >&2
    exit 1
fi

current="$(git config --get core.hooksPath 2>/dev/null || echo '')"
if [[ "${current}" == "${target}" ]]; then
    echo "[install-githooks] core.hooksPath already set to ${target} — nothing to do."
    exit 0
fi

git config core.hooksPath "${target}"
verified="$(git config --get core.hooksPath)"
if [[ "${verified}" != "${target}" ]]; then
    echo "[install-githooks] Failed to set core.hooksPath (got '${verified}')." >&2
    exit 1
fi

echo "[install-githooks] core.hooksPath = ${target}"
echo "[install-githooks] Hooks active in this clone:"
ls -1 "${target}" | grep -vE '^(scripts|README)' | sed 's/^/  - /'
