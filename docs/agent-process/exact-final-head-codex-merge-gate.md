# Exact Final-HEAD Codex Merge Gate (#206)

> **Status:** accepted
> **Owner:** ecosystem
> **Scope:** meta-layer
> **Source of truth:** yes
> **Last reviewed:** 2026-07-19
> **Supersedes:** none
> **Superseded by:** none

- **Issue:** https://github.com/ArchonVII/repo-template/issues/206
- **Implementation state:** Design approved; implementation has not started.
- **Next action:** Open the provider workflow lane, then implement the repo-template command and policy surfaces test-first.

This document owns the cross-repository behavioral contract and the repo-template command/policy design. It does not own or authorize edits to workflow-provider YAML, Archon Setup implementation, or consumer protection state; those remain in separately issued lanes in their canonical repositories and link back here instead of copying this contract.

## Understanding Summary

- A pull request must not merge until GitHub Codex has reported a clean review for the exact final PR head commit.
- Elapsed time, reactions, stale reviews, Copilot output, and unanchored assumptions are never passing evidence.
- A required server-side status prevents the GitHub UI and direct `gh pr merge` from bypassing the rule; repo-owned wrappers add local identity and live-thread checks.
- GitHub's live conversation-resolution protection owns all review-thread enforcement, including human threads. The Codex status owns only exact-head Codex assessment state.
- The gate is stateless, fail-closed, resumable, API-only, and safe for fork pull requests because it never checks out or executes PR-head content.
- Workflow bodies belong to `ArchonVII/github-workflows`, command and agent policy belong here, and protection/snapshot/consumer rollout belongs to `ArchonVII/archon-setup`.

## Problem

The current close wrappers prove PR metadata and required CI state, but they do not prove that GitHub Codex finished reviewing the final commit. Archon Setup PRs #386 and #387 merged before Codex returned four material P2 findings. A local-only wrapper is insufficient because the GitHub merge button and direct `gh pr merge` calls can bypass it.

The result must model evidence, not waiting. A timeout may end a local observation attempt, but it must return pending/nonzero and can never turn missing review evidence into success.

## Goals

1. Publish required commit status `codex-final-head / decision` for one captured PR head SHA.
2. Pass only on a clean, commit-bound Codex assessment or a valid exact-SHA admin waiver.
3. Revoke success when relevant current state changes and an evaluator run observes the change.
4. Make review requests idempotent per SHA and keep all evaluation safely resumable.
5. Require the same gate from the GitHub merge surface and the blessed local merge wrapper.
6. Audit and harden both classic branch protection and rulesets without assuming either surface subsumes the other.

## Non-Goals

- Copilot review is not accepted as evidence.
- Reactions are not accepted as evidence.
- The first release does not support GitHub merge queue.
- The first release does not introduce a dedicated GitHub App; that remains future trust-boundary hardening.
- This provider lane does not refresh Archon Setup snapshots or repair Hudson Bend directly.
- This lane does not include the separate deterministic line-ending work from repo-template issue #204.

## Open Questions

None at design approval. Implementation discoveries that would change evidence, trust, bypass, or rollout semantics require owner review and a spec amendment before code proceeds.

## Assumptions And Non-Functional Requirements

### Security

- The server evaluator runs trusted default-branch workflow code and is API-only. It must not use `actions/checkout`, execute pull-request files, consume PR-authored executable configuration, restore PR-controlled caches, or run PR artifacts.
- Codex identity is pinned to REST login `chatgpt-codex-connector[bot]` and numeric user ID `199175422`. Both must match. A display name or body-text match is insufficient.
- The required status is pinned to the publishing GitHub App. In v1 that is GitHub Actions; consequently, maintainers permitted to change trusted default-branch workflows are inside the trust boundary. A dedicated publisher App is the explicit future hardening path.
- Untrusted comment and review text is parsed as data only and is never interpolated into a shell command.
- The caller and reusable workflow declare the same least-privilege ceiling: `contents: read`, `pull-requests: read`, `issues: write`, and `statuses: write`. The reusable workflow cannot elevate its caller. `contents: write`, `checks: write`, `actions: write`, `id-token: write`, and `write-all` are forbidden; the workflow performs no checkout.

