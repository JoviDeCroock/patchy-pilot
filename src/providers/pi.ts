import { exec } from "../utils/process.js";
import type { AIProvider, ProviderOptions, ProviderResponse } from "./types.js";

export class PiProvider implements AIProvider {
  readonly name = "pi";
  readonly supportsContinue = false;

  constructor(private options: ProviderOptions = {}) {}

  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<ProviderResponse> {
    if (this.options.role === "reviewer" || this.options.role === "learner") {
      throw new Error(
        "Pi coding agent does not expose verified read-only controls for reviewer or learner roles"
      );
    }

    if (this.options.dangerouslySkipPermissions) {
      throw new Error(
        "Pi coding agent does not expose a dangerous-permissions flag. " +
        "Run it in a container or use extensions for custom confirmation flows."
      );
    }

    const args = ["-p", prompt];
    if (this.options.model) {
      args.unshift("--model", this.options.model);
    }

    const result = await exec("pi", args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 600_000,
    });

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
