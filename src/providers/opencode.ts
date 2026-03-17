import { exec } from "../utils/process.js";
import type { AIProvider, ProviderOptions, ProviderResponse, ProviderRunOptions } from "./types.js";

export class OpenCodeProvider implements AIProvider {
  readonly name = "opencode";
  readonly supportsContinue = false;

  constructor(private options: ProviderOptions = {}) {}

  async run(prompt: string, options?: ProviderRunOptions): Promise<ProviderResponse> {
    if (this.options.role === "reviewer" || this.options.role === "learner") {
      throw new Error(
        "OpenCode CLI does not expose verified read-only controls for reviewer or learner roles",
      );
    }

    if (this.options.dangerouslySkipPermissions) {
      throw new Error(
        "OpenCode CLI does not expose a verified dangerous-permissions flag via `opencode run --help`",
      );
    }

    const args = ["run", prompt];
    if (this.options.model) {
      args.unshift("--model", this.options.model);
    }

    const result = await exec("opencode", args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 600_000,
      onData: options?.onData,
    });

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
