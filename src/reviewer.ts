import type { AIProvider } from "./providers/types.js";
import type { Artifacts, ReviewResult } from "./schemas/review.js";
import { ReviewResultSchema } from "./schemas/review.js";
import { reviewPrompt } from "./prompts/reviewer.js";
import { log } from "./utils/logger.js";

export async function runReview(
  provider: AIProvider,
  artifacts: Artifacts,
  extraRules: string[] = [],
  cwd?: string
): Promise<ReviewResult> {
  log.step(`Starting review with ${provider.name}`);

  const prompt = reviewPrompt(artifacts, extraRules);
  const response = await provider.run(prompt, { cwd });

  log.detail("Parsing review output");

  const json = extractJson(response.output);
  if (!json) {
    log.error("Reviewer did not return valid JSON. Raw output saved to artifacts.");
    throw new Error("Failed to parse reviewer output as JSON");
  }

  const result = ReviewResultSchema.parse(json);
  return result;
}

/** Extract JSON from a response that may contain markdown fences or surrounding text */
function extractJson(text: string): unknown | null {
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

  // Try finding the first { ... } block
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
