import { join } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import type { Config } from "./schemas/config.js";
import type { ReviewResult, RunResult, StepUsage, ValidationResult } from "./schemas/review.js";
import { createProvider } from "./providers/index.js";
import { buildContinuePrompt, buildPrompt, type RebuildContext } from "./prompts/builder.js";
import { validate } from "./validator.js";
import { collectArtifacts } from "./collector.js";
import { ReviewExecutionError, runReview } from "./reviewer.js";
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
  plan?: boolean;
  /** Suppress real-time streamed output from provider steps. */
  silent?: boolean;
  /** Resume a previously interrupted run by its run ID. */
  resume?: string;
}

/**
 * Checkpoint saved after each major phase to enable resume on crash.
 * The checkpoint records which phases completed so the runner can
 * skip them on resume and pick up from the last incomplete phase.
 */
interface Checkpoint {
  phase: "planned" | "built" | "validated" | "reviewed" | "done";
  workflowAttempt: number;
  buildAttempts: number;
  rebuildsUsed: number;
  planText?: string;
  builderSummary?: string;
}

export async function runFeature(opts: FeatureOptions): Promise<RunResult> {
  // Resume mode: reload checkpoint from a previous interrupted run
  let runId: string;
  let store: ArtifactStore;
  let checkpoint: Checkpoint | undefined;

  if (opts.resume) {
    runId = opts.resume;
    store = new ArtifactStore(join(opts.cwd, opts.config.artifacts_dir, runId));
    if (await store.exists("checkpoint.json")) {
      checkpoint = await store.load<Checkpoint>("checkpoint.json");
      log.info(`Resuming run ${runId} from phase "${checkpoint.phase}"`);
    } else {
      log.warn(`No checkpoint found for run ${runId}, starting fresh`);
      checkpoint = undefined;
    }
  } else {
    runId = createRunId();
    store = new ArtifactStore(join(opts.cwd, opts.config.artifacts_dir, runId));
    await store.init();
  }

  // Ensure .patchy-pilot/ is in the target project's .gitignore
  await ensureGitignore(opts.cwd);

  const startedAt = new Date().toISOString();
  await store.save("spec.md", opts.spec);

  log.divider();
  log.info(`Run ${runId}`);
  log.divider();

  const onData = opts.silent ? undefined : (chunk: string) => log.stream(chunk);

  // Step 0: Plan (optional) — skip if checkpoint shows planning already done
  let planText: string | undefined = checkpoint?.planText;
  if (opts.plan && !planText) {
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
        build_attempts: 0,
        rebuilds_used: 0,
        max_rebuilds: opts.skipBuild ? 0 : opts.config.workflow.max_rebuilds,
        validation: { all_passed: false },
        exit_code: 2,
      };
      await store.save("result.json", abortResult);
      return abortResult;
    }
    planText = planResult.plan;
    await saveCheckpoint(store, { phase: "planned", workflowAttempt: 0, buildAttempts: 0, rebuildsUsed: 0, planText });
  }

  const maxRebuilds = opts.skipBuild ? 0 : opts.config.workflow.max_rebuilds;
  const builder = opts.skipBuild
    ? undefined
    : createProvider(opts.config.builder.provider, {
        model: opts.config.builder.model,
        dangerouslySkipPermissions: opts.config.builder.dangerouslySkipPermissions,
        role: "builder",
      });
  const reviewer = opts.skipReview
    ? undefined
    : createProvider(opts.config.reviewer.provider, {
        model: opts.config.reviewer.model,
        role: "reviewer",
      });

  let builderSummary: string | undefined = checkpoint?.builderSummary;
  let validation: ValidationResult = { all_passed: false };
  let artifacts: Awaited<ReturnType<typeof collectArtifacts>> | undefined;
  let review: ReviewResult | undefined;
  let reviewApproval:
    | {
        passed: boolean;
        reasons: string[];
      }
    | undefined;
  let buildAttempts = checkpoint?.buildAttempts ?? 0;
  let rebuildsUsed = checkpoint?.rebuildsUsed ?? 0;
  let rebuildContext: RebuildContext | undefined;
  let workflowAttempt = checkpoint?.workflowAttempt ?? 0;
  const tokenUsage: StepUsage[] = [];

  // If resuming from a phase past "built", skip the build loop entry
  const skipBuildOnResume = checkpoint && (checkpoint.phase === "validated" || checkpoint.phase === "reviewed");

  while (true) {
    workflowAttempt++;
    artifacts = undefined;
    review = undefined;
    reviewApproval = undefined;

    if (builder && !skipBuildOnResume) {
      buildAttempts++;
      log.step(
        `Starting builder (attempt ${buildAttempts}${maxRebuilds > 0 ? `/${maxRebuilds + 1}` : ""})`,
      );

      // Context reset strategy (from Anthropic harness design):
      // On rebuilds, prefer a fresh session with structured handoff over
      // continuing a polluted context. Context resets give the model a
      // clean slate while carrying forward concrete failure feedback.
      // Only use session continuation for the first rebuild where context
      // is still fresh; after that, reset to avoid "context anxiety."
      const useContextReset = rebuildContext && rebuildsUsed > 1;
      const useContinue =
        rebuildContext && builder.supportsContinue && !useContextReset;

      const prompt = rebuildContext
        ? useContinue
          ? buildContinuePrompt(rebuildContext)
          : buildPrompt(opts.spec, { plan: planText, rebuildContext })
        : buildPrompt(opts.spec, { plan: planText });

      if (useContextReset && rebuildContext) {
        log.detail("Using context reset with structured handoff (fresh session)");
      }

      const result = await builder.run(prompt, {
        cwd: opts.cwd,
        onData,
        continue: useContinue || undefined,
      });
      builderSummary = result.output;
      await store.save(attemptArtifactName("builder-output.txt", workflowAttempt), builderSummary);
      if (result.usage) {
        tokenUsage.push({
          step: "builder",
          attempt: workflowAttempt,
          usage: result.usage,
        });
      }
      log.success(`Builder finished (exit ${result.exitCode})`);
      if (result.exitCode !== 0) {
        throw new Error(`Builder exited with code ${result.exitCode}`);
      }

      await saveCheckpoint(store, { phase: "built", workflowAttempt, buildAttempts, rebuildsUsed, planText, builderSummary });
    } else if (workflowAttempt === 1 && !skipBuildOnResume) {
      log.info("Skipping build step");
    }

    validation = await validate(opts.config, opts.cwd);
    await store.save(attemptArtifactName("validation.json", workflowAttempt), validation);
    await saveCheckpoint(store, { phase: "validated", workflowAttempt, buildAttempts, rebuildsUsed, planText, builderSummary });

    const gateReasons = getValidationFailureReasons(validation);
    if (gateReasons.length > 0) {
      log.warn("Gate: FAILED");
      gateReasons.forEach((reason) => log.detail(reason));

      if (!builder || rebuildsUsed >= maxRebuilds) {
        break;
      }

      rebuildsUsed++;
      rebuildContext = {
        attempt: buildAttempts + 1,
        failure_stage: "gate",
        reasons: gateReasons,
        validation,
      };
      log.warn(`Bouncing back to build (${rebuildsUsed}/${maxRebuilds} rebuilds used)`);
      continue;
    }

    log.success("Gate: PASSED");

    artifacts = await collectArtifacts(
      opts.spec,
      validation,
      opts.config,
      opts.cwd,
      builderSummary,
    );
    await store.save(attemptArtifactName("artifacts.json", workflowAttempt), artifacts);

    if (!reviewer) {
      break;
    }

    try {
      const reviewResponse = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd, { onData, plan: planText });
      review = reviewResponse.review;
      if (reviewResponse.usage) {
        tokenUsage.push({
          step: "reviewer",
          attempt: workflowAttempt,
          usage: reviewResponse.usage,
        });
      }
      await store.save(attemptArtifactName("review.json", workflowAttempt), review);
      await saveCheckpoint(store, { phase: "reviewed", workflowAttempt, buildAttempts, rebuildsUsed, planText, builderSummary });
      printReviewSummary(review);
    } catch (err) {
      if (err instanceof ReviewExecutionError && err.rawOutput) {
        await store.save(
          attemptArtifactName("review-raw-output.txt", workflowAttempt),
          err.rawOutput,
        );
      }
      throw err;
    }

    reviewApproval = evaluateReviewApproval(review, opts.config);
    await store.save(attemptArtifactName("gating.json", workflowAttempt), reviewApproval);

    if (reviewApproval.passed) {
      rebuildContext = undefined;
      break;
    }

    if (!builder || rebuildsUsed >= maxRebuilds) {
      break;
    }

    rebuildsUsed++;
    rebuildContext = {
      attempt: buildAttempts + 1,
      failure_stage: "review",
      reasons: reviewApproval.reasons,
      validation,
      review,
    };
    log.warn(
      `Review not approved; bouncing back to build (${rebuildsUsed}/${maxRebuilds} rebuilds used)`,
    );
  }

  if (builderSummary) {
    await store.save("builder-output.txt", builderSummary);
  }
  await store.save("validation.json", validation);
  if (artifacts) {
    await store.save("artifacts.json", artifacts);
  }
  if (review) {
    await store.save("review.json", review);
  }
  if (reviewApproval) {
    await store.save("gating.json", reviewApproval);
  }

  const exitCode = validation.all_passed && (opts.skipReview || reviewApproval?.passed) ? 0 : 1;

  // Aggregate token usage
  const totalTokens = tokenUsage.length > 0
    ? {
        input_tokens: tokenUsage.reduce((sum, s) => sum + (s.usage.input_tokens ?? 0), 0) || undefined,
        output_tokens: tokenUsage.reduce((sum, s) => sum + (s.usage.output_tokens ?? 0), 0) || undefined,
      }
    : undefined;

  const result: RunResult = {
    run_id: runId,
    spec: opts.spec,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    builder_provider: opts.config.builder.provider,
    reviewer_provider: opts.config.reviewer.provider,
    build_attempts: buildAttempts,
    rebuilds_used: rebuildsUsed,
    max_rebuilds: maxRebuilds,
    validation,
    review,
    review_approved: opts.skipReview ? undefined : (reviewApproval?.passed ?? false),
    exit_code: exitCode,
    token_usage: tokenUsage.length > 0 ? tokenUsage : undefined,
    total_tokens: totalTokens,
  };

  await store.save("result.json", result);
  await saveCheckpoint(store, { phase: "done", workflowAttempt, buildAttempts, rebuildsUsed, planText, builderSummary });

  log.divider();
  log.info(`Artifacts saved to ${store.path}`);
  if (totalTokens) {
    const parts: string[] = [];
    if (totalTokens.input_tokens) parts.push(`${totalTokens.input_tokens.toLocaleString()} input`);
    if (totalTokens.output_tokens) parts.push(`${totalTokens.output_tokens.toLocaleString()} output`);
    if (parts.length > 0) log.detail(`Token usage: ${parts.join(", ")}`);
  }
  if (exitCode === 0) {
    log.success("Run completed successfully");
  } else {
    log.error(`Run completed with issues (exit ${exitCode})`);
  }
  log.divider();

  return result;
}

