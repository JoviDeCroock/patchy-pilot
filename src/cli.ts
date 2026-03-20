#!/usr/bin/env node

import { Command } from "commander";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import { parseGitHubIssue, fetchGitHubIssue } from "./github-issue.js";
import { runLearn } from "./learner.js";
import { runFeature, runReviewOnly } from "./runner.js";
import { log } from "./utils/logger.js";
import { prepareWorktreeSession } from "./utils/worktree.js";
import { loadReportData, generateReport } from "./report.js";
import { loadHistory, computeTrendStats } from "./history.js";
import { generateTrendsReport } from "./trends-report.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const program = new Command();

program
  .name("ppilot")
  .description("AI workflow harness: automatic review after AI coding sessions")
  .version(version);

program
  .command("feature")
  .description("Full workflow: build, gate, review, and rebuild on failures")
  .argument("<spec>", "Feature specification (inline text, GitHub issue or @path/to/file)")
  .option("--no-build", "Skip the build step (review existing changes)")
  .option("--no-review", "Skip the review step")
  .option("--plan", "Run a planner agent before building")
  .option("--worktree [name]", "Run the feature workflow in a new git worktree")
  .option("--silent", "Suppress real-time streamed output from provider steps")
  .option(
    "--max-rebuilds <count>",
    "Max rebuilds after a failed gate or review",
    parseNonNegativeInteger,
  )
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--builder <provider>", "Override builder provider")
  .option("--reviewer <provider>", "Override reviewer provider")
  .option("--planner <provider>", "Override planner provider")
  .option("--builder-model <model>", "Override builder model")
  .option("--reviewer-model <model>", "Override reviewer model")
  .option("--planner-model <model>", "Override planner model")
  .action(async (specArg: string, opts) => {
    try {
      const requestedCwd = resolve(opts.cwd);
      const worktree = await prepareWorktreeSession(requestedCwd, opts.worktree);
      const sessionCwd = worktree?.cwd ?? requestedCwd;

      if (worktree) {
        log.info(`Created worktree ${worktree.name} at ${worktree.root}`);
        if (sessionCwd !== worktree.root) {
          log.detail(`Running feature workflow from ${sessionCwd}`);
        }
      }

      const config = await loadConfig(sessionCwd);

      // Apply CLI overrides
      if (opts.builder) config.builder.provider = opts.builder;
      if (opts.reviewer) config.reviewer.provider = opts.reviewer;
      if (opts.planner) config.planner.provider = opts.planner;
      if (opts.builderModel) config.builder.model = opts.builderModel;
      if (opts.reviewerModel) config.reviewer.model = opts.reviewerModel;
      if (opts.plannerModel) config.planner.model = opts.plannerModel;
      if (opts.maxRebuilds !== undefined) config.workflow.max_rebuilds = opts.maxRebuilds;

      const spec = await resolveSpec(specArg, sessionCwd);
      const result = await runFeature({
        spec,
        config,
        cwd: sessionCwd,
        skipBuild: !opts.build,
        skipReview: !opts.review,
        plan: opts.plan,
        silent: opts.silent,
      });

      process.exit(result.exit_code);
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program
  .command("review")
  .description("Review-only: analyze existing changes against a spec")
  .argument("<spec>", "Feature specification (inline text or @path/to/file)")
  .option("--silent", "Suppress real-time streamed output from provider steps")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--reviewer <provider>", "Override reviewer provider")
  .option("--reviewer-model <model>", "Override reviewer model")
  .action(async (specArg: string, opts) => {
    try {
      const config = await loadConfig(opts.cwd);
      if (opts.reviewer) config.reviewer.provider = opts.reviewer;
      if (opts.reviewerModel) config.reviewer.model = opts.reviewerModel;

      const spec = await resolveSpec(specArg, opts.cwd);
      const result = await runReviewOnly({
        spec,
        config,
        cwd: resolve(opts.cwd),
        silent: opts.silent,
      });

      process.exit(result.validation.all_passed && result.gating.passed ? 0 : 1);
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program
  .command("learn")
  .description("Analyze past runs and generate reusable skills from recurring lessons")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--learner <provider>", "Override learner provider")
  .option("--learner-model <model>", "Override learner model")
  .option("--limit <count>", "How many recent runs to analyze", parseInteger, 10)
  .option("--out-dir <dir>", "Directory where learned skills are written", ".patchy-pilot/skills")
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.cwd);
      const result = await runLearn({
        config,
        cwd: resolve(opts.cwd),
        limit: opts.limit,
        provider: opts.learner,
        model: opts.learnerModel,
        outDir: opts.outDir,
      });

      log.divider();
      log.info(`Analyzed ${result.analyzed_runs} runs`);
      log.info(`Skills written to ${result.output_dir}`);
      log.info(result.overview);
      log.divider();
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program
  .command("report")
  .description("Generate an HTML report from a run's artifacts")
  .argument("[run-id]", "Run ID (timestamp) — defaults to the most recent run")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--artifacts-dir <dir>", "Artifacts directory", ".patchy-pilot/runs")
  .option("-o, --output <file>", "Output HTML file path (defaults to <run-dir>/report.html)")
  .action(async (runIdArg: string | undefined, opts) => {
    try {
      const runsDir = resolve(opts.cwd, opts.artifactsDir);
      const runId = runIdArg ?? (await getMostRecentRunId(runsDir));
      const runDir = join(runsDir, runId);
      const data = await loadReportData(runDir);
      const html = generateReport(data);

      const outPath = opts.output ? resolve(opts.output) : join(runDir, "report.html");

      await writeFile(outPath, html, "utf-8");
      log.success(`Report written to ${outPath}`);
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program
  .command("history")
  .description("Show a summary of past runs with key metrics")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--artifacts-dir <dir>", "Artifacts directory", ".patchy-pilot/runs")
  .option("--limit <count>", "How many recent runs to show", parseInteger, 20)
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    try {
      const runsDir = resolve(opts.cwd, opts.artifactsDir);
      const runs = await loadHistory(runsDir, opts.limit);

      if (opts.json) {
        const stats = computeTrendStats(runs);
        console.log(JSON.stringify({ runs, stats }, null, 2));
        return;
      }

      if (runs.length === 0) {
        log.warn("No runs found.");
        return;
      }

      const stats = computeTrendStats(runs);

      log.divider();
      log.info(`Run History (${runs.length} run${runs.length === 1 ? "" : "s"})`);
      log.divider();

      // Column widths
      const COL = { id: 19, date: 10, conf: 6, crit: 5, issues: 7, rec: 24, valid: 6, gate: 5 };
      const COLORS = {
        reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
        red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
        cyan: "\x1b[36m", gray: "\x1b[90m",
      };

      const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

      const header =
        `  ${pad("RUN ID", COL.id)}  ${pad("DATE", COL.date)}  ${pad("CONF", COL.conf)}  ` +
        `${pad("CRIT", COL.crit)}  ${pad("ISSUES", COL.issues)}  ${pad("RECOMMENDATION", COL.rec)}  ` +
        `${pad("VALID", COL.valid)}  GATE`;
      console.log(`${COLORS.dim}${header}${COLORS.reset}`);

      for (const r of runs) {
        const date = r.started_at.slice(0, 10);
        const conf = r.confidence !== undefined ? r.confidence.toFixed(2) : "—";
        const rec = (r.merge_recommendation ?? "—").replace(/_/g, " ");
        const gateColor = r.exit_code === 0 ? COLORS.green : COLORS.red;
        const gateStr = r.exit_code === 0 ? "PASS" : "FAIL";
        const validStr = r.validation_passed ? "✓" : "✗";
        const validColor = r.validation_passed ? COLORS.green : COLORS.red;
        const critColor = r.critical_issues > 0 ? COLORS.red : COLORS.reset;

        const line =
          `  ${pad(r.run_id, COL.id)}  ${pad(date, COL.date)}  ${pad(conf, COL.conf)}  ` +
          `${critColor}${pad(String(r.critical_issues), COL.crit)}${COLORS.reset}  ` +
          `${pad(String(r.total_issues), COL.issues)}  ${pad(rec, COL.rec)}  ` +
          `${validColor}${pad(validStr, COL.valid)}${COLORS.reset}  ` +
          `${gateColor}${gateStr}${COLORS.reset}`;
        console.log(line);
      }

      log.divider();

      const trendArrow =
        stats.confidence_trend === "improving" ? "↑" :
        stats.confidence_trend === "declining" ? "↓" : "→";
      const trendColor =
        stats.confidence_trend === "improving" ? COLORS.green :
        stats.confidence_trend === "declining" ? COLORS.red : COLORS.yellow;

      log.info(
        `${runs.length} runs  |  pass rate: ${Math.round(stats.pass_rate * 100)}%  |  ` +
        `avg confidence: ${stats.avg_confidence.toFixed(2)}  |  ` +
        `validation: ${Math.round(stats.validation_pass_rate * 100)}% pass`,
      );
      console.log(
        `  ${trendColor}${trendArrow} Confidence trend: ${stats.confidence_trend}${COLORS.reset}`,
      );

      if (Object.keys(stats.recommendation_distribution).length > 0) {
        const recParts = Object.entries(stats.recommendation_distribution)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
          .join("  |  ");
        log.detail(`Recommendations — ${recParts}`);
      }

      log.divider();
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program
  .command("trends")
  .description("Generate an HTML trends report across all runs")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--artifacts-dir <dir>", "Artifacts directory", ".patchy-pilot/runs")
  .option("--limit <count>", "How many recent runs to include", parseInteger, 50)
  .option("-o, --output <file>", "Output HTML file path (defaults to <artifacts-dir>/trends.html)")
  .action(async (opts) => {
    try {
      const runsDir = resolve(opts.cwd, opts.artifactsDir);
      const runs = await loadHistory(runsDir, opts.limit);

      if (runs.length === 0) {
        log.warn("No runs found — nothing to report.");
        return;
      }

      const stats = computeTrendStats(runs);
      const html = generateTrendsReport(runs, stats);

      const outPath = opts.output ? resolve(opts.output) : resolve(opts.cwd, opts.artifactsDir, "trends.html");
      await writeFile(outPath, html, "utf-8");
      log.success(`Trends report written to ${outPath}`);
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program.parse();

/** Resolve spec from inline text, @file reference, or GitHub issue reference */
async function resolveSpec(specArg: string, cwd?: string): Promise<string> {
  // Check for GitHub issue reference (URL or owner/repo#123)
  const issueRef = parseGitHubIssue(specArg);
  if (issueRef) {
    return fetchGitHubIssue(issueRef);
  }

  if (specArg.startsWith("@")) {
    const projectRoot = resolve(cwd ?? process.cwd());
    const filePath = resolve(projectRoot, specArg.slice(1));

    // Prevent path traversal outside project root
    if (!filePath.startsWith(projectRoot)) {
      throw new Error(
        `Spec file path "${specArg.slice(1)}" resolves outside the project root. ` +
          `Resolved: ${filePath}, Root: ${projectRoot}`,
      );
    }

    return readFile(filePath, "utf-8");
  }
  return specArg;
}

async function getMostRecentRunId(runsDir: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    throw new Error(`No runs directory found at ${runsDir}`);
  }
  // Run IDs are ISO-ish timestamps that sort lexicographically
  const sorted = entries.filter((e) => !e.startsWith(".")).sort();
  if (sorted.length === 0) {
    throw new Error(`No runs found in ${runsDir}`);
  }
  return sorted[sorted.length - 1];
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}
