#!/usr/bin/env bash
#
# checkout-doctor.sh — print this checkout's role and what the worktree guard
# allows here. Read-only orientation aid before committing.
#
# Usage:
#   bash .githooks/scripts/checkout-doctor.sh
#
# Authority: docs/adr/001-primary-checkout-worktree-policy.md (F19).

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.githooks/scripts/checkout-role.sh
source "${script_dir}/checkout-role.sh"

branch="$(git symbolic-ref --short -q HEAD || echo HEAD)"
default_branch="$(checkout_default_branch)"
hooks_path="$(git config --get core.hooksPath 2>/dev/null || echo '(unset)')"

if checkout_is_primary; then
    role="primary"
    if [[ "${branch}" == "${default_branch}" ]]; then
        feature_commits="blocked (owner-maintenance safe paths only)"
    else
        feature_commits="blocked — create a worktree: git worktree add"
    fi
else
    role="linked worktree"
    if [[ "${branch}" == "${default_branch}" ]]; then
        feature_commits="blocked (owner-maintenance safe paths only; default branch in a worktree is unusual)"
    else
        feature_commits="allowed"
    fi
fi

printf 'Checkout role:   %s\n' "${role}"
printf 'Current branch:  %s\n' "${branch}"
printf 'Default branch:  %s\n' "${default_branch}"
printf 'Hooks path:      %s\n' "${hooks_path}"
printf 'Feature commits: %s\n' "${feature_commits}"
