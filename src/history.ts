import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunResult } from "./schemas/review.js";
import type { GatingResult } from "./gating.js";

export interface RunSummary {
  run_id: string;
  started_at: string;
  completed_at: string;
  builder_provider: string;
  reviewer_provider: string;
  confidence?: number;
  merge_recommendation?: string;
  critical_issues: number;
  high_issues: number;
  total_issues: number;
  validation_passed: boolean;
  gating_passed: boolean;
  repair_applied: boolean;
  exit_code: number;
  spec_preview: string;
}

export interface TrendStats {
  total_runs: number;
  pass_rate: number;
  avg_confidence: number;
  confidence_trend: "improving" | "declining" | "stable";
  recommendation_distribution: Record<string, number>;
  validation_pass_rate: number;
}

function countHighSeverity(review: NonNullable<RunResult["review"]>): number {
  const categories = [
    "critical_issues",
    "likely_bugs",
    "missing_tests",
    "spec_mismatches",
    "risky_changes",
    "hidden_assumptions",
  ] as const;
  let count = 0;
  for (const cat of categories) {
    for (const issue of review[cat]) {
      if (issue.severity === "high") count++;
    }
  }
  return count;
}

function countTotalIssues(review: NonNullable<RunResult["review"]>): number {
  return (
    review.critical_issues.length +
    review.likely_bugs.length +
    review.missing_tests.length +
    review.spec_mismatches.length +
    review.risky_changes.length +
    review.hidden_assumptions.length
  );
}

export async function loadHistory(runsDir: string, limit = 50): Promise<RunSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const runIds = entries
    .filter((e) => !e.startsWith("."))
    .sort()
    .slice(-limit)
    .reverse(); // newest first

  const summaries: RunSummary[] = [];

  for (const runId of runIds) {
    try {
      const runDir = join(runsDir, runId);
      const resultRaw = await readFile(join(runDir, "result.json"), "utf-8");
      const result: RunResult = JSON.parse(resultRaw);

      let gatingPassed = result.exit_code === 0;
      try {
        const gatingRaw = await readFile(join(runDir, "gating.json"), "utf-8");
        const gating: GatingResult = JSON.parse(gatingRaw);
        gatingPassed = gating.passed;
      } catch {
        // gating.json may not exist for review-skipped runs
      }

      const review = result.review;

      summaries.push({
        run_id: result.run_id,
        started_at: result.started_at,
        completed_at: result.completed_at,
        builder_provider: result.builder_provider,
        reviewer_provider: result.reviewer_provider,
        confidence: review?.confidence,
        merge_recommendation: review?.merge_recommendation,
        critical_issues: review ? review.critical_issues.length : 0,
        high_issues: review ? countHighSeverity(review) : 0,
        total_issues: review ? countTotalIssues(review) : 0,
        validation_passed: result.validation.all_passed,
        gating_passed: gatingPassed,
        repair_applied: result.repair_applied,
        exit_code: result.exit_code,
        spec_preview: result.spec.slice(0, 60).replace(/\n/g, " "),
      });
    } catch {
      // skip unreadable runs
    }
  }

  return summaries;
}

export function computeTrendStats(runs: RunSummary[]): TrendStats {
  if (runs.length === 0) {
    return {
      total_runs: 0,
      pass_rate: 0,
      avg_confidence: 0,
      confidence_trend: "stable",
      recommendation_distribution: {},
      validation_pass_rate: 0,
    };
  }

  const passRate = runs.filter((r) => r.exit_code === 0).length / runs.length;

  const withConfidence = runs.filter((r) => r.confidence !== undefined);
  const avgConfidence =
    withConfidence.length > 0
      ? withConfidence.reduce((sum, r) => sum + r.confidence!, 0) / withConfidence.length
      : 0;

  // Compare first-half vs second-half confidence (runs are newest-first, so reverse for chronological)
  let confidenceTrend: "improving" | "declining" | "stable" = "stable";
  if (withConfidence.length >= 4) {
    const chron = [...withConfidence].reverse();
    const half = Math.floor(chron.length / 2);
    const firstAvg = chron.slice(0, half).reduce((s, r) => s + r.confidence!, 0) / half;
    const secondAvg = chron.slice(half).reduce((s, r) => s + r.confidence!, 0) / (chron.length - half);
    const delta = secondAvg - firstAvg;
    if (delta > 0.05) confidenceTrend = "improving";
    else if (delta < -0.05) confidenceTrend = "declining";
  }

  const recDist: Record<string, number> = {};
  for (const run of runs) {
    if (run.merge_recommendation) {
      recDist[run.merge_recommendation] = (recDist[run.merge_recommendation] ?? 0) + 1;
    }
  }

  const validationPassRate = runs.filter((r) => r.validation_passed).length / runs.length;

  return {
    total_runs: runs.length,
    pass_rate: passRate,
    avg_confidence: avgConfidence,
    confidence_trend: confidenceTrend,
    recommendation_distribution: recDist,
    validation_pass_rate: validationPassRate,
  };
}
