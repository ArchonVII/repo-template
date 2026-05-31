#!/usr/bin/env bash
#
# Verification harness for the checkout-role worktree guard.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

pre_commit_hook="${repo_root}/.githooks/pre-commit"
role_lib="${repo_root}/.githooks/scripts/checkout-role.sh"

git_q() { git -C "$1" "${@:2}" >/dev/null 2>&1; }

new_primary_repo() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}"
    git_q "${dir}" init -b main
    git_q "${dir}" config user.name "Hook Test"
    git_q "${dir}" config user.email "hook-test@example.invalid"
    printf 'base\n' > "${dir}/README.md"
    git_q "${dir}" add README.md
    git_q "${dir}" commit -m "docs: seed (#1)" --no-verify
}

# --- checkout-role.sh predicates --------------------------------------
new_primary_repo "${tmp}/repo"
# shellcheck source=/dev/null
( cd "${tmp}/repo" && source "${role_lib}" && checkout_is_primary ) \
    || { echo "FAIL: primary checkout not detected as primary" >&2; exit 1; }

( cd "${tmp}/repo" && source "${role_lib}" && [ "$(checkout_default_branch)" = "main" ] ) \
    || { echo "FAIL: default branch should resolve to main" >&2; exit 1; }

git_q "${tmp}/repo" worktree add "${tmp}/wt" -b feat/x
( cd "${tmp}/wt" && source "${role_lib}" && ! checkout_is_primary ) \
    || { echo "FAIL: linked worktree detected as primary" >&2; exit 1; }

echo "checkout-role predicate tests passed"
