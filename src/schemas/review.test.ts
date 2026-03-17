import { describe, it, expect } from "vitest";
import {
  ReviewResultSchema,
  IssueSchema,
  SeveritySchema,
  MergeRecommendation,
  ValidationResultSchema,
} from "./review.js";

describe("SeveritySchema", () => {
  it.each(["critical", "high", "medium", "low", "info"] as const)("accepts '%s'", (severity) => {
    expect(SeveritySchema.parse(severity)).toBe(severity);
  });

  it("rejects invalid severity", () => {
    expect(() => SeveritySchema.parse("urgent")).toThrow();
  });
});

describe("MergeRecommendation", () => {
  it.each(["safe_to_merge", "merge_with_minor_fixes", "needs_changes", "do_not_merge"] as const)(
    "accepts '%s'",
    (rec) => {
      expect(MergeRecommendation.parse(rec)).toBe(rec);
    },
  );

  it("rejects invalid recommendation", () => {
    expect(() => MergeRecommendation.parse("maybe")).toThrow();
  });
});

describe("IssueSchema", () => {
  it("parses a minimal issue", () => {
    const issue = IssueSchema.parse({
      description: "Something wrong",
      severity: "high",
    });
    expect(issue.description).toBe("Something wrong");
    expect(issue.file).toBeUndefined();
    expect(issue.line).toBeUndefined();
    expect(issue.suggestion).toBeUndefined();
  });

  it("parses a full issue", () => {
    const issue = IssueSchema.parse({
      description: "Potential null pointer",
      severity: "critical",
      file: "src/main.ts",
      line: 42,
      suggestion: "Add null check",
    });
    expect(issue.file).toBe("src/main.ts");
    expect(issue.line).toBe(42);
    expect(issue.suggestion).toBe("Add null check");
  });

  it("rejects missing description", () => {
    expect(() => IssueSchema.parse({ severity: "high" })).toThrow();
  });
});

describe("ReviewResultSchema", () => {
  const validReview = {
    critical_issues: [],
    likely_bugs: [],
    missing_tests: [],
    spec_mismatches: [],
    risky_changes: [],
    hidden_assumptions: [],
    confidence: 0.85,
    merge_recommendation: "safe_to_merge",
    short_summary: "All good.",
  };

  it("parses a valid review result", () => {
    const result = ReviewResultSchema.parse(validReview);
    expect(result.confidence).toBe(0.85);
    expect(result.merge_recommendation).toBe("safe_to_merge");
  });

  it("rejects confidence below 0", () => {
    expect(() => ReviewResultSchema.parse({ ...validReview, confidence: -0.1 })).toThrow();
  });

  it("rejects confidence above 1", () => {
    expect(() => ReviewResultSchema.parse({ ...validReview, confidence: 1.1 })).toThrow();
  });

  it("accepts confidence at boundaries", () => {
    expect(ReviewResultSchema.parse({ ...validReview, confidence: 0 }).confidence).toBe(0);
    expect(ReviewResultSchema.parse({ ...validReview, confidence: 1 }).confidence).toBe(1);
  });

  it("rejects missing required fields", () => {
    expect(() => ReviewResultSchema.parse({})).toThrow();
    expect(() => ReviewResultSchema.parse({ ...validReview, short_summary: undefined })).toThrow();
  });
});

describe("ValidationResultSchema", () => {
  it("parses a minimal validation result", () => {
    const result = ValidationResultSchema.parse({ all_passed: true });
    expect(result.all_passed).toBe(true);
    expect(result.formatter).toBeUndefined();
  });

  it("parses a full validation result", () => {
    const result = ValidationResultSchema.parse({
      formatter: { passed: true, output: "" },
      linter: { passed: false, output: "errors" },
      typecheck: { passed: true, output: "" },
      tests: { passed: true, output: "4 tests passed" },
      all_passed: false,
    });
    expect(result.linter?.passed).toBe(false);
    expect(result.tests?.output).toBe("4 tests passed");
  });
});
