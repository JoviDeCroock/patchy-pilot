import { z } from "zod";

export const ProviderConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

export const ValidationCommandSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  selective: z.boolean().default(false),
});
export type ValidationCommand = z.infer<typeof ValidationCommandSchema>;

export const ThresholdConfigSchema = z.object({
  max_critical: z.number().default(0),
  max_high: z.number().default(2),
  min_confidence: z.number().default(0.6),
  block_on: z
    .array(z.enum(["critical_issues", "likely_bugs", "spec_mismatches"]))
    .default(["critical_issues"]),
});

const BaseAgentConfigSchema = z.object({
  provider: z.string().default("claude-code"),
  model: z.string().optional(),
});

export const BuilderAgentConfigSchema = BaseAgentConfigSchema.extend({
  dangerouslySkipPermissions: z.boolean().default(false),
});

export const SafeAgentConfigSchema = BaseAgentConfigSchema.extend({
  dangerouslySkipPermissions: z.never().optional(),
});

export const ConfigSchema = z.object({
  planner: BaseAgentConfigSchema.default({
    provider: 'claude-code',
  }),
  builder: BuilderAgentConfigSchema.default({
    provider: 'claude-code',
  }),
  reviewer: SafeAgentConfigSchema.default({
    provider: 'claude-code',
  }),
  repairer: SafeAgentConfigSchema.extend({
    enabled: z.boolean().default(false),
    max_iterations: z.number().min(1).max(10).default(3),
  }).default({}),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  validation: z.object({
    formatter: ValidationCommandSchema.optional(),
    linter: ValidationCommandSchema.optional(),
    typecheck: ValidationCommandSchema.optional(),
    tests: ValidationCommandSchema.optional(),
  }).default({}),
  thresholds: ThresholdConfigSchema.default({}),
  review_rules: z.array(z.string()).default([]),
  artifacts_dir: z.string().default(".patchy-pilot/runs"),
  base_branch: z.string().default("main"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