### Reliability

- Every evaluation captures `headRefOid` once, re-queries every required paginated collection, computes from that snapshot, and publishes only against the captured SHA.
- Missing pages, API errors, unknown Codex response forms, identity mismatches, unavailable workflow state, and ambiguous evidence fail closed.
- Every PR event family uses one shared repository/PR concurrency group with `cancel-in-progress: false`. Writers are serialized; after obtaining the slot, each run re-queries full current state before requesting review or publishing. A newer queued event may replace an older pending event because every surviving run is stateless, but no running writer is canceled and allowed to race a successor. `merge_group` has no single PR number, so its unsupported-result writer uses a separate repository/synthetic-SHA group with the same non-canceling rule.
- There is no polling deadline that produces success. Local wrappers may stop waiting and report resumable pending state.

### Performance And Scale

- Expected volume is ordinary repository PR traffic, not a high-throughput service. Correct full pagination is preferred over cached partial state.
- Cheap event guards reject non-PR issue comments and self-authored events before API fan-out.
- The publisher first reads the current context and writes only when state, description, target URL, or verified publisher provenance differs. An otherwise identical status from an unexpected creator/App must be overwritten; unverifiable provenance is treated as different. This reduces Actions cost without making a wrong-source status sticky.

### Ownership And Maintenance

- `ArchonVII/github-workflows` owns the reusable evaluator and example/caller workflow bodies.
- `ArchonVII/repo-template` owns command UX, merge policy, pure local checks, and distributed agent guidance.
- `ArchonVII/archon-setup` owns snapshot refresh, baseline protection, tightening, effective-protection audit, and consumer rollout.
- Consumer repos own only thin callers, declared settings, and repo-specific protection state.

## Architecture

### Server Enforcement

A trusted reusable workflow evaluates PR state and publishes legacy commit status:

```text
codex-final-head / decision
```

A legacy status is intentional: it attaches directly to the captured commit, resets naturally on every push, matches the existing `repo-required-gate / decision` naming convention, and can be required with an expected App. The status publisher is the only component that writes this context.

The manually published status context is reserved. The caller workflow and evaluator job use names that cannot generate the Actions check-run name `codex-final-head / decision`; for example, workflow `Codex final-head evaluator` and job `evaluate evidence`. Provider validation rejects any workflow/job combination that collides with the status context. This matters because a same-named Actions check and legacy status would both be required, and App pinning cannot distinguish them when both originate from GitHub Actions.

The thin consumer caller invokes the workflow from trusted default-branch code. The workflow receives events only as identifiers; no event payload is accepted as evidence.

### Local Enforcement

The repo-template command surface adds:

- `close:codex:guard`, which first queries the repository's default branch, then calls the workflow-dispatch REST endpoint with API version `2026-03-10` and `ref` set to that default branch—never the PR branch or `H`. It captures the returned `workflow_run_id` and waits for that exact run, not merely any existing green status. The returned run must identify the expected `.github/workflows/codex-final-head.yml` path, `workflow_dispatch` event, and queried default-branch ref; its provider-defined evaluator job must be present and conclude `success`, never absent or skipped. Only then may a fresh read of the App-pinned status for unchanged `H` pass. Cancellation, replacement, timeout, error, metadata mismatch, missing/skipped evaluator job, or head movement blocks or returns resumable pending state.
- `agent:merge`, the blessed merge wrapper that proves local `HEAD`, upstream, and PR `headRefOid` identity; runs the existing CI guard; invokes `close:codex:guard`; confirms the pinned status on that SHA; queries unresolved review threads live through GraphQL as defense in depth; and only then invokes `gh pr merge`.

The wrapper never publishes `codex-final-head / decision` itself. A user-token status would not satisfy the App-pinned required check.

## Event Model

The evaluator supports these event families:

- `pull_request_target`: PR creation/reopen, synchronization, ready-for-review, and waiver label add/remove.
- `pull_request_review`: submitted, edited, and dismissed review state.
- `pull_request_review_comment`: created, edited, and deleted inline evidence changes.
- `issue_comment`: created, edited, and deleted request, assessment, and waiver comments.
- `workflow_dispatch`: explicit `pr_number` input used by the repo-owned wrapper for a fresh pre-merge evaluation.
- `merge_group`: `checks_requested`, handled only to publish an explicit unsupported/failure result against the synthetic SHA.

