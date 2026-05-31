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

# --- pre-commit behavior ----------------------------------------------
expect_block() {  # label, dir, [env assignment]
    local label="$1" dir="$2" env_kv="${3:-}"
    if ( cd "${dir}" && env ${env_kv} "${pre_commit_hook}" >/dev/null 2>&1 ); then
        echo "FAIL expected block: ${label}" >&2; exit 1
    fi
}
expect_pass() {  # label, dir, [env assignment]
    local label="$1" dir="$2" env_kv="${3:-}"
    if ! ( cd "${dir}" && env ${env_kv} "${pre_commit_hook}" >/dev/null 2>&1 ); then
        echo "FAIL expected pass: ${label}" >&2; exit 1
    fi
}

# Primary checkout on a feature branch -> blocked.
new_primary_repo "${tmp}/r2"
git_q "${tmp}/r2" switch -c feat/in-primary
printf 'x\n' > "${tmp}/r2/src.txt"; git_q "${tmp}/r2" add src.txt
expect_block "primary+feature" "${tmp}/r2"

# Same, with the documented bypass -> allowed, and the audit log must record it.
expect_pass "primary+feature+bypass" "${tmp}/r2" "ALLOW_PRIMARY_FEATURE_COMMIT=1"
grep -q "ALLOW_PRIMARY_FEATURE_COMMIT" "${tmp}/r2/.agent/bypass.log" \
    || { echo "FAIL: bypass did not write .agent/bypass.log" >&2; exit 1; }

# Linked worktree on a feature branch -> allowed.
new_primary_repo "${tmp}/r3"
git_q "${tmp}/r3" worktree add "${tmp}/r3-wt" -b feat/in-worktree
printf 'x\n' > "${tmp}/r3-wt/src.txt"; git_q "${tmp}/r3-wt" add src.txt
expect_pass "worktree+feature" "${tmp}/r3-wt"

# Primary checkout on default branch, owner-safe path -> allowed (lane intact).
new_primary_repo "${tmp}/r4"
mkdir -p "${tmp}/r4/docs/research"; printf 'n\n' > "${tmp}/r4/docs/research/note.md"
git_q "${tmp}/r4" add docs/research/note.md
expect_pass "primary+default+owner-safe" "${tmp}/r4"

# Primary checkout on default branch, unsafe path -> blocked (existing F18).
new_primary_repo "${tmp}/r5"
printf 'x\n' > "${tmp}/r5/src.txt"; git_q "${tmp}/r5" add src.txt
expect_block "primary+default+unsafe" "${tmp}/r5"

# Unborn branch (fresh repo, first commit) on the default branch with an
# owner-safe path -> allowed. Before the symbolic-ref fix, the unborn branch
# resolved to a doubled "HEAD" string and the worktree guard wrongly blocked
# the very first commit. This is the regression guard for that.
rm -rf "${tmp}/r6"; mkdir -p "${tmp}/r6"
git_q "${tmp}/r6" init -b main
git_q "${tmp}/r6" config user.name "Hook Test"
git_q "${tmp}/r6" config user.email "hook-test@example.invalid"
mkdir -p "${tmp}/r6/docs/research"; printf 'n\n' > "${tmp}/r6/docs/research/note.md"
git_q "${tmp}/r6" add docs/research/note.md
expect_pass "unborn-default-owner-safe" "${tmp}/r6"

echo "checkout-role + pre-commit tests passed"
