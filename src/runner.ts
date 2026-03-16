import { join } from "node:path";
import type { Config } from "./schemas/config.js";
import type { ReviewResult, RunResult } from "./schemas/review.js";
import { createProvider } from "./providers/index.js";
import { buildPrompt } from "./prompts/builder.js";
import { validate } from "./validator.js";
import { collectArtifacts } from "./collector.js";
import { runReview } from "./reviewer.js";
import { runRepair } from "./repairer.js";
import { evaluateGating } from "./gating.js";
import { ArtifactStore, createRunId } from "./utils/artifacts.js";
import { log } from "./utils/logger.js";

export interface FeatureOptions {
  spec: string;
  config: Config;
  cwd: string;
  skipBuild?: boolean;
  skipReview?: boolean;
  repair?: boolean;
}

export async function runFeature(opts: FeatureOptions): Promise<RunResult> {
  const runId = createRunId();
  const store = new ArtifactStore(join(opts.cwd, opts.config.artifacts_dir, runId));
  await store.init();

  const startedAt = new Date().toISOString();
  await store.save("spec.md", opts.spec);

  log.divider();
  log.info(`Run ${runId}`);
  log.divider();

  // Step 1: Build
  let builderSummary: string | undefined;
  if (!opts.skipBuild) {
    log.step("Starting builder");
    const builder = createProvider(opts.config.builder.provider, {
      model: opts.config.builder.model,
      dangerouslySkipPermissions: opts.config.builder.dangerouslySkipPermissions,
    });
    const prompt = buildPrompt(opts.spec);
    const result = await builder.run(prompt, { cwd: opts.cwd });
    builderSummary = result.output;
    await store.save("builder-output.txt", builderSummary);
    log.success(`Builder finished (exit ${result.exitCode})`);
  } else {
    log.info("Skipping build step");
  }

  // Step 2: Validate
  const validation = await validate(opts.config, opts.cwd);
  await store.save("validation.json", validation);

  // Step 3: Collect artifacts
  const artifacts = await collectArtifacts(
    opts.spec,
    validation,
    opts.config,
    opts.cwd,
    builderSummary
  );
  await store.save("artifacts.json", artifacts);

  // Step 4: Review
  let review: ReviewResult | undefined;
  if (!opts.skipReview) {
    const reviewer = createProvider(opts.config.reviewer.provider, {
      model: opts.config.reviewer.model,
      dangerouslySkipPermissions: opts.config.reviewer.dangerouslySkipPermissions,
    });
    try {
      review = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd);
      await store.save("review.json", review);
      printReviewSummary(review);
    } catch (err) {
      log.error(`Review failed: ${err}`);
      if (builderSummary) {
        await store.save("review-raw-output.txt", builderSummary);
      }
    }
  }

  // Step 5: Gating
  let gatingPassed = true;
  if (review) {
    const gating = evaluateGating(review, opts.config);
    gatingPassed = gating.passed;
    await store.save("gating.json", gating);
  }

  // Step 6: Optional repair
  let repairApplied = false;
  const shouldRepair = opts.repair ?? opts.config.repairer.enabled;
  if (review && !gatingPassed && shouldRepair) {
    const repairer = createProvider(opts.config.repairer.provider, {
      model: opts.config.repairer.model,
      dangerouslySkipPermissions: opts.config.repairer.dangerouslySkipPermissions,
    });
    const repairOutput = await runRepair(repairer, opts.spec, review, opts.cwd);
    await store.save("repair-output.txt", repairOutput);
    repairApplied = true;
  }

  // Step 7: Final summary
  const exitCode = review
    ? gatingPassed
      ? 0
      : repairApplied
        ? 0
        : 1
    : validation.all_passed
      ? 0
      : 1;

  const result: RunResult = {
    run_id: runId,
    spec: opts.spec,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    builder_provider: opts.config.builder.provider,
    reviewer_provider: opts.config.reviewer.provider,
    validation,
    review,
    repair_applied: repairApplied,
    exit_code: exitCode,
  };

  await store.save("result.json", result);

  log.divider();
  log.info(`Artifacts saved to ${store.path}`);
  if (exitCode === 0) {
    log.success("Run completed successfully");
  } else {
    log.error(`Run completed with issues (exit ${exitCode})`);
  }
  log.divider();

  return result;
}

export interface ReviewOnlyOptions {
  spec: string;
  config: Config;
  cwd: string;
}

export async function runReviewOnly(opts: ReviewOnlyOptions): Promise<ReviewResult> {
  const runId = createRunId();
  const store = new ArtifactStore(join(opts.cwd, opts.config.artifacts_dir, runId));
  await store.init();

  log.divider();
  log.info(`Review-only run ${runId}`);
  log.divider();

  const validation = await validate(opts.config, opts.cwd);
  const artifacts = await collectArtifacts(opts.spec, validation, opts.config, opts.cwd);
  await store.save("artifacts.json", artifacts);

  const reviewer = createProvider(opts.config.reviewer.provider, {
    model: opts.config.reviewer.model,
    dangerouslySkipPermissions: opts.config.reviewer.dangerouslySkipPermissions,
  });
  const review = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd);
  await store.save("review.json", review);

  printReviewSummary(review);

  const gating = evaluateGating(review, opts.config);
  await store.save("gating.json", gating);

  log.divider();
  log.info(`Artifacts saved to ${store.path}`);
  log.divider();

  return review;
}

function printReviewSummary(review: ReviewResult) {
  log.divider();
  log.step("Review Results");
  log.detail(`Confidence: ${review.confidence}`);
  log.detail(`Recommendation: ${review.merge_recommendation}`);
  log.detail(`Critical issues: ${review.critical_issues.length}`);
  log.detail(`Likely bugs: ${review.likely_bugs.length}`);
  log.detail(`Missing tests: ${review.missing_tests.length}`);
  log.detail(`Spec mismatches: ${review.spec_mismatches.length}`);
  log.detail(`Risky changes: ${review.risky_changes.length}`);
  log.detail(`Hidden assumptions: ${review.hidden_assumptions.length}`);
  log.info(review.short_summary);
}
