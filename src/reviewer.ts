import type { AIProvider } from "./providers/types.js";
import type { Artifacts, ReviewResult } from "./schemas/review.js";
import { ReviewResultSchema } from "./schemas/review.js";
import { reviewPrompt } from "./prompts/reviewer.js";
import { log } from "./utils/logger.js";

export class ReviewExecutionError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string
  ) {
    super(message);
    this.name = "ReviewExecutionError";
  }
}

export async function runReview(
  provider: AIProvider,
  artifacts: Artifacts,
  extraRules: string[] = [],
  cwd?: string,
  options?: { onData?: (chunk: string) => void }
): Promise<ReviewResult> {
  log.step(`Starting review with ${provider.name}`);

  const prompt = reviewPrompt(artifacts, extraRules);
  const response = await provider.run(prompt, { cwd, onData: options?.onData });

  if (response.exitCode !== 0) {
    throw new ReviewExecutionError(
      `Reviewer exited with code ${response.exitCode}`,
      response.output
    );
  }

  log.detail("Parsing review output");

  const json = extractJson(response.output);
  if (!json) {
    log.error("Reviewer did not return valid JSON. Raw output saved to artifacts.");
    throw new ReviewExecutionError(
      "Failed to parse reviewer output as JSON",
      response.output
    );
  }

  const result = ReviewResultSchema.parse(json);

  // Sanity-check: detect suspiciously clean reviews on non-trivial diffs
  warnIfSuspicious(result, artifacts);

  return result;
}

/**
 * Warn if review looks like it may have been manipulated via prompt injection.
 * This is a heuristic — not a guarantee — but catches obvious cases.
 */
function warnIfSuspicious(review: ReviewResult, artifacts: Artifacts): void {
  const diffLines = artifacts.git_diff.split("\n").length;
  const changedFileCount = artifacts.changed_files.length;

  // A large diff with zero issues and high confidence is suspicious
  if (
    diffLines > 50 &&
    changedFileCount > 2 &&
    review.critical_issues.length === 0 &&
    review.likely_bugs.length === 0 &&
    review.missing_tests.length === 0 &&
    review.spec_mismatches.length === 0 &&
    review.confidence >= 0.95 &&
    review.merge_recommendation === "safe_to_merge"
  ) {
    log.warn(
      `Review returned zero issues with ${review.confidence} confidence on a ${diffLines}-line diff across ${changedFileCount} files. This may indicate prompt injection in the spec or diff. Inspect the review manually.`
    );
  }
}

/** Extract JSON from a response that may contain markdown fences or surrounding text */
export function extractJson(text: string): unknown | null {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {
    // noop
  }

  // Try extracting from code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // noop
    }
  }

  // Try finding the first { ... } block with balanced braces
  const parsed = extractBalancedJson(text);
  if (parsed !== null) {
    return parsed;
  }

  return null;
}

/**
 * Find the first balanced JSON object in the text.
 * Uses brace counting instead of first-{-to-last-} which is vulnerable
 * to injected JSON fragments at the end of the output.
 */
function extractBalancedJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
