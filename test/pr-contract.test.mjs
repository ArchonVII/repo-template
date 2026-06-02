import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validatePrContract } from "../scripts/pr-contract.mjs";

const validBody = [
  "## Summary",
  "",
  "- Add strict PR contract validation before ready-for-review.",
  "",
  "## Verification",
  "",
  "- [x] npm test",
  "",
  "```evidence",
  "command: npm test",
  "location: local",
  "result: passed",
  "timestamp: 2026-05-31T20:00:00Z",
  "```",
  "",
  "### Verification Notes",
  "",
  "Validated the reusable workflow tests locally with `npm test`; no warnings were emitted.",
  "",
  "## Docs / Changelog",
  "",
  "- README and changelog fragment updated for the new wrapper commands.",
  "",
  "Closes #36",
].join("\n");

const input = (overrides = {}) => ({
  title: "feat(policy): enforce PR contract before ready",
  body: validBody,
  branch: "agent/codex/36-pr-contract-gate",
  files: ["scripts/pr-contract.mjs", "scripts/agent-pr-ready.mjs"],
  ...overrides,
});

describe("validatePrContract", () => {
  it("accepts a complete non-doc PR contract", () => {
    const result = validatePrContract(input());

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.facts.docsOnly, false);
  });

  it("rejects malformed PR titles before promotion", () => {
    const result = validatePrContract(input({ title: "Add opt-in canvas window layout" }));

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "invalid_title" && error.path === "title"));
  });

  it("requires exact heading order for non-doc PRs", () => {
    const body = validBody.replace("### Verification Notes", "### Notes From Verification");

    const result = validatePrContract(input({ body }));

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "missing_heading" && error.path === "body"));
  });

  it("rejects placeholder scaffolds even when they contain checked boxes", () => {
    const body = [
      "<!-- AUTO-INJECTED policy stub for bot-authored PR. Replace freely. -->",
      "",
      "## Summary",
      "",
      "TODO: Fill in summary.",
      "",
      "## Verification",
      "",
      "- [x] Automated CI checks green on this PR",
      "- [ ] TODO: Run required verification and replace this line.",
      "",
      "### Verification Notes",
      "",
      "_Auto-injected for bot-authored PR. CI-green is the verification surface._",
      "",
      "## Docs / Changelog",
      "",
      "TODO: Closes #___",
    ].join("\n");

    const result = validatePrContract(input({ body }));
    const codes = result.errors.map((error) => error.code);

    assert.equal(result.ok, false);
    assert.ok(codes.includes("placeholder_text"));
    assert.ok(codes.includes("generic_verification"));
    assert.ok(codes.includes("unchecked_required_box"));
    assert.ok(codes.includes("missing_issue_link"));
  });

  it("allows docs-only PRs to skip body ceremony while keeping title and branch checks", () => {
    const result = validatePrContract(input({
      body: "Small README cleanup.",
      files: ["README.md", ".changelog/unreleased/36-pr-contract.md"],
      title: "docs(readme): clarify PR contract",
      branch: "docs/36-pr-contract",
    }));

    assert.equal(result.ok, true);
    assert.equal(result.facts.docsOnly, true);
  });
});
