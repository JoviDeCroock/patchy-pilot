import type { ReviewResult } from "../schemas/review.js";

export function repairPrompt(spec: string, review: ReviewResult): string {
  const issues = [
    ...review.critical_issues.map((i) => `[CRITICAL] ${i.description}${i.suggestion ? ` — Suggestion: ${i.suggestion}` : ""}`),
    ...review.likely_bugs.map((i) => `[BUG] ${i.description}${i.suggestion ? ` — Suggestion: ${i.suggestion}` : ""}`),
    ...review.spec_mismatches.map((i) => `[SPEC] ${i.description}${i.suggestion ? ` — Suggestion: ${i.suggestion}` : ""}`),
    ...review.missing_tests.map((i) => `[TEST] ${i.description}${i.suggestion ? ` — Suggestion: ${i.suggestion}` : ""}`),
  ];

  return `You are fixing issues found during code review.

## Original Specification

${spec}

## Review Findings

The following issues were found by an independent reviewer:

${issues.map((i) => `- ${i}`).join("\n")}

## Reviewer Summary

${review.short_summary}

## Instructions

1. Address each issue listed above
2. Focus on critical issues and bugs first
3. Add missing tests where flagged
4. Fix spec mismatches
5. Do not introduce new features or make unrelated changes
6. After fixing, provide a brief summary of what you changed`;
}