Although GitHub supports `pull_request_review_thread`, review-thread events are deliberately not part of the evaluator. Native conversation resolution is evaluated live at merge time, has no event-completeness burden, and covers every unresolved review conversation. Omitting thread events also prevents thread churn from invalidating a status whose single meaning is “Codex assessed this captured HEAD cleanly.”

All triggers converge on one stateless evaluator. `pull_request_target` remains API-only. Self-authored events and irrelevant comments exit before evaluation. Every PR trigger and request writer shares the serialized repository/PR group; `merge_group` uses the separate repository/synthetic-SHA group because a queue group can contain multiple PRs.

## Exact-Head Evidence Model

Let `H` be the full 40-character `headRefOid` captured once at the start of an evaluation.

### Review Request

A canonical request must name `H` in full, include `@codex review`, and be unedited. The evaluator does not request review while the PR is draft. After the shared serialization slot is acquired, it posts at most one canonical request for a ready PR at a given SHA. Existing matching requests are re-used; duplicate requests are not posted.

### Accepted Clean Evidence

A clean result requires all of the following:

1. A canonical request naming `H` exists.
2. A later Codex-authored assessment is present.
3. The assessment contains the recognized clean-result form and a reviewed-commit prefix of at least seven hexadecimal characters.
4. The prefix is a direct string prefix of `H`; no repository-wide prefix-resolution lookup is used.
5. The clean assessment's effective timestamp is strictly later than every findings-form or unknown assessment after the request.

The parser is allow-list based. If Codex changes its response format, the gate becomes pending/error until the parser and fixtures are intentionally updated. Reactions never count because they do not carry reviewed-commit evidence.

Evidence ordering is deterministic and conservative. Issue/review comments use `updated_at`; reviews use the later of their submitted and updated timestamps. Invalid or missing timestamps block. Conflicting clean/blocking assessments with equal timestamps, or timestamps that cannot be compared across returned evidence, resolve to blocking/unknown—collection-local IDs are never treated as a global ordering. Edits therefore participate in current ordering rather than silently retaining their original position.

Dismissed reviews are retracted and ineligible as either clean or blocking status evidence even though GitHub continues to return them. Deleted requests, assessments, and inline comments are absent from the stateless recomputation. Retracting the only qualifying clean assessment moves the status back to pending; unknown or inconsistent retraction state returns error. Review threads remain independently governed by GitHub's live conversation-resolution rule.

### Findings

- A Codex structured review or inline finding anchored to `H` blocks. The anchor is the parent `PullRequestReview.commit.oid`, never `PullRequestReviewComment.commit.oid`, because GitHub can remap the latter after later commits.
- A plain findings-form Codex conversation comment after the exact-SHA request blocks when it is newer than the last clean assessment.
- A later clean, commit-bound assessment can supersede an earlier findings assessment for the same SHA.
- Findings anchored only to superseded commits do not block the status for `H`; any still-unresolved review thread remains independently blocking through native conversation resolution.

### Status Outcomes

| Computed state | Commit status | Meaning |
| --- | --- | --- |
| Clean | `success` | Latest qualifying Codex assessment is clean and bound to `H`. |
| Waived | `success` | A current-admin exact-SHA waiver is valid. Description explicitly says waived. |
| Pending | `pending` | Request or qualifying response is absent; safe to resume later. |
| Findings | `failure` | Current-head or newer plain-comment findings block. |
| Unsupported queue | `failure` | Merge-group SHA is intentionally unsupported in v1. |
| Invalid/unknown/error | `error` | Evidence, identity, pagination, or API state cannot be proved safely. |

Status descriptions must stay within GitHub's 140-character limit. Target URLs point to the decisive Codex response, finding, waiver comment, or evaluator run.

## Conversation Resolution

`required_conversation_resolution` under classic protection, or `required_review_thread_resolution` under a ruleset pull-request rule, is mandatory for gated repos. This intentionally broadens the former “unresolved Codex threads” concept: every unresolved human or bot review conversation blocks merge.

