import type { AIProvider } from "./providers/types.js";
import type { ReviewResult } from "./schemas/review.js";
import { repairPrompt } from "./prompts/repairer.js";
import { log } from "./utils/logger.js";

export async function runRepair(
  provider: AIProvider,
  spec: string,
  review: ReviewResult,
  cwd?: string
): Promise<string> {
  log.step(`Starting repair pass with ${provider.name}`);

  const prompt = repairPrompt(spec, review);
  const response = await provider.run(prompt, { cwd });

  log.detail("Repair pass completed");
  return response.output;
}
