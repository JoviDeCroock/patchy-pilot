import { exec } from "../utils/process.js";
import { log } from "../utils/logger.js";
import { createLineParser } from "../utils/stream-parser.js";
import type { AIProvider, ProviderOptions, ProviderResponse, ProviderRunOptions } from "./types.js";

export class ClaudeCodeProvider implements AIProvider {
  readonly name = "claude-code";
  readonly supportsContinue = true;

  constructor(private options: ProviderOptions = {}) {
    if (options.dangerouslySkipPermissions) {
      log.warn(
        `[claude-code] dangerouslySkipPermissions is ENABLED. ` +
          `All permission checks will be bypassed. ` +
          `The AI agent can execute arbitrary commands without approval.`,
      );
    }
  }

  async run(prompt: string, options?: ProviderRunOptions): Promise<ProviderResponse> {
    const streaming = !!options?.onData;
    const args = ["--print"];

    if (options?.continue) {
      args.push("--continue");
    }

    if (streaming) {
      args.push("--output-format", "stream-json", "--verbose");
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

    let finalOutput = "";

    const onData = streaming
      ? createLineParser((line) => {
          try {
            const msg = JSON.parse(line);
            if (msg.type === "assistant") {
              const text = extractAssistantText(msg.message);
              if (text) options!.onData!(text + "\n");
            } else if (msg.type === "result") {
              finalOutput = msg.result ?? "";
            }
          } catch {
            // Skip malformed lines
          }
        })
      : undefined;

    const result = await exec("claude", args, {
      cwd: options?.cwd,
      stdin: prompt,
      timeout: options?.timeout ?? 600_000,
      onData,
    });

    if (streaming) {
      // Flush any remaining buffered line
      onData!.flush();
      return {
        output: finalOutput || result.stdout,
        exitCode: result.exitCode,
      };
    }

    return {
      output: result.stdout + result.stderr,
      exitCode: result.exitCode,
    };
  }
}

/** Extract text content from a Claude assistant message */
function extractAssistantText(message: {
  content?: Array<{ type: string; text?: string; name?: string; input?: any }>;
}): string {
  if (!message?.content) return "";
  return message.content
    .filter((b) => (b.type === "text" && b.text) || b.type === "tool_use")
    .map((b) => b.text || b.name + JSON.stringify(b.input))
    .join("");
}
