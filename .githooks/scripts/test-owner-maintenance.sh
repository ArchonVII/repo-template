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
stage_file "docs/research/no-owner-scope.md"
expect_failure "commit-msg-owner-scope-required" run_in_tmp "${commit_msg_hook}" "$(message_file "docs: add research note")"

echo "owner-maintenance hook tests passed"
