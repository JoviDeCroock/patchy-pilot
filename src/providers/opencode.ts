import { exec } from "../utils/process.js";
import type { AIProvider, ProviderOptions, ProviderResponse } from "./types.js";

export class OpenCodeProvider implements AIProvider {
  readonly name = "opencode";

  constructor(private options: ProviderOptions = {}) {}

  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<ProviderResponse> {
    if (this.options.dangerouslySkipPermissions) {
      throw new Error(
        "OpenCode CLI does not expose a verified dangerous-permissions flag via `opencode run --help`"
      );
    }

    const args = ["run", prompt];
    if (this.options.model) {
      args.unshift("--model", this.options.model);
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
