# Message Protocol

> **Status:** active
> **Owner:** ecosystem
> **Scope:** meta-layer
> **Source of truth:** yes
> **Last reviewed:** 2026-06-15
> **Supersedes:** none
> **Superseded by:** none

`AGENTS.md` carries the short agent-facing pointer (`## Message protocol`); this file owns
the full rules. Presentation is a separate concern — see `styles/` for how each skin renders
the banner. Protocol version: **1.0.0**.

## Why

One glance at a message must answer three questions: **is something needed from me, what
kind, and — for a closing message — is it safe to clear the chat.** Undifferentiated walls
of text fail all three, and agents tend to hedge rather than state plainly that work is done
and durable. This protocol makes the answer scannable and, for "safe to clear", verifiable.

## The shape

Every **turn-terminal message** (the message that ends a turn or asks for input — *not* every
progress line) has three parts in order:

1. **Status banner** — exactly one primary tag (below). `⚠ RISK` is an *overlay* on an ask,
   not its own tag.
2. **For you** (human lane) — present only when an ask tag is set: what the owner must do. A
   secondary ask goes here as a bullet; the banner still carries one primary tag.
3. **My work** (agent lane) — what the agent did: result, verification, paths, artifacts.

**State tags** (`SAFE TO CLEAR`, `NOT DONE`, `JUDGMENT CALL`, `FYI`) suppress the *For you*
lane entirely — only *My work* follows.

## Tags

**Asks** — something is needed from the owner:

| Tag | Meaning | Routing |
| --- | --- | --- |
| `TECHNICAL DECISION` | A technical tradeoff to call. | A second reviewer may be pulled in. |
| `CREATIVE DECISION` | A subjective / creative direction. | The owner decides solo. |
| `REVIEW` | Look at a PR, a merge, or produced output and approve. | — |
| `PROVIDE DATA` | Supply a value, file, credential, or fact the agent cannot obtain. | — |
| `PROMPT PACKET` | A prompt is delivered; sub-label whether to **dispatch** it elsewhere or it is the prompt the owner **asked for**. | — |

**Overlay** — `⚠ RISK` modifies an ask when the action is destructive or outside the norm
(force-push, delete, bypass a gate). It is never a standalone tag; it rides on the ask
(e.g. `⚠ RISK · REVIEW`).

**State** — nothing is being asked:

| Tag | Meaning |
| --- | --- |
| `SAFE TO CLEAR` | Done and durable; nothing lost on clear. Machine-backed (below). |
| `NOT DONE` | Work remains. List open items **ranked by loss-risk** — uncommitted work is high (clearing loses it); an open question is low (deferrable). |
| `JUDGMENT CALL` | The agent diverged from scope. No action needed, but it has stakes the owner may want to revisit (FYI implies no stakes; this has them). |
| `FYI` | Informational; nothing needed. |

**One primary tag per message.** A deep-research request ("should I run a deep-research
pass?") is a `TECHNICAL DECISION` or `CREATIVE DECISION`, not its own tag.

### Decisions carry scaffolding

A `TECHNICAL DECISION` or `CREATIVE DECISION` in the *For you* lane states: **background**
(why it is on the table) → **options, each annotated with how it changes the project
differently** → a **recommendation**. Technical decisions name the reviewer routing; creative
decisions are the owner's solo call.

## SAFE TO CLEAR is machine-backed

`SAFE TO CLEAR` asserts the owner can clear the chat with nothing lost — the strongest claim
an agent makes, and the one most damaging if false. It may be claimed only when:

- the close-scan marker `.agent/close-scan/complete.json` exists,
- its recorded `git.head` equals the current `HEAD`, and
- the upstream `HEAD` matches (the exact reviewed `HEAD` was pushed).

When all three hold, the message carries a verifiable marker comment:

```text
<!-- status: SAFE-TO-CLEAR head=<sha> pr=<n> marker=verified -->
```

In a repo with **no close-scan tooling**, `SAFE TO CLEAR` falls back to an explicit checklist
(committed · pushed · in a PR · docs/changelog updated) and **must label itself
`self-reported`**. Never emit `marker=verified` without the marker.

> Source: `scripts/close/scan-complete.mjs` writes the marker binding `git.head`;
> `scripts/close/ci-guard.mjs` verifies marker ↔ `HEAD` ↔ upstream before ready/merge.

## Rendering

The structure (banner → *For you* → *My work*, one primary tag) is identical across styles;
only the banner's skin differs:

- **plain** — a bold lead line with an emoji/word marker.
- **bbs-1998** (emoji-banned) — a bracket-label text banner: `[ NEEDS YOU: TECHNICAL DECISION ]`,
  `[ SAFE TO CLEAR ]`, `[ RISK · REVIEW ]`.

## Versioning

Changes to the tag vocabulary bump the protocol version and update the `AGENTS.md` pointer;
downstream repos inherit on the next snapshot refresh.
