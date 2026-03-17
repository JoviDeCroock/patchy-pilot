import type { ReviewResult } from "./schemas/review.js";
import type { Config } from "./schemas/config.js";
import { log } from "./utils/logger.js";

export interface GatingResult {
  passed: boolean;
  reasons: string[];
}

export function evaluateGating(review: ReviewResult, config: Config): GatingResult {
  const reasons: string[] = [];
  const t = config.thresholds;

  if (review.critical_issues.length > t.max_critical) {
    reasons.push(`${review.critical_issues.length} critical issues (max: ${t.max_critical})`);
  }

  const highCount = [
    ...review.critical_issues,
    ...review.likely_bugs,
    ...review.spec_mismatches,
  ].filter((i) => i.severity === "high").length;

  if (highCount > t.max_high) {
    reasons.push(`${highCount} high-severity issues (max: ${t.max_high})`);
  }

  if (review.confidence < t.min_confidence) {
    reasons.push(`Confidence ${review.confidence} below threshold ${t.min_confidence}`);
  }

  for (const category of t.block_on) {
    const issues = review[category];
    if (Array.isArray(issues) && issues.length > 0) {
      reasons.push(`Blocking category "${category}" has ${issues.length} issues`);
    }
  }

  const passed = reasons.length === 0;

  if (passed) {
    log.success("Gating: PASSED");
  } else {
    log.warn("Gating: FAILED");
    reasons.forEach((r) => log.detail(r));
  }

  return { passed, reasons };
}
