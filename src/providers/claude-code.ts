import { exec } from "../utils/process.js";
import { log } from "../utils/logger.js";
import type { AIProvider, ProviderOptions, ProviderResponse } from "./types.js";

export class ClaudeCodeProvider implements AIProvider {
  readonly name = "claude-code";
  readonly supportsContinue = true;

  constructor(private options: ProviderOptions = {}) {
    if (options.dangerouslySkipPermissions) {
      log.warn(
        `[claude-code] dangerouslySkipPermissions is ENABLED. ` +
        `All permission checks will be bypassed. ` +
        `The AI agent can execute arbitrary commands without approval.`
      );
    }
  }

  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number; continue?: boolean }
  ): Promise<ProviderResponse> {
    const args = ["--print"];

    if (options?.continue) {
      args.push("--continue");
    }

    if (this.options.dangerouslySkipPermissions) {
      args.unshift("--dangerously-skip-permissions");
    } else if (this.options.role === "builder" || this.options.role === "repairer") {
      args.unshift("--permission-mode", "acceptEdits");
    } else {
      args.unshift("--permission-mode", "default");
    }

    if (this.options.model) {
      args.unshift("--model", this.options.model);
    }

    const result = await exec("claude", args, {
      cwd: options?.cwd,
      stdin: prompt,
      timeout: options?.timeout ?? 600_000,
    });

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
