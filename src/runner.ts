import { join } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import type { Config } from "./schemas/config.js";
import type { ReviewResult, RunResult } from "./schemas/review.js";
import { createProvider } from "./providers/index.js";
import { buildPrompt } from "./prompts/builder.js";
import { validate } from "./validator.js";
import { collectArtifacts } from "./collector.js";
import { ReviewExecutionError, runReview } from "./reviewer.js";
import { runRepair } from "./repairer.js";
import { evaluateGating } from "./gating.js";
import { ArtifactStore, createRunId } from "./utils/artifacts.js";
import { runPlanner } from "./planner.js";
import { log } from "./utils/logger.js";

export interface FeatureOptions {
  spec: string;
  config: Config;
  cwd: string;
  skipBuild?: boolean;
  skipReview?: boolean;
  repair?: boolean;
  plan?: boolean;
  /** Stream real-time output from provider steps to the terminal. */
  stream?: boolean;
}

export async function runFeature(opts: FeatureOptions): Promise<RunResult> {
  const runId = createRunId();
  const store = new ArtifactStore(join(opts.cwd, opts.config.artifacts_dir, runId));
  await store.init();

  // Ensure .patchy-pilot/ is in the target project's .gitignore
  await ensureGitignore(opts.cwd);

  const startedAt = new Date().toISOString();
  await store.save("spec.md", opts.spec);

  log.divider();
  log.info(`Run ${runId}`);
  log.divider();

  const onData = opts.stream ? (chunk: string) => log.stream(chunk) : undefined;

  // Step 0: Plan (optional)
  let planText: string | undefined;
  if (opts.plan) {
    const planResult = await runPlanner({
      spec: opts.spec,
      config: opts.config,
      cwd: opts.cwd,
      store,
      onData,
    });
    if (planResult === null) {
      log.warn("Planning aborted by user");
      const abortResult: RunResult = {
        run_id: runId,
        spec: opts.spec,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        builder_provider: opts.config.builder.provider,
        reviewer_provider: opts.config.reviewer.provider,
        validation: { all_passed: false },
        repair_applied: false,
        exit_code: 2,
      };
      await store.save("result.json", abortResult);
      return abortResult;
    }
    planText = planResult.plan;
  }

  // Step 1: Build
  let builderSummary: string | undefined;
  if (!opts.skipBuild) {
    log.step("Starting builder");
    const builder = createProvider(opts.config.builder.provider, {
      model: opts.config.builder.model,
      dangerouslySkipPermissions: opts.config.builder.dangerouslySkipPermissions,
      role: "builder",
    });
    const prompt = buildPrompt(opts.spec, planText);
    const result = await builder.run(prompt, { cwd: opts.cwd, onData });
    console.log(result);
    builderSummary = result.output;
    await store.save("builder-output.txt", builderSummary);
    log.success(`Builder finished (exit ${result.exitCode})`);
    if (result.exitCode !== 0) {
      throw new Error(`Builder exited with code ${result.exitCode}`);
    }
  } else {
    log.info("Skipping build step");
  }

  // Step 2: Validate
  let validation = await validate(opts.config, opts.cwd);
  await store.save("validation.json", validation);

  // Step 3: Collect artifacts
  let artifacts = await collectArtifacts(
    opts.spec,
    validation,
    opts.config,
    opts.cwd,
    builderSummary
  );
  await store.save("artifacts.json", artifacts);

  // Step 4: Review
  let review: ReviewResult | undefined;  // eslint-disable-line prefer-const -- reassigned in repair loop
  if (!opts.skipReview) {
    const reviewer = createProvider(opts.config.reviewer.provider, {
      model: opts.config.reviewer.model,
      role: "reviewer",
    });
    try {
      review = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd, { onData });
      await store.save("review.json", review);
      printReviewSummary(review);
    } catch (err) {
      if (err instanceof ReviewExecutionError && err.rawOutput) {
        await store.save("review-raw-output.txt", err.rawOutput);
      }
      throw err;
    }
  }

  // Step 5: Gating
  let gatingPassed = validation.all_passed;
  if (review) {
    const gating = evaluateGating(review, opts.config);
    gatingPassed = validation.all_passed && gating.passed;
    await store.save("gating.json", gating);
  }

  // Step 6: Optional repair (capped iterations)
  let repairApplied = false;
  const shouldRepair = opts.repair ?? opts.config.repairer.enabled;
  const maxRepairIterations = opts.config.repairer.max_iterations;

  if (review && !gatingPassed && shouldRepair) {
    const repairer = createProvider(opts.config.repairer.provider, {
      model: opts.config.repairer.model,
      role: "repairer",
    });
    const reviewer = createProvider(opts.config.reviewer.provider, {
      model: opts.config.reviewer.model,
      role: "reviewer",
    });

    let currentReview = review;
    for (let attempt = 1; attempt <= maxRepairIterations; attempt++) {
      log.step(`Repair attempt ${attempt}/${maxRepairIterations}`);

      const repairOutput = await runRepair(repairer, opts.spec, currentReview, opts.cwd, { onData });
      await store.save(`repair-output-${attempt}.txt`, repairOutput.output);
      if (repairOutput.exitCode !== 0) {
        throw new Error(`Repairer exited with code ${repairOutput.exitCode}`);
      }
      repairApplied = true;

      validation = await validate(opts.config, opts.cwd);
      await store.save(`validation-repair-${attempt}.json`, validation);
      artifacts = await collectArtifacts(
        opts.spec,
        validation,
        opts.config,
        opts.cwd,
        builderSummary
      );
      await store.save(`artifacts-repair-${attempt}.json`, artifacts);

      try {
        currentReview = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd, { onData });
      } catch (err) {
        if (err instanceof ReviewExecutionError && err.rawOutput) {
          await store.save(`review-repair-${attempt}-raw-output.txt`, err.rawOutput);
        }
        throw err;
      }

      await store.save(`review-repair-${attempt}.json`, currentReview);
      const reGating = evaluateGating(currentReview, opts.config);
      await store.save(`gating-repair-${attempt}.json`, reGating);

      review = currentReview;
      gatingPassed = validation.all_passed && reGating.passed;

      if (gatingPassed) {
        log.success(`Repair succeeded on attempt ${attempt}`);
        break;
      }
    }

    if (!gatingPassed) {
      log.warn(`Repair did not resolve all issues after ${maxRepairIterations} attempts`);
    }
  }

  // Step 7: Final summary
  const exitCode = review
    ? gatingPassed
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
  stream?: boolean;
}

