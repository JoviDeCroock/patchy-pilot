import type { AIProvider } from "./types.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { OpenCodeProvider } from "./opencode.js";

export function createProvider(name: string, model?: string): AIProvider {
  switch (name) {
    case "claude-code":
      return new ClaudeCodeProvider(model);
    case "codex":
      return new CodexProvider(model);
    case "opencode":
      return new OpenCodeProvider(model);
    default:
      throw new Error(`Unknown provider: ${name}. Available: claude-code, codex, opencode`);
  }
}

export type { AIProvider, ProviderResponse } from "./types.js";
