import { describe, it, expect } from "vitest";
import { generateReport } from "./report.js";
import type { RunResult } from "./schemas/review.js";
import type { GatingResult } from "./gating.js";

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    run_id: "2026-03-17T10-00-00",
    spec: "Add a login button",
    started_at: "2026-03-17T10:00:00.000Z",
    completed_at: "2026-03-17T10:02:30.000Z",
    builder_provider: "claude-code",
    reviewer_provider: "claude-code",
    build_attempts: 1,
    rebuilds_used: 0,
    max_rebuilds: 2,
    validation: { all_passed: true },
    review: {
      critical_issues: [],
      likely_bugs: [],
      missing_tests: [],
      spec_mismatches: [],
      risky_changes: [],
      hidden_assumptions: [],
      confidence: 0.9,
      merge_recommendation: "safe_to_merge",
      short_summary: "Implementation looks good.",
    },
    review_approved: true,
    exit_code: 0,
    ...overrides,
  };
}

describe("generateReport", () => {
  it("produces valid HTML with doctype", () => {
    const html = generateReport({ result: makeRunResult() });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("</html>");
  });

  it("includes run ID in the report", () => {
    const html = generateReport({ result: makeRunResult() });
    expect(html).toContain("2026-03-17T10-00-00");
  });

  it("shows PASSED for exit code 0", () => {
    const html = generateReport({ result: makeRunResult({ exit_code: 0 }) });
    expect(html).toContain("PASSED");
  });

  it("shows FAILED for non-zero exit code", () => {
    const html = generateReport({ result: makeRunResult({ exit_code: 1 }) });
    expect(html).toContain("FAILED");
  });

  it("includes the spec", () => {
    const html = generateReport({
      result: makeRunResult({ spec: "Build a REST API" }),
    });
    expect(html).toContain("Build a REST API");
  });

  it("escapes HTML in spec", () => {
    const html = generateReport({
      result: makeRunResult({ spec: '<script>alert("xss")</script>' }),
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows review confidence and recommendation", () => {
    const html = generateReport({ result: makeRunResult() });
    expect(html).toContain("0.90");
    expect(html).toContain("safe to merge");
  });

  it("shows skipped review message when review is undefined", () => {
    const html = generateReport({
      result: makeRunResult({ review: undefined }),
    });
    expect(html).toContain("Review was skipped");
  });

  it("shows rebuild tag when rebuilds were used", () => {
    const html = generateReport({
      result: makeRunResult({ build_attempts: 3, rebuilds_used: 2 }),
    });
    expect(html).toContain("2 rebuilds used");
  });

  it("does not show rebuild tag when no rebuilds were used", () => {
    const html = generateReport({
      result: makeRunResult({ rebuilds_used: 0 }),
    });
    expect(html).not.toContain("rebuilds used");
  });

  it("renders gating section when provided", () => {
    const gating: GatingResult = { passed: true, reasons: [] };
    const html = generateReport({ result: makeRunResult(), gating });
    expect(html).toContain("Gating");
    expect(html).toContain("passed");
  });

  it("renders gating failure reasons", () => {
    const gating: GatingResult = {
      passed: false,
      reasons: ["2 critical issues (max: 0)"],
    };
    const html = generateReport({ result: makeRunResult(), gating });
    expect(html).toContain("2 critical issues (max: 0)");
  });

  it("renders issues when present", () => {
    const result = makeRunResult({
      review: {
        critical_issues: [
          {
            description: "SQL injection vulnerability",
            severity: "critical",
            file: "db.ts",
            line: 42,
          },
        ],
        likely_bugs: [],
        missing_tests: [],
        spec_mismatches: [],
        risky_changes: [],
        hidden_assumptions: [],
        confidence: 0.5,
        merge_recommendation: "do_not_merge",
        short_summary: "Critical security issue found.",
      },
    });
    const html = generateReport({ result });
    expect(html).toContain("SQL injection vulnerability");
    expect(html).toContain("db.ts:42");
    expect(html).toContain("Critical Issues");
  });

  it("shows validation check results", () => {
    const result = makeRunResult({
      validation: {
        formatter: { passed: true, output: "" },
        linter: { passed: false, output: "2 errors" },
        all_passed: false,
      },
    });
    const html = generateReport({ result });
    expect(html).toContain("formatter");
    expect(html).toContain("linter");
    expect(html).toContain("failures");
  });

  it("shows duration in minutes and seconds", () => {
    const html = generateReport({
      result: makeRunResult({
        started_at: "2026-03-17T10:00:00.000Z",
        completed_at: "2026-03-17T10:02:30.000Z",
      }),
    });
    expect(html).toContain("2m 30s");
  });

  it("shows duration in seconds for short runs", () => {
    const html = generateReport({
      result: makeRunResult({
        started_at: "2026-03-17T10:00:00.000Z",
        completed_at: "2026-03-17T10:00:45.000Z",
      }),
    });
    expect(html).toContain("45s");
  });
});
