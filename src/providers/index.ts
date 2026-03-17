import type { AIProvider, ProviderOptions } from "./types.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { OpenCodeProvider } from "./opencode.js";
import { PiProvider } from "./pi.js";

export function createProvider(name: string, options: ProviderOptions = {}): AIProvider {
  switch (name) {
    case "claude-code":
      return new ClaudeCodeProvider(options);
    case "codex":
      return new CodexProvider(options);
    case "opencode":
      return new OpenCodeProvider(options);
    case "pi":
      return new PiProvider(options);
    default:
      throw new Error(`Unknown provider: ${name}. Available: claude-code, codex, opencode, pi`);
  }
}

export type { AIProvider, ProviderOptions, ProviderResponse, ProviderRunOptions } from "./types.js";
