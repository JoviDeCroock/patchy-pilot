import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Config } from "./schemas/config.js";
import type { ReviewResult, ValidationResult } from "./schemas/review.js";
import { createProvider } from "./providers/index.js";
import { LearnOutputSchema, type LearnOutput, type LearnedSkill } from "./schemas/learn.js";
import { learnPrompt, type LearnRunSummary } from "./prompts/learner.js";
import { log } from "./utils/logger.js";

interface GatingResult {
  passed: boolean;
  reasons: string[];
}

interface StoredRunResult {
  completed_at?: string;
  exit_code?: number;
  repair_applied?: boolean;
  validation?: ValidationResult;
  review?: ReviewResult;
}

export interface LearnOptions {
  config: Config;
  cwd: string;
  limit?: number;
  provider?: string;
  model?: string;
  outDir?: string;
}

export interface LearnResult {
  analyzed_runs: number;
  output_dir: string;
  overview: string;
  skills: string[];
}

export async function runLearn(opts: LearnOptions): Promise<LearnResult> {
  const runsDir = join(opts.cwd, opts.config.artifacts_dir);
  const outputDir = resolve(opts.cwd, opts.outDir ?? ".patchy-pilot/skills");
  const limit = Math.max(1, opts.limit ?? 10);

  const runDirs = await listRunDirectories(runsDir, limit);
  if (runDirs.length === 0) {
    throw new Error(`No patchy-pilot runs found in ${runsDir}`);
  }

  log.step(`Analyzing ${runDirs.length} runs for reusable skills`);
  const runs = await Promise.all(runDirs.map((runId) => loadRunSummary(runsDir, runId)));

  const provider = createProvider(opts.provider ?? opts.config.reviewer.provider, {
    model: opts.model ?? opts.config.reviewer.model,
    role: "learner",
  });

  const prompt = learnPrompt(runs);
  const response = await provider.run(prompt, { cwd: opts.cwd, timeout: 600_000 });
  const parsed = extractJson(response.output);
  if (!parsed) {
    throw new Error("Failed to parse learner output as JSON");
  }

  const learnOutput = LearnOutputSchema.parse(parsed);
  await writeSkills(
    outputDir,
    learnOutput,
    runs.map((run) => run.run_id),
  );

  if (learnOutput.skills.length === 0) {
    log.info("Learner found no evidence-backed skills to generate");
  } else {
    log.success(`Generated ${learnOutput.skills.length} skills in ${outputDir}`);
  }

  return {
    analyzed_runs: runs.length,
    output_dir: outputDir,
    overview: learnOutput.overview,
    skills: learnOutput.skills.map((skill) => join(outputDir, `${normalizeSlug(skill.slug)}.md`)),
  };
}

async function listRunDirectories(runsDir: string, limit: number): Promise<string[]> {
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);
}

async function loadRunSummary(runsDir: string, runId: string): Promise<LearnRunSummary> {
  const dir = join(runsDir, runId);
  const [spec, builderSummary, validationRaw, reviewRaw, gatingRaw, resultRaw] = await Promise.all([
    readOptional(join(dir, "spec.md")),
    readOptional(join(dir, "builder-output.txt")),
    readOptional(join(dir, "validation.json")),
    readOptional(join(dir, "review.json")),
    readOptional(join(dir, "gating.json")),
    readOptional(join(dir, "result.json")),
  ]);

  const validation = parseJson<ValidationResult>(validationRaw);
  const review = parseJson<ReviewResult>(reviewRaw);
  const gating = parseJson<GatingResult>(gatingRaw);
  const result = parseJson<StoredRunResult>(resultRaw);

  return {
    run_id: runId,
    completed_at: result?.completed_at,
    exit_code: result?.exit_code,
    repair_applied: result?.repair_applied ?? false,
    spec_preview: clip(spec, 1_500),
    builder_summary: clip(builderSummary, 1_500),
    validation: summarizeValidation(validation ?? result?.validation),
    review: summarizeReview(review ?? result?.review),
    gating: gating
      ? {
          passed: gating.passed,
          reasons: gating.reasons
            .slice(0, 6)
            .map((reason) => clip(reason, 240))
            .filter((reason): reason is string => Boolean(reason)),
        }
      : undefined,
  };
}

