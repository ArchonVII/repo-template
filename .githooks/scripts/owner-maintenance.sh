#!/usr/bin/env bash
#
# Shared Owner Maintenance Lane predicates for repo-template hooks.

owner_maintenance_subject() {
    local subject="${1:-}"
    [[ "${subject}" =~ ^(docs|chore)\(owner\)!?:[[:space:]].+ ]]
}

# Append-log ledgers: agent-local note files that standing agent conventions
# tell every session to write to frequently, so a full issue->PR lane (or an
# audited bypass) for each one-line update is friction with no safety benefit.
# These named files may be Added OR Modified directly on main under the Owner
# Maintenance Lane. The allowlist is explicit and narrow on purpose — add a path
# only when a documented convention mandates frequent low-ceremony writes to it.
#
#   .claude/noticed.md — per-repo observation log (CLAUDE.md "Observations":
#                        "append one-liner to .claude/noticed.md")
#   .claude/napkin.md  — per-repo curated runbook (napkin skill, curated each
#                        session)
#
# Source: ArchonVII owner conventions; repo-template#50 (page-gm incident
# gm-20260605-113318 — flushing .claude/noticed.md required a double bypass:
# ALLOW_MAIN_COMMIT=1 + ALLOW_NO_ISSUE_REF=1).
owner_maintenance_is_append_log() {
    local path="${1:-}"
    case "${path}" in
        .claude/noticed.md|.claude/napkin.md)
            return 0
            ;;
    esac
    return 1
}

owner_maintenance_staged_paths_safe() {
    local staged
    staged="$(git diff --cached --name-status --diff-filter=ACMRTD 2>/dev/null || true)"
    [[ -n "${staged}" ]] || return 1

    local status path rest
    while IFS=$'\t' read -r status path rest; do
        [[ -n "${status}" ]] || continue

        # Append-log ledgers may be added OR modified directly on main. Renames,
        # copies, and deletes still require the normal branch/PR lifecycle, so a
        # ledger can't be relocated or removed without review.
        if owner_maintenance_is_append_log "${path}"; then
            case "${status}" in
                A|M)
                    continue
                    ;;
                *)
                    return 1
                    ;;
            esac
        fi

        # Everything else in the lane is add-only. Renames, copies, deletes, and
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
