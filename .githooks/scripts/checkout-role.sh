#!/usr/bin/env bash
#
# Shared checkout-role predicates for the repo-template hooks (worktree guard).
#
# Distinguishes the primary checkout from a linked worktree and resolves the
# repository's default branch, so pre-commit can keep the primary checkout on
# the default branch and push feature work into linked worktrees.
#
# Authority: docs/adr/001-primary-checkout-worktree-policy.md (F19).

# checkout_is_primary: 0 (true) in the primary checkout, 1 in a linked worktree.
#
# A linked worktree has a per-worktree git dir (.git/worktrees/<name>) that
# differs from the shared common dir; in the primary checkout they are the same
# path. Both are resolved to absolute form so the comparison is format-stable.
# (git rev-parse --absolute-git-dir: git >= 2.13; --path-format: git >= 2.31.)
checkout_is_primary() {
    local git_dir common_dir
    git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || echo '')"
    common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo '')"
    [[ -n "${git_dir}" && "${git_dir}" == "${common_dir}" ]]
}

# checkout_default_branch: echo the repo's default branch.
#
# Prefer the remote HEAD pointer (set on most clones). Fresh local repos and
# some clones lack refs/remotes/origin/HEAD, so fall back to the first of
# main/master that exists — matching the allowlist the existing hooks use —
# and finally to "main".
checkout_default_branch() {
    local ref candidate
    ref="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo '')"
    if [[ -n "${ref}" ]]; then
        printf '%s\n' "${ref#origin/}"
        return 0
    fi
    for candidate in main master; do
        if git show-ref --verify --quiet "refs/heads/${candidate}"; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done
    printf 'main\n'
}
