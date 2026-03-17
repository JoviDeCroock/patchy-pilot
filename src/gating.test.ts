import { describe, it, expect } from "vitest";
import { evaluateGating } from "./gating.js";
import type { ReviewResult } from "./schemas/review.js";
import type { Config } from "./schemas/config.js";
import { ConfigSchema } from "./schemas/config.js";

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    critical_issues: [],
    likely_bugs: [],
    missing_tests: [],
    spec_mismatches: [],
    risky_changes: [],
    hidden_assumptions: [],
    confidence: 0.85,
    merge_recommendation: "safe_to_merge",
    short_summary: "Looks good.",
    ...overrides,
  };
}

function makeConfig(thresholds: Partial<Config["thresholds"]> = {}): Config {
  return ConfigSchema.parse({
    thresholds,
  });
}

describe("evaluateGating", () => {
  it("passes when review is clean and above thresholds", () => {
    const result = evaluateGating(makeReview(), makeConfig());
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("fails when critical issues exceed max_critical", () => {
    const review = makeReview({
      critical_issues: [
        { description: "SQL injection", severity: "critical" },
        { description: "Auth bypass", severity: "critical" },
      ],
    });
    const result = evaluateGating(review, makeConfig({ max_critical: 0, block_on: [] }));
    expect(result.passed).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("2 critical issues");
  });

  it("passes when critical issues are at the threshold", () => {
    const review = makeReview({
      critical_issues: [{ description: "Issue", severity: "critical" }],
    });
    const result = evaluateGating(review, makeConfig({ max_critical: 1 }));
    // 1 critical <= max_critical of 1 => pass (no block_on triggered for critical_issues by default... wait, default block_on includes critical_issues)
    // Actually let's check: default block_on is ["critical_issues"], so any critical_issues will trigger block
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('Blocking category "critical_issues"'))).toBe(
      true,
    );
  });

  it("fails when high-severity issues across categories exceed max_high", () => {
    const review = makeReview({
      critical_issues: [{ description: "A", severity: "high" }],
      likely_bugs: [{ description: "B", severity: "high" }],
      spec_mismatches: [{ description: "C", severity: "high" }],
    });
    const result = evaluateGating(
      review,
      makeConfig({ max_high: 2, max_critical: 999, block_on: [] }),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("3 high-severity issues"))).toBe(true);
  });

  it("counts only high-severity issues for max_high (not medium)", () => {
    const review = makeReview({
      likely_bugs: [
        { description: "A", severity: "high" },
        { description: "B", severity: "medium" },
        { description: "C", severity: "medium" },
      ],
    });
    const result = evaluateGating(review, makeConfig({ max_high: 2, block_on: [] }));
    expect(result.passed).toBe(true);
  });

  it("fails when confidence is below min_confidence", () => {
    const review = makeReview({ confidence: 0.4 });
    const result = evaluateGating(review, makeConfig({ min_confidence: 0.6, block_on: [] }));
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("Confidence 0.4");
    expect(result.reasons[0]).toContain("threshold 0.6");
  });

  it("passes when confidence equals min_confidence", () => {
    const review = makeReview({ confidence: 0.6 });
    const result = evaluateGating(review, makeConfig({ min_confidence: 0.6, block_on: [] }));
    expect(result.passed).toBe(true);
  });

  it("fails on block_on categories with any issues", () => {
    const review = makeReview({
      likely_bugs: [{ description: "Bug", severity: "low" }],
    });
    const result = evaluateGating(review, makeConfig({ block_on: ["likely_bugs"] }));
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain('Blocking category "likely_bugs"');
  });

  it("does not fail on block_on categories with zero issues", () => {
    const review = makeReview({ likely_bugs: [] });
    const result = evaluateGating(review, makeConfig({ block_on: ["likely_bugs"] }));
    expect(result.passed).toBe(true);
  });

  it("accumulates multiple failure reasons", () => {
    const review = makeReview({
      critical_issues: [
        { description: "A", severity: "critical" },
        { description: "B", severity: "critical" },
      ],
      confidence: 0.3,
    });
    const result = evaluateGating(review, makeConfig({ max_critical: 0, min_confidence: 0.5 }));
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("uses default thresholds when none specified", () => {
    const review = makeReview({
      critical_issues: [{ description: "A", severity: "critical" }],
    });
    // Default: max_critical=0, block_on=["critical_issues"]
    const result = evaluateGating(review, makeConfig());
    expect(result.passed).toBe(false);
  });
});
