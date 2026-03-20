import { describe, it, expect } from "vitest";
import { buildPrompt, buildContinuePrompt, type RebuildContext } from "./builder.js";

const rebuildContext: RebuildContext = {
  attempt: 2,
  failure_stage: "review",
  reasons: ["Reviewer recommended needs_changes", "Blocking category \"critical_issues\" has 1 issues"],
  validation: {
    formatter: { passed: true, output: "" },
    tests: { passed: false, output: "1 test failed" },
    all_passed: false,
  },
  review: {
    critical_issues: [{ description: "Missing null check", severity: "high" }],
    likely_bugs: [],
    missing_tests: [],
    spec_mismatches: [],
    risky_changes: [],
    hidden_assumptions: [],
    confidence: 0.7,
    merge_recommendation: "needs_changes",
    short_summary: "Needs one more fix.",
  },
};

describe("buildPrompt", () => {
  it("includes the specification in the prompt", () => {
    const prompt = buildPrompt("Add a login page");
    expect(prompt).toContain("Add a login page");
  });

  it("wraps the spec in <specification> tags", () => {
    const prompt = buildPrompt("My feature spec");
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("My feature spec");
    expect(prompt).toContain("</specification>");
  });

  it("includes the untrusted input warning", () => {
    const prompt = buildPrompt("anything");
    expect(prompt).toContain("untrusted user input");
  });

  it("includes implementation instructions", () => {
    const prompt = buildPrompt("anything");
    expect(prompt).toContain("Read the existing codebase");
    expect(prompt).toContain("Write tests");
  });

  it("asks for a summary", () => {
    const prompt = buildPrompt("anything");
    expect(prompt).toContain("What you implemented");
  });

  it("includes rebuild feedback when provided", () => {
    const prompt = buildPrompt("anything", { rebuildContext });
    expect(prompt).toContain("<previous-attempt-feedback>");
    expect(prompt).toContain("This is build attempt 2");
    expect(prompt).toContain("Reviewer recommended needs_changes");
    expect(prompt).toContain("[CRITICAL] Missing null check");
  });

  it("includes the implementation plan when provided in options", () => {
    const prompt = buildPrompt("anything", { plan: "1. Update the API" });
    expect(prompt).toContain("<implementation-plan>");
    expect(prompt).toContain("1. Update the API");
  });
});

describe("buildContinuePrompt", () => {
  it("summarizes retry feedback for continuation-capable providers", () => {
    const prompt = buildContinuePrompt(rebuildContext);
    expect(prompt).toContain("Revise the current implementation instead of starting over");
    expect(prompt).toContain("This is build attempt 2");
    expect(prompt).toContain("tests: failed");
    expect(prompt).toContain("Recommendation: needs_changes");
  });
});
