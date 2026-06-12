#!/usr/bin/env bash
#
# Verification harness for Owner Maintenance Lane hook behavior.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

run_in_tmp() {
    (cd "${tmp}/repo" && "$@")
}

stage_file() {
    local path="$1"
    local content="${2:-content}"
    mkdir -p "${tmp}/repo/$(dirname "${path}")"
    printf '%s\n' "${content}" > "${tmp}/repo/${path}"
    run_in_tmp git add "${path}"
}

message_file() {
    local message="$1"
    local file="${tmp}/message.txt"
    printf '%s\n' "${message}" > "${file}"
    printf '%s\n' "${file}"
}

expect_success() {
    local label="$1"
    shift
    if ! "$@" >"${tmp}/${label}.out" 2>"${tmp}/${label}.err"; then
        echo "FAIL expected success: ${label}" >&2
        cat "${tmp}/${label}.err" >&2 || true
        exit 1
    fi
}

expect_failure() {
    local label="$1"
    shift
    if "$@" >"${tmp}/${label}.out" 2>"${tmp}/${label}.err"; then
        echo "FAIL expected failure: ${label}" >&2
        exit 1
    fi
}

reset_tmp_repo() {
    rm -rf "${tmp}/repo"
    mkdir -p "${tmp}/repo"
    run_in_tmp git init -b main >/dev/null
    run_in_tmp git config user.name "Hook Test"
    run_in_tmp git config user.email "hook-test@example.invalid"
    printf 'base\n' > "${tmp}/repo/README.md"
    run_in_tmp git add README.md
    run_in_tmp git commit -m "docs: seed repo (#1)" --no-verify >/dev/null
}

commit_msg_hook="${repo_root}/.githooks/commit-msg"
pre_commit_hook="${repo_root}/.githooks/pre-commit"

reset_tmp_repo
stage_file "docs/research/agent-note.md"
expect_success "commit-msg-owner-docs" run_in_tmp "${commit_msg_hook}" "$(message_file "docs(owner): add research note")"
expect_success "pre-commit-owner-docs" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
stage_file "docs/archon/specs/capture-pane.md"
expect_success "commit-msg-owner-generic-docs" run_in_tmp "${commit_msg_hook}" "$(message_file "docs(owner): add capture spec")"
expect_success "pre-commit-owner-generic-docs" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
stage_file "docs/assets/screenshot.png" "png"
expect_success "commit-msg-owner-chore" run_in_tmp "${commit_msg_hook}" "$(message_file "chore(owner): add screenshot")"
expect_success "pre-commit-owner-image" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
mkdir -p "${tmp}/repo/docs/research"
printf 'old\n' > "${tmp}/repo/docs/research/existing.md"
run_in_tmp git add docs/research/existing.md
run_in_tmp git commit -m "docs: add existing note (#1)" --no-verify >/dev/null
printf 'new\n' >> "${tmp}/repo/docs/research/existing.md"
run_in_tmp git add docs/research/existing.md
expect_failure "pre-commit-owner-modify" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
stage_file "README.md" "unsafe"
expect_failure "pre-commit-owner-unsafe" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
run_in_tmp git branch -m trunk
run_in_tmp git update-ref refs/remotes/origin/trunk HEAD
run_in_tmp git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
stage_file "src/app.ts" "unsafe"
expect_failure "pre-commit-owner-unsafe-custom-default" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
stage_file "docs/process/policy.md" "unsafe"
expect_failure "pre-commit-owner-unsafe-docs-process" run_in_tmp "${pre_commit_hook}"

reset_tmp_repo
stage_file "docs/research/no-owner-scope.md"
expect_failure "commit-msg-owner-scope-required" run_in_tmp "${commit_msg_hook}" "$(message_file "docs: add research note")"