function summarizeValidation(validation?: ValidationResult): Record<string, string> {
  if (!validation) {
    return { status: "No validation data recorded." };
  }

  const summary: Record<string, string> = {
    all_passed: validation.all_passed ? "PASS" : "FAIL",
  };

  const checks: Array<keyof Omit<ValidationResult, "all_passed">> = [
    "formatter",
    "linter",
    "typecheck",
    "tests",
  ];

  for (const name of checks) {
    const result = validation[name];
    if (!result) {
      continue;
    }

    summary[name] =
      `${result.passed ? "PASS" : "FAIL"}${result.output ? ` - ${clip(cleanWhitespace(result.output), 280) ?? ""}` : ""}`;
  }

  return summary;
}

function summarizeReview(review?: ReviewResult): LearnRunSummary["review"] | undefined {
  if (!review) {
    return undefined;
  }

  return {
    merge_recommendation: review.merge_recommendation,
    confidence: review.confidence,
    short_summary: clip(review.short_summary, 280) ?? review.short_summary,
    critical_issues: summarizeIssues(review.critical_issues),
    likely_bugs: summarizeIssues(review.likely_bugs),
    missing_tests: summarizeIssues(review.missing_tests),
    spec_mismatches: summarizeIssues(review.spec_mismatches),
    risky_changes: summarizeIssues(review.risky_changes),
    hidden_assumptions: summarizeIssues(review.hidden_assumptions),
  };
}

function summarizeIssues(issues: ReviewResult["critical_issues"]): string[] {
  return issues.slice(0, 5).map((issue) => {
    const location = issue.file
      ? `${issue.file}${issue.line ? `:${issue.line}` : ""}`
      : "unknown-location";
    return `[${issue.severity}] ${location} - ${clip(issue.description, 220) ?? issue.description}`;
  });
}

async function writeSkills(
  outputDir: string,
  learnOutput: LearnOutput,
  analyzedRuns: string[],
): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const manifest = {
    generated_at: new Date().toISOString(),
    analyzed_runs: analyzedRuns,
    overview: learnOutput.overview,
    skills: learnOutput.skills.map((skill) => ({
      slug: normalizeSlug(skill.slug),
      title: skill.title,
      path: `${normalizeSlug(skill.slug)}.md`,
      source_runs: skill.source_runs,
    })),
  };

  await Promise.all([
    writeFile(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8"),
    writeFile(join(outputDir, "README.md"), renderIndex(learnOutput), "utf-8"),
    ...learnOutput.skills.map((skill) =>
      writeFile(join(outputDir, `${normalizeSlug(skill.slug)}.md`), renderSkill(skill), "utf-8"),
    ),
  ]);
}

function renderIndex(learnOutput: LearnOutput): string {
  const lines = ["# Learned Skills", "", learnOutput.overview.trim()];

  if (learnOutput.skills.length === 0) {
    lines.push("", "No evidence-backed skills were generated from the analyzed runs.");
    return lines.join("\n");
  }

  lines.push("", "## Skills", "");
  for (const skill of learnOutput.skills) {
    lines.push(`- [${skill.title}](./${normalizeSlug(skill.slug)}.md) - ${skill.summary}`);
  }

  return lines.join("\n");
}

function renderSkill(skill: LearnedSkill): string {
  const slug = normalizeSlug(skill.slug);
  const instructions = skill.instructions.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const evidence = skill.evidence.map((item) => `- ${item}`).join("\n");
  const sourceRuns = skill.source_runs.map((runId) => `- ${runId}`).join("\n");

  return [
    `# ${skill.title.trim()}`,
    "",
    skill.summary.trim(),
    "",
    `Slug: \`${slug}\``,
    "",
    "## When to use",
    "",
    skill.when_to_use.trim(),
    "",
    "## Why it matters",
    "",
    skill.why_it_matters.trim(),
    "",
    "## Instructions",
    "",
    instructions,
    "",
    "## Evidence from runs",
    "",
    evidence,
    "",
    "## Source runs",
    "",
    sourceRuns,
    "",
  ].join("\n");
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

function parseJson<T>(raw?: string): T | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function extractJson(text: string): unknown | null {
  try {
    return JSON.parse(text.trim());
  } catch {
    // noop
  }

  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // noop
    }
  }

  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      // noop
    }
  }

  return null;
}

function normalizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "learned-skill";
}

function clip(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = cleanWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
