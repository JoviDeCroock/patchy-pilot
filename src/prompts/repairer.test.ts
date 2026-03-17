import { describe, it, expect } from "vitest";
import { repairPrompt } from "./repairer.js";
import type { ReviewResult } from "../schemas/review.js";

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    critical_issues: [],
    likely_bugs: [],
    missing_tests: [],
    spec_mismatches: [],
    risky_changes: [],
    hidden_assumptions: [],
    confidence: 0.5,
    merge_recommendation: "needs_changes",
    short_summary: "Needs fixes.",
    ...overrides,
  };
}

describe("repairPrompt", () => {
  it("includes the spec in specification tags", () => {
    const prompt = repairPrompt("Build API", makeReview());
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("Build API");
    expect(prompt).toContain("</specification>");
  });

  it("includes the untrusted input warning", () => {
    const prompt = repairPrompt("spec", makeReview());
    expect(prompt).toContain("untrusted user input");
  });

  it("includes critical issues with [CRITICAL] prefix", () => {
    const review = makeReview({
      critical_issues: [
        {
          description: "SQL injection",
          severity: "critical",
          suggestion: "Use parameterized queries",
        },
      ],
    });
    const prompt = repairPrompt("spec", review);
    expect(prompt).toContain("[CRITICAL] SQL injection");
    expect(prompt).toContain("Use parameterized queries");
  });

  it("includes bugs with [BUG] prefix", () => {
    const review = makeReview({
      likely_bugs: [{ description: "Off-by-one error", severity: "high" }],
    });
    const prompt = repairPrompt("spec", review);
    expect(prompt).toContain("[BUG] Off-by-one error");
  });

  it("includes spec mismatches with [SPEC] prefix", () => {
    const review = makeReview({
      spec_mismatches: [{ description: "Missing pagination", severity: "high" }],
    });
    const prompt = repairPrompt("spec", review);
    expect(prompt).toContain("[SPEC] Missing pagination");
  });

  it("includes missing tests with [TEST] prefix", () => {
    const review = makeReview({
      missing_tests: [{ description: "No edge case tests", severity: "medium" }],
    });
    const prompt = repairPrompt("spec", review);
    expect(prompt).toContain("[TEST] No edge case tests");
  });

  it("includes the reviewer summary", () => {
    const review = makeReview({ short_summary: "Multiple issues found." });
    const prompt = repairPrompt("spec", review);
    expect(prompt).toContain("<reviewer-summary>");
    expect(prompt).toContain("Multiple issues found.");
  });

  it("does not include risky_changes or hidden_assumptions", () => {
    const review = makeReview({
      risky_changes: [{ description: "Risky thing", severity: "medium" }],
      hidden_assumptions: [{ description: "Assumes X", severity: "low" }],
    });
    const prompt = repairPrompt("spec", review);
    expect(prompt).not.toContain("Risky thing");
    expect(prompt).not.toContain("Assumes X");
  });

  it("produces empty findings list when no actionable issues", () => {
    const prompt = repairPrompt("spec", makeReview());
    expect(prompt).toContain("<review-findings>");
    // The list should just have the header text with no issue items
    expect(prompt).not.toContain("[CRITICAL]");
    expect(prompt).not.toContain("[BUG]");
    expect(prompt).not.toContain("[SPEC]");
    expect(prompt).not.toContain("[TEST]");
  });
});