export interface ReviewOnlyResult {
  review: ReviewResult;
  gating: ReturnType<typeof evaluateGating>;
  validation: Awaited<ReturnType<typeof validate>>;
}

export async function runReviewOnly(opts: ReviewOnlyOptions): Promise<ReviewOnlyResult> {
  const runId = createRunId();
  const store = new ArtifactStore(join(opts.cwd, opts.config.artifacts_dir, runId));
  await store.init();

  await ensureGitignore(opts.cwd);

  log.divider();
  log.info(`Review-only run ${runId}`);
  log.divider();

  const onData = opts.stream ? (chunk: string) => log.stream(chunk) : undefined;

  const validation = await validate(opts.config, opts.cwd);
  const artifacts = await collectArtifacts(opts.spec, validation, opts.config, opts.cwd);
  await store.save("artifacts.json", artifacts);

  const reviewer = createProvider(opts.config.reviewer.provider, {
    model: opts.config.reviewer.model,
    role: "reviewer",
  });
  let review: ReviewResult;
  try {
    review = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd, { onData });
  } catch (err) {
    if (err instanceof ReviewExecutionError && err.rawOutput) {
      await store.save("review-raw-output.txt", err.rawOutput);
    }
    throw err;
  }
  await store.save("review.json", review);

  printReviewSummary(review);

  const gating = evaluateGating(review, opts.config);
  await store.save("gating.json", gating);

  log.divider();
  log.info(`Artifacts saved to ${store.path}`);
  log.divider();

  return {
    review,
    gating,
    validation,
  };
}

const GITIGNORE_ENTRY = ".patchy-pilot/";

async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  try {
    await access(gitignorePath);
    const content = await readFile(gitignorePath, "utf-8");
    if (content.includes(GITIGNORE_ENTRY)) return;
    await writeFile(gitignorePath, content.trimEnd() + `\n\n# Patchy Pilot artifacts\n${GITIGNORE_ENTRY}\n`, "utf-8");
    log.detail(`Added ${GITIGNORE_ENTRY} to .gitignore`);
  } catch {
    // No .gitignore exists — create one
    await writeFile(gitignorePath, `# Patchy Pilot artifacts\n${GITIGNORE_ENTRY}\n`, "utf-8");
    log.detail(`Created .gitignore with ${GITIGNORE_ENTRY}`);
  }
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