This setting has no “check must have run recently” prerequisite, so new-repo baseline protection enables it immediately. The local merge wrapper also performs a fully paginated GraphQL query for unresolved threads immediately before merge as defense in depth; the native GitHub rule remains canonical enforcement.

## Waiver And Emergency Tiers

### Tier 1: Codex Unavailable

There are no automatic path or PR-class exemptions. An admin waiver requires both label:

```text
codex-final-head:waived
```

and a new, unedited conversation comment:

```text
/codex-final-head waive <full-40-character-SHA>
Reason: <non-empty explanation>
```

The evaluator requires:

- Exact equality between the command SHA and captured `H`.
- Comment REST login and numeric user ID to match the queried actor.
- `GET /repos/{owner}/{repo}/collaborators/{username}/permission` to return `permission == "admin"` on every evaluation.
- `updated_at == created_at`; an edited comment is invalid and correction requires a new comment.
- The waiver label to remain present.

A push invalidates the waiver naturally because it names a different SHA. Editing/deleting the comment, removing the label, or a later evaluator observing that the actor is no longer an admin retracts success. The pre-merge wrapper forces a fresh evaluator run. GitHub does not provide this workflow with an atomic permission-change/merge hook, so permission revocation is reflected at the next evaluation rather than claimed as instantaneous.

The success description is compact, for example `waived by @owner for abcdef1234; reason recorded`. It never inlines the reason. The target URL points to the waiver comment, and the repository/org audit log remains the durable platform record after merge.

### Tier 2: Gate Infrastructure Broken

With admin enforcement enabled and ruleset bypass actors removed, administrators can no longer silently bypass the required status or conversation rule at merge time. They can still edit or remove protection itself. GitHub records that action in the repository or organization audit log.

That audit-logged protection edit is the accepted final recovery tier when the evaluator workflow itself is broken and therefore cannot publish a waiver for its own repair PR. It is not the Codex-outage path and must not be normalized into the close workflow.

## Protection Model And Audit

GitHub layers rulesets with classic branch protection and enforces the strictest applicable union. The APIs do not present that union as one complete document, so the audit queries both surfaces and computes it.

### Classic Branch Protection

For a gated branch:

- `enforce_admins` must be `true`.
- `required_conversation_resolution` must be `true`.
- `codex-final-head / decision` must be required and pinned to the publishing App.
- Existing unrelated settings and required checks must be preserved.

New-repo baseline protection changes `enforce_admins` from `false` to `true` immediately; unlike a named status, there is no reason to defer it.

The existing required-status PATCH endpoint cannot change admin enforcement. When tightening takes the PATCH path, it must also call:

```text
POST /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins
```

Alternatively, tightening may use the full protection PUT, rebuilding the current GET shape while forcing `enforce_admins: true` rather than preserving a false value. If conversation resolution also drifts, the full PUT is the preferred single preserving update.

### Rulesets

For every active applicable ruleset used to enforce the gate:

- The pull-request rule requires review-thread resolution.
- The required-status-check rule includes `codex-final-head / decision` with the expected integration.
- No bypass actor can silently skip the gate.
- Active merge-queue rules are rejected for v1.

The audit uses `GET /repos/{owner}/{repo}/rules/branches/{branch}` for active rules contributed by rulesets, then reads applicable ruleset details, including inherited sources and visible bypass actors. It separately uses the classic branch-protection endpoint. An empty branch-rules response does not prove that classic protection is absent.

Unreadable or ambiguous protection state fails closed. Each repo receives an auditable outcome: compliant, needs classic repair, needs ruleset repair, merge-queue-incompatible, or inspection failed with a concrete reason.

## Merge Queue

Merge queue is unsupported in v1 because GitHub evaluates required checks against a synthetic merge-group SHA, not the reviewed PR-head SHA.

- Enablement refuses any active merge-queue configuration discovered on either protection surface.
- The evaluator handles `merge_group: checks_requested` only to publish a fast, explanatory failure on the synthetic SHA.
- Supporting merge queue later requires a separate issue and evidence model; pass-through from PR-head success is forbidden.

