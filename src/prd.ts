import type { Config } from "./schemas/config.js";
import { createProvider } from "./providers/index.js";
import { prdPrompt } from "./prompts/prd.js";
import { log } from "./utils/logger.js";

export interface PrdResult {
  prd: string;
}

export async function runPrd(opts: {
  spec: string;
  config: Config;
  cwd: string;
  onData?: (text: string) => void;
}): Promise<PrdResult> {
  const brief = opts.spec.trim();
  if (!brief) {
    throw new Error("PRD generator requires a non-empty brief");
  }

  const provider = createProvider(opts.config.planner.provider, {
    model: opts.config.planner.model,
    role: "planner",
  });

  log.step("Generating PRD");

  const result = await provider.run(prdPrompt(brief), {
    cwd: opts.cwd,
    onData: opts.onData,
  });

  if (result.exitCode !== 0) {
    throw new Error(`PRD generator exited with code ${result.exitCode}`);
  }

  return { prd: result.output };
}
