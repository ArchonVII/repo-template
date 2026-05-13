# Architecture Decision Records

One markdown file per architecturally-significant decision. Numbered `NNN-kebab-slug.md`.

Add an ADR when:

- The decision is non-obvious
- It's costly to reverse
- Someone six months from now would wonder why

Skip an ADR when:

- The decision is obvious from the code
- The rationale fits in a code comment
- It's reversible in an afternoon

## Template

```markdown
# NNN. <Title>

Date: YYYY-MM-DD
Status: Proposed / Accepted / Superseded by NNN

## Context

<Why is this a decision worth recording?>

## Decision

<What did we decide?>

## Consequences

<What changes because of this? What new constraints exist?>
```

See [`ArchonVII/.github/STARTER.md`](https://github.com/ArchonVII/.github/blob/main/STARTER.md) for the full document-policy guide.