## Bootstrap And Rollout

### New Repositories

1. Baseline protection immediately enables admin enforcement and conversation resolution, but not the named Codex status.
2. Install the trusted evaluator/caller and repo-owned wrapper commands.
3. Let `codex-final-head / decision` publish at least once.
4. Run the tighten operation to require the App-pinned status. GitHub's recent-check constraint applies only to this named-status step.
5. Audit both protection surfaces and persist the result in the onboarding manifest/report.

### Existing Repositories

1. Audit classic protection and active rulesets separately.
2. Immediately enable admin enforcement and conversation resolution on the applicable protection surfaces; neither setting depends on a prior status run.
3. Install the evaluator while its named status is not yet required.
4. Run it once on a bootstrap PR.
5. Require the App-pinned named status.
6. Re-audit the computed union and bypass paths.

### Ecosystem Sequence

1. Land the reusable evaluator and canonical example/caller in `ArchonVII/github-workflows`.
2. Land repo-template issue #206 command, policy, tests, and caller distribution changes.
3. Let the separate line-ending provider lane land; do not conflate it with this issue.
4. Repair the post-merge Archon defects in their own lane.
5. Refresh Archon Setup snapshots once with the explicitly named provider inputs; self-apply; add protection tightening/audit support.
6. Bootstrap Hudson Bend with the evaluator on its default branch before requiring the status. The bootstrap PR cannot be gated by a workflow that is not yet on the default branch.
7. Repair Hudson Bend's active ruleset and any classic protection, enable the required status after its first run, and verify the computed union.
8. Refresh and finish Hudson Bend PR #383, obtain a clean exact-final-HEAD Codex result, merge, and verify canonical `main`.
9. Only then resume the paused Hudson Bend #370 lane.

## Expected Repository Surfaces

### `ArchonVII/github-workflows`

- Canonical reusable evaluator and `examples/codex-final-head.yml` caller body.
- Hermetic evaluator fixtures and workflow validation.

### `ArchonVII/repo-template`

| Path | Required repo-template phase change |
| --- | --- |
| `package.json` | Add `close:codex:guard` and `agent:merge` with no skip/bypass variants. |
| `scripts/close/codex-final-head.mjs` | Implement dispatch correlation, exact-head status verification, and machine-readable resumable results behind injected API boundaries. |
| `scripts/close/lib.mjs` | Hold pure evidence/status evaluators shared by hermetic tests. |
| `scripts/agent-merge.mjs` | Compose CI guard, exact dispatch completion, App-pinned status, live GraphQL threads, and only then `gh pr merge`. |
| `AGENTS.md` | Replace the current “one unchanged-HEAD read covers merge / do not re-list threads” rule with the explicit distinction: CI guard remains reusable for unchanged `HEAD`, while merge requires one fresh Codex dispatch and one live thread query. |
| `README.md` and `docs/agent-process/doc-system.md` | Document command discovery and the detailed close-system contract without duplicating the short AGENTS rule. |
| `.github/workflows/codex-final-head.yml` | Install only the provider-owned `examples/codex-final-head.yml` caller body; never re-author it locally. |
| `.agent/startup-baseline.json` | Explicitly distribute the close guard, merge wrapper, and thin caller; do not rely on directory presence or an undocumented snapshot side effect. |
| `test/startup-baseline.test.mjs` and focused new `test/**` suites | Assert distribution, no bypass, exact-run correlation, permissions, name separation, serialization, and the full hermetic evidence matrix. |

The vendored `scripts/pr-contract.mjs` is out of scope and must not be edited.

### `ArchonVII/archon-setup`

- `src/server/tasks/applyBaselineBranchProtection.mjs` baseline hardening.
- `src/server/branchProtection/tightenRequiredGate.mjs` named-status/admin enforcement and preserving updates.
- Effective protection/ruleset audit, snapshot refresh, self-apply, manifest/reporting, and tests.

### Hudson Bend

- Thin evaluator caller and distributed command files from the approved snapshots.
- Live `main` protection repair through a dedicated lane, with both surfaces re-audited before PR #383 proceeds.

## Testing Strategy

