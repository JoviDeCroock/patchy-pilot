import { exec } from "../utils/process.js";
import type { AIProvider, ProviderResponse } from "./types.js";

export class OpenCodeProvider implements AIProvider {
  readonly name = "opencode";

  constructor(private model?: string) {}

  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<ProviderResponse> {
    // OpenCode uses -m for message in non-interactive mode
    const args = ["-m", prompt];
    if (this.model) {
      args.unshift("--model", this.model);
    }

    const result = await exec("opencode", args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 600_000,
    });

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
