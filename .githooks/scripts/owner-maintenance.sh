#!/usr/bin/env bash
#
# Shared Owner Maintenance Lane predicates for repo-template hooks.

owner_maintenance_subject() {
    local subject="${1:-}"
    [[ "${subject}" =~ ^(docs|chore)\(owner\)!?:[[:space:]].+ ]]
}

owner_maintenance_staged_paths_safe() {
    local staged
    staged="$(git diff --cached --name-status --diff-filter=ACMRTD 2>/dev/null || true)"
    [[ -n "${staged}" ]] || return 1

    local status path rest
    while IFS=$'\t' read -r status path rest; do
        [[ -n "${status}" ]] || continue

        # Owner Maintenance Lane is add-only. Renames, copies, deletes, and
        # modifications require the normal branch/PR lifecycle.
        if [[ "${status}" != "A" ]]; then
            return 1
        fi

        if ! owner_maintenance_path_safe "${path}"; then
            return 1
        fi
    done <<< "${staged}"

    return 0
}

owner_maintenance_path_safe() {
    local path="${1:-}"

    # Explicit unsafe set from ArchonVII/.github#14. Unsafe wins even if a path
    # would otherwise match a broad safe pattern, such as an image under
    # .github/.
    case "${path}" in
        README.md|AGENTS.md|CLAUDE.md|GEMINI.md|package.json|package-lock.json)
            return 1
            ;;
        .github/*|.githooks/*|.claude/*|.agent/schema/*|src/*|scripts/*|docs/process/*|docs/architecture/*)
            return 1
            ;;
    esac

    case "${path}" in
        docs/*|.changelog/*)
            return 0
            ;;
        *.png|*.jpg|*.jpeg|*.gif|*.webp|*.svg)
            return 0
            ;;
    esac

    return 1
}