# --- Append-log ledger lane (repo-template#50) -------------------------
# A named ledger may be MODIFIED on main with any conventional subject and no
# issue ref — both hooks pass, no bypass.
reset_tmp_repo
mkdir -p "${tmp}/repo/.claude"
printf 'seed\n' > "${tmp}/repo/.claude/noticed.md"
run_in_tmp git add .claude/noticed.md
run_in_tmp git commit -m "chore: seed ledger (#1)" --no-verify >/dev/null
printf -- '- [idea] foo: bar\n' >> "${tmp}/repo/.claude/noticed.md"
run_in_tmp git add .claude/noticed.md
expect_success "pre-commit-ledger-noticed-modify" run_in_tmp "${pre_commit_hook}"
expect_success "commit-msg-ledger-noticed-modify" run_in_tmp "${commit_msg_hook}" "$(message_file "chore(noticed): flush observations")"

# A named ledger may also be ADDED with any conventional subject and no issue ref.
reset_tmp_repo
stage_file ".claude/napkin.md" "runbook"
expect_success "pre-commit-ledger-napkin-add" run_in_tmp "${pre_commit_hook}"
expect_success "commit-msg-ledger-napkin-add" run_in_tmp "${commit_msg_hook}" "$(message_file "docs(napkin): seed runbook")"

# The friction ledger is append-only in normal use: direct-main appends pass the
# same named-ledger gate without needing an issue reference.
reset_tmp_repo
mkdir -p "${tmp}/repo/.claude"
printf '<!-- usage -->\n| date | category | what happened | cost | suggested fix |\n|---|---|---|---|---|\n' > "${tmp}/repo/.claude/friction.md"
run_in_tmp git add .claude/friction.md
run_in_tmp git commit -m "chore: seed friction ledger (#1)" --no-verify >/dev/null
printf '| 2026-06-12 | tooling | hook test rerun | rerun | keep the regression |\n' >> "${tmp}/repo/.claude/friction.md"
run_in_tmp git add .claude/friction.md
expect_success "pre-commit-ledger-friction-append" run_in_tmp "${pre_commit_hook}"
expect_success "commit-msg-ledger-friction-append" run_in_tmp "${commit_msg_hook}" "$(message_file "chore(friction): log hook hiccup")"

# A non-allowlisted .claude file is still blocked on main.
reset_tmp_repo
stage_file ".claude/settings.json" '{"x":1}'
expect_failure "pre-commit-claude-nonledger-blocked" run_in_tmp "${pre_commit_hook}"

# Deleting a ledger still requires the normal branch/PR lane.
reset_tmp_repo
mkdir -p "${tmp}/repo/.claude"
printf 'seed\n' > "${tmp}/repo/.claude/noticed.md"
run_in_tmp git add .claude/noticed.md
run_in_tmp git commit -m "chore: seed ledger (#1)" --no-verify >/dev/null
run_in_tmp git rm .claude/noticed.md >/dev/null
expect_failure "pre-commit-ledger-delete-blocked" run_in_tmp "${pre_commit_hook}"

# A ledger mixed with an unsafe path is blocked (the whole commit must qualify).
reset_tmp_repo
mkdir -p "${tmp}/repo/.claude" "${tmp}/repo/src"
printf 'note\n' > "${tmp}/repo/.claude/noticed.md"
printf 'code\n' > "${tmp}/repo/src/app.ts"
run_in_tmp git add .claude/noticed.md src/app.ts
expect_failure "pre-commit-ledger-mixed-unsafe-blocked" run_in_tmp "${pre_commit_hook}"

# A ledger mixed with a non-ledger (even a safe doc) is not ledger-exempt, so
# the issue-ref requirement still applies under a plain subject.
reset_tmp_repo
mkdir -p "${tmp}/repo/.claude" "${tmp}/repo/docs"
printf 'note\n' > "${tmp}/repo/.claude/noticed.md"
printf 'doc\n' > "${tmp}/repo/docs/thing.md"
run_in_tmp git add .claude/noticed.md docs/thing.md
expect_failure "commit-msg-ledger-mixed-needs-issue" run_in_tmp "${commit_msg_hook}" "$(message_file "chore: mixed change")"

echo "owner-maintenance hook tests passed"
