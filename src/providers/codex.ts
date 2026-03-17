import { exec } from "../utils/process.js";
import { log } from "../utils/logger.js";
import { createLineParser } from "../utils/stream-parser.js";
import type { AIProvider, ProviderOptions, ProviderResponse, ProviderRunOptions } from "./types.js";

export class CodexProvider implements AIProvider {
  readonly name = "codex";
  readonly supportsContinue = false;

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
    options?: ProviderRunOptions
  ): Promise<ProviderResponse> {
    const streaming = !!options?.onData;
    const args = ["exec"];

    if (streaming) {
      args.push("--json");
    }

    if (this.options.dangerouslySkipPermissions) {
      args.unshift("--dangerously-bypass-approvals-and-sandbox");
    } else if (this.options.role === "reviewer" || this.options.role === "learner") {
      args.push("--sandbox", "read-only", "--ask-for-approval", "never");
    } else {
      args.push("--sandbox", "workspace-write", "--ask-for-approval", "never");
    }

    if (this.options.model) {
      args.unshift("--model", this.options.model);
    }

    const collectedText: string[] = [];

    const onData = streaming
      ? createLineParser((line) => {
          try {
            const msg = JSON.parse(line);
            if (msg.type === "item.completed" && msg.item?.text) {
              collectedText.push(msg.item.text);
              options!.onData!(msg.item.text + "\n");
            }
          } catch {
            // Skip malformed lines
          }
        })
      : undefined;

    const result = await exec("codex", args, {
      cwd: options?.cwd,
      stdin: prompt,
      timeout: options?.timeout ?? 600_000,
      onData,
    });

    if (streaming) {
      onData!.flush();
      return {
        output: collectedText.join("\n") || result.stdout,
        exitCode: result.exitCode,
      };
    }

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}
