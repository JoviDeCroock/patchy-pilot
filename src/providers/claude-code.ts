import { exec } from "../utils/process.js";
import type { AIProvider, ProviderResponse } from "./types.js";

export class ClaudeCodeProvider implements AIProvider {
  readonly name = "claude-code";

  constructor(private model?: string) {}

  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<ProviderResponse> {
    const args = ["--print", prompt];
    if (this.model) {
      args.unshift("--model", this.model);
    }

    const result = await exec("claude", args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 600_000,
    });

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
