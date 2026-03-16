import type { AIProvider, ProviderOptions } from "./types.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { OpenCodeProvider } from "./opencode.js";

export function createProvider(name: string, options: ProviderOptions = {}): AIProvider {
  switch (name) {
    case "claude-code":
      return new ClaudeCodeProvider(options);
    case "codex":
      return new CodexProvider(options);
    case "opencode":
      return new OpenCodeProvider(options);
    default:
      throw new Error(`Unknown provider: ${name}. Available: claude-code, codex, opencode`);
  }
}

export type { AIProvider, ProviderOptions, ProviderResponse } from "./types.js";
