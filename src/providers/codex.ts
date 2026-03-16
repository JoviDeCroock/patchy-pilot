import { exec } from "../utils/process.js";
import { log } from "../utils/logger.js";
import type { AIProvider, ProviderOptions, ProviderResponse } from "./types.js";

export class CodexProvider implements AIProvider {
  readonly name = "codex";

  constructor(private options: ProviderOptions = {}) {
    if (options.dangerouslySkipPermissions) {
      log.warn(
        `[codex] dangerouslySkipPermissions is ENABLED. ` +
        `Both approval gates AND sandbox will be bypassed. ` +
        `The AI agent can execute arbitrary commands with full filesystem access.`
      );
    }
  }

  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<ProviderResponse> {
    const args = ["exec", prompt];
    if (this.options.model) {
      args.unshift("--model", this.options.model);
    }
    if (this.options.dangerouslySkipPermissions) {
      args.unshift("--dangerously-bypass-approvals-and-sandbox");
    }

    const result = await exec("codex", args, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 600_000,
    });

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
