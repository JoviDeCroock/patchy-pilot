import { z } from "zod";
import { ValidationCommandSchema } from "./config.js";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const IssueSchema = z.object({
  description: z.string(),
  severity: SeveritySchema,
  file: z.string().optional(),
  line: z.number().optional(),
  suggestion: z.string().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const MergeRecommendation = z.enum([
  "safe_to_merge",
  "merge_with_minor_fixes",
  "needs_changes",
  "do_not_merge",
]);

export const ReviewResultSchema = z.object({
  critical_issues: z.array(IssueSchema),
  likely_bugs: z.array(IssueSchema),
  missing_tests: z.array(IssueSchema),
  spec_mismatches: z.array(IssueSchema),
  risky_changes: z.array(IssueSchema),
  hidden_assumptions: z.array(IssueSchema),
  confidence: z.number().min(0).max(1),
  merge_recommendation: MergeRecommendation,
  short_summary: z.string(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const ValidationResultSchema = z.object({
  formatter: z.object({ passed: z.boolean(), output: z.string() }).optional(),
  linter: z.object({ passed: z.boolean(), output: z.string() }).optional(),
  typecheck: z.object({ passed: z.boolean(), output: z.string() }).optional(),
  tests: z.object({ passed: z.boolean(), output: z.string() }).optional(),
  all_passed: z.boolean(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const ArtifactsSchema = z.object({
  spec: z.string(),
  git_diff: z.string(),
  changed_files: z.array(z.string()),
  file_contents: z.record(z.string(), z.string()),
  validation: ValidationResultSchema,
  builder_summary: z.string().optional(),
  project_context: z
    .object({
      package_manager: z.string().optional(),
      package_scripts: z.record(z.string(), z.string()),
      ci_files: z.array(
        z.object({
          path: z.string(),
          excerpt: z.string(),
        }),
      ),
      inferred_validation: z.object({
        formatter: ValidationCommandSchema.extend({
          source: z.enum(["package.json", "ci"]),
          detail: z.string(),
        }).optional(),
        linter: ValidationCommandSchema.extend({
          source: z.enum(["package.json", "ci"]),
          detail: z.string(),
        }).optional(),
        typecheck: ValidationCommandSchema.extend({
          source: z.enum(["package.json", "ci"]),
          detail: z.string(),
        }).optional(),
        tests: ValidationCommandSchema.extend({
          source: z.enum(["package.json", "ci"]),
          detail: z.string(),
        }).optional(),
      }),
    })
    .optional(),
});
export type Artifacts = z.infer<typeof ArtifactsSchema>;

const TokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
});

const StepUsageSchema = z.object({
  step: z.string(),
  attempt: z.number().int().optional(),
  usage: TokenUsageSchema,
});

export const RunResultSchema = z.object({
  run_id: z.string(),
  spec: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
  builder_provider: z.string(),
  reviewer_provider: z.string(),
  build_attempts: z.number().int().nonnegative(),
  rebuilds_used: z.number().int().nonnegative(),
  max_rebuilds: z.number().int().nonnegative(),
  validation: ValidationResultSchema,
  review: ReviewResultSchema.optional(),
  review_approved: z.boolean().optional(),
  exit_code: z.number(),
  /** Per-step token usage for cost tracking. */
  token_usage: z.array(StepUsageSchema).optional(),
  /** Total tokens across all steps. */
  total_tokens: TokenUsageSchema.optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type StepUsage = z.infer<typeof StepUsageSchema>;
