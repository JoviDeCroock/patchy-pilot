#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { runLearn } from "./learner.js";
import { runFeature, runReviewOnly } from "./runner.js";
import { runRepair } from "./repairer.js";
import { createProvider } from "./providers/index.js";
import { log } from "./utils/logger.js";

const program = new Command();

program
  .name("ppilot")
  .description("AI workflow harness: automatic review after AI coding sessions")
  .version("0.1.0");

program
  .command("feature")
  .description("Full workflow: build a feature, validate, review, and optionally repair")
  .argument("<spec>", "Feature specification (inline text or @path/to/file)")
  .option("--no-build", "Skip the build step (review existing changes)")
  .option("--no-review", "Skip the review step")
  .option("--repair", "Enable repair pass if review finds issues")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--builder <provider>", "Override builder provider")
  .option("--reviewer <provider>", "Override reviewer provider")
  .option("--builder-model <model>", "Override builder model")
  .option("--reviewer-model <model>", "Override reviewer model")
  .action(async (specArg: string, opts) => {
    try {
      const config = await loadConfig(opts.cwd);

      // Apply CLI overrides
      if (opts.builder) config.builder.provider = opts.builder;
      if (opts.reviewer) config.reviewer.provider = opts.reviewer;
      if (opts.builderModel) config.builder.model = opts.builderModel;
      if (opts.reviewerModel) config.reviewer.model = opts.reviewerModel;

      const spec = await resolveSpec(specArg);
      const result = await runFeature({
        spec,
        config,
        cwd: resolve(opts.cwd),
        skipBuild: !opts.build,
        skipReview: !opts.review,
        repair: opts.repair,
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
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--reviewer <provider>", "Override reviewer provider")
  .option("--reviewer-model <model>", "Override reviewer model")
  .action(async (specArg: string, opts) => {
    try {
      const config = await loadConfig(opts.cwd);
      if (opts.reviewer) config.reviewer.provider = opts.reviewer;
      if (opts.reviewerModel) config.reviewer.model = opts.reviewerModel;

      const spec = await resolveSpec(specArg);
      const review = await runReviewOnly({
        spec,
        config,
        cwd: resolve(opts.cwd),
      });

      const hasBlockers =
        review.critical_issues.length > 0 ||
        review.merge_recommendation === "do_not_merge";
      process.exit(hasBlockers ? 1 : 0);
    } catch (err) {
      log.error(String(err));
      process.exit(2);
    }
  });

program
  .command("repair")
  .description("Repair pass: fix issues from a review result file")
  .argument("<review-file>", "Path to review.json from a previous run")
  .argument("<spec>", "Original specification (inline text or @path/to/file)")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("--repairer <provider>", "Override repairer provider")
  .option("--repairer-model <model>", "Override repairer model")
  .action(async (reviewFile: string, specArg: string, opts) => {
    try {
      const config = await loadConfig(opts.cwd);
      if (opts.repairer) config.repairer.provider = opts.repairer;
      if (opts.repairerModel) config.repairer.model = opts.repairerModel;

      const spec = await resolveSpec(specArg);
      const reviewRaw = await readFile(resolve(reviewFile), "utf-8");
      const review = JSON.parse(reviewRaw);

      const provider = createProvider(config.repairer.provider, {
        model: config.repairer.model,
        dangerouslySkipPermissions: config.repairer.dangerouslySkipPermissions,
      });
      const output = await runRepair(provider, spec, review, resolve(opts.cwd));

      console.log(output);
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

program.parse();

/** Resolve spec from inline text or @file reference */
async function resolveSpec(specArg: string): Promise<string> {
  if (specArg.startsWith("@")) {
    const path = resolve(specArg.slice(1));
    return readFile(path, "utf-8");
  }
  return specArg;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}