All tests are hermetic unless explicitly identified as a one-time live bootstrap verification. Inject API responses; unit tests must never depend on live network access.

### Evaluator Fixtures

- Exact-SHA clean response succeeds.
- Reaction-only, stale-head, short-prefix, non-prefix, wrong-login, wrong-user-ID, and unknown response forms fail closed.
- Draft PRs do not receive requests; a ready event requests the captured SHA once.
- Pending request and pending assessment remain resumable indefinitely.
- Findings newer than clean block; a later clean assessment for the same SHA supersedes earlier findings.
- Equal, edited, missing, and cross-collection-incomparable timestamps resolve conservatively and deterministically.
- Dismissing the only qualifying clean review retracts success; a dismissed review cannot remain clean/blocking evidence.
- Deleting a request or assessment removes it from recomputed evidence and yields the corresponding pending/error state rather than preserving stale success.
- Superseded-commit findings do not status-block the new head.
- Plain findings comments, structured reviews, and inline findings are classified correctly.
- Inline findings use the parent review commit rather than the remappable comment commit.
- Every paginated connection is drained; pagination or parse failure returns error.
- Serialized simultaneous events cannot post duplicate requests for one SHA.
- Head movement during a run publishes only to the originally captured SHA.
- The shared per-PR concurrency group has no in-progress cancellation; serialized PR writers cannot overwrite one another out of order.
- `merge_group` uses a repository/synthetic-SHA non-canceling group and publishes each unsupported result without requiring a PR number.
- Self-authored and irrelevant events exit cheaply.
- Diff-before-write prevents duplicate status publication while an otherwise identical status from a wrong or unverifiable publisher is overwritten.
- Workflow/job names cannot collide with `codex-final-head / decision`, and caller/reusable-workflow permissions match the least-privilege contract.

### Waiver Fixtures

- Valid exact-SHA label plus unedited current-admin comment succeeds as waived.
- Missing label/reason, edited/deleted comment, SHA mismatch, non-admin, demoted actor on re-evaluation, or identity mismatch fails.
- Description stays at or below 140 characters and target URL exposes the recorded reason.

### Wrapper Fixtures

- Local HEAD, upstream, and PR head mismatch each block.
- CI guard failure blocks.
- API-versioned `workflow_dispatch` is invoked with the exact PR number and the queried default branch as `ref`; PR branches and `H` are rejected as dispatch refs. The returned run ID is captured and the wrapper waits for that exact run.
- The exact run must report the expected caller workflow path, `workflow_dispatch` event, queried default-branch ref, and a present provider-defined evaluator job whose conclusion is `success`.
- Canceled, replaced, failed, timed-out, wrong-path, wrong-ref, wrong-event, missing-job, skipped-job, or otherwise mismatched dispatch runs block; an older green status cannot satisfy a fresh dispatch.
- Pending/failure/wrong-App/wrong-SHA status blocks.
- Any unresolved GraphQL review thread blocks.
- `gh pr merge` is unreachable unless every prerequisite passes; there is no skip-review flag.

### Protection Fixtures

- New baseline sets `enforce_admins: true` and conversation resolution immediately.
- Tighten's status PATCH path also POSTs the admin-enforcement subresource, or the preserving full PUT forces true.
- Full PUT preserves unrelated protection while forcing required values.
- Classic-only, ruleset-only, layered, inherited, bypass-actor, unreadable, and merge-queue states produce deterministic audit results.
- Named-status enablement before a recent run remains a clear resumable state, not a partial success.

### Verification Before Rollout

- Full provider and integrator test suites.
- `actionlint` on every changed workflow file.
- A fresh Windows clone with repository line-ending policy applied.
- A controlled live PR proving request, pending, clean, waiver retraction, App pinning, admin enforcement, conversation resolution, and merge refusal.

## Accepted Costs And Residual Risks

- A Codex outage halts all merges except exact-SHA admin waivers.
- Bulk mechanical work still requires one Codex round-trip for every PR head after each push.
- Same-repo trusted workflow authors can publish through the shared GitHub Actions App; dedicated-App publishing is future hardening.
- Admins can edit protection itself, but that is an audit-logged emergency action, not a silent merge bypass.
- Permission demotion retracts a waiver when the next evaluator runs; GitHub does not provide an atomic permission-change trigger coupled to merge.
- GitHub API or Codex response-format changes fail closed and require a reviewed compatibility update.