function attemptArtifactName(name: string, attempt: number): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) {
    return `${name}-attempt-${attempt}`;
  }

  return `${name.slice(0, dotIndex)}-attempt-${attempt}${name.slice(dotIndex)}`;
}

function getValidationFailureReasons(validation: ValidationResult): string[] {
  const reasons: string[] = [];
  const checks: Array<keyof Omit<ValidationResult, "all_passed">> = [
    "formatter",
    "linter",
    "typecheck",
    "tests",
  ];

  for (const check of checks) {
    const result = validation[check];
    if (!result || result.passed) {
      continue;
    }

    const excerpt = firstOutputLine(result.output);
    reasons.push(
      excerpt ? `${capitalize(check)} failed: ${excerpt}` : `${capitalize(check)} failed`,
    );
  }

  if (reasons.length === 0 && !validation.all_passed) {
    reasons.push("One or more validation checks failed");
  }

  return reasons;
}

function evaluateReviewApproval(
  review: ReviewResult,
  config: Config,
): { passed: boolean; reasons: string[] } {
  const gating = evaluateGating(review, config);
  const reasons = [...gating.reasons];

  if (review.merge_recommendation !== "safe_to_merge") {
    reasons.unshift(`Reviewer recommended ${review.merge_recommendation}`);
    log.warn("Review approval: FAILED");
    log.detail(`Reviewer recommended ${review.merge_recommendation}`);
  } else if (gating.passed) {
    log.success("Review approval: PASSED");
  } else {
    log.warn("Review approval: FAILED");
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

function firstOutputLine(output: string): string | undefined {
  const line = output
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ? line.slice(0, 200) : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface ReviewOnlyOptions {
  spec: string;
  config: Config;
  cwd: string;
  silent?: boolean;
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

  const onData = opts.silent ? undefined : (chunk: string) => log.stream(chunk);

  const validation = await validate(opts.config, opts.cwd);
  const artifacts = await collectArtifacts(opts.spec, validation, opts.config, opts.cwd);
  await store.save("artifacts.json", artifacts);

  const reviewer = createProvider(opts.config.reviewer.provider, {
    model: opts.config.reviewer.model,
    role: "reviewer",
  });
  let review: ReviewResult;
  try {
    const reviewResponse = await runReview(reviewer, artifacts, opts.config.review_rules, opts.cwd, { onData });
    review = reviewResponse.review;
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
    await writeFile(
      gitignorePath,
      content.trimEnd() + `\n\n# Patchy Pilot artifacts\n${GITIGNORE_ENTRY}\n`,
      "utf-8",
    );
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

async function saveCheckpoint(store: ArtifactStore, checkpoint: Checkpoint): Promise<void> {
  await store.save("checkpoint.json", checkpoint);
}
