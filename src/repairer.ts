import type { AIProvider, ProviderResponse } from "./providers/types.js";
import type { ReviewResult } from "./schemas/review.js";
import { repairPrompt } from "./prompts/repairer.js";
import { log } from "./utils/logger.js";

export async function runRepair(
  provider: AIProvider,
  spec: string,
  review: ReviewResult,
  cwd?: string,
  options?: { onData?: (chunk: string) => void },
): Promise<ProviderResponse> {
  log.step(`Starting repair pass with ${provider.name}`);

  const prompt = repairPrompt(spec, review);
  const response = await provider.run(prompt, { cwd, onData: options?.onData });

  log.detail("Repair pass completed");
  return response;
}