## Decision Log

| Decision | Alternatives considered | Why |
| --- | --- | --- |
| Required legacy status `codex-final-head / decision` | Approval requirement; local wrapper only; Checks API | It binds to one SHA, can be App-pinned, and blocks UI/direct merges without treating Codex `COMMENTED` reviews as approvals. |
| Two-layer server status plus blessed wrapper | Server only; wrapper only | Server closes alternate merge paths; wrapper adds local identity and live GraphQL defense. |
| Exact request plus commit-bound clean response | Reaction; elapsed wait; any Codex comment | Only the selected form proves assessment of the captured SHA. |
| Native conversation resolution owns threads | Re-evaluate on every thread event | Native enforcement is live, broader, cheaper, and has no event-completeness gap. |
| All human and bot threads block | Codex-only threads | This is GitHub's native semantic and is intentionally stricter. |
| No automatic exemptions | Docs-only or snapshot auto-pass | Markdown carries executable agent policy and snapshots distribute code. |
| Exact-SHA current-admin waiver | Timeout success; persistent label; unlogged admin bypass | It is explicit, auditable, bounded, and revalidated. |
| Enforce admins in baseline and tighten | Preserve `false`; wait for named status | Admin enforcement has no recent-check prerequisite and removes the silent bypass window. |
| Query classic protection and rulesets separately | Treat branch-rules API as complete effective state | GitHub layers them, but the branch-rules API does not expose classic protection. |
| Merge queue unsupported with explicit failure | Silent pending; PR-head pass-through | Synthetic queue SHAs are not the reviewed final PR head. |
| Audit-logged protection edit is final recovery tier | Pretend settings can prevent admin reconfiguration | A broken gate cannot publish its own waiver; platform administration remains necessary and visible. |

## Acceptance Criteria

- [ ] The status evaluator captures one `headRefOid`, fully re-queries evidence, and publishes only to that SHA.
- [ ] Every PR evaluator/request writer is serialized in one non-canceling per-PR concurrency group; merge-group failures use a non-canceling repository/synthetic-SHA group.
- [ ] Only pinned-identity, commit-bound clean evidence or a valid exact-SHA admin waiver succeeds.
- [ ] Current-head/newer findings, unknown evidence, stale evidence, reactions, missing pages, and API failures fail closed.
- [ ] Thread enforcement is native, live, enabled for admins, and covers all unresolved conversations.
- [ ] The merge wrapper dispatches only trusted default-branch workflow code, waits for the exact API-returned run and successful evaluator job, and cannot reach `gh pr merge` without CI, exact-head status, identity, and live-thread checks.
- [ ] The manually published status name cannot collide with a generated Actions check, and caller/evaluator permissions are least-privilege and identical.
- [ ] `AGENTS.md` distinguishes reusable unchanged-HEAD CI evidence from the mandatory fresh pre-merge Codex dispatch and live-thread query.
- [ ] The startup baseline and focused regression test explicitly distribute every new command/runtime/caller file.
- [ ] New baseline protection enables admins and conversation resolution immediately; named status tightening remains deferred until its first run.
- [ ] Classic protection and rulesets are audited separately and evaluated as a layered union, including bypass paths.
- [ ] Waiver comments are new-only, exact-SHA, current-admin, reasoned, status-attributed, and revalidated.
- [ ] Merge queue is rejected at enablement and fails explicitly if a merge-group event occurs.
- [ ] Hermetic tests cover the full evidence, waiver, wrapper, protection, race, and failure matrix.
- [ ] GitHub Codex reviews every implementation PR's exact final HEAD before it merges.

## References

- GitHub Actions events: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Workflow dispatch REST API: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- Protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Branch-protection REST API: https://docs.github.com/en/rest/branches/branch-protection
- Repository rules REST API: https://docs.github.com/en/rest/repos/rules
- Ruleset layering: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#about-rule-layering
- Collaborator permission REST API: https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
- Merge queue checks: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue#triggering-merge-group-checks-with-github-actions
