import { describe, it, expect } from "vitest";
import { createProvider } from "./index.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { OpenCodeProvider } from "./opencode.js";
import { PiProvider } from "./pi.js";

describe("createProvider", () => {
  it("creates a ClaudeCodeProvider for 'claude-code'", () => {
    const provider = createProvider("claude-code");
    expect(provider).toBeInstanceOf(ClaudeCodeProvider);
    expect(provider.name).toBe("claude-code");
  });

  it("creates a CodexProvider for 'codex'", () => {
    const provider = createProvider("codex");
    expect(provider).toBeInstanceOf(CodexProvider);
    expect(provider.name).toBe("codex");
  });

  it("creates an OpenCodeProvider for 'opencode'", () => {
    const provider = createProvider("opencode");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe("opencode");
  });

  it("creates a PiProvider for 'pi'", () => {
    const provider = createProvider("pi");
    expect(provider).toBeInstanceOf(PiProvider);
    expect(provider.name).toBe("pi");
  });

  it("throws for an unknown provider name", () => {
    expect(() => createProvider("gpt-5")).toThrow("Unknown provider: gpt-5");
  });

  it("passes options to the provider", () => {
    const provider = createProvider("claude-code", { model: "opus" });
    expect(provider).toBeInstanceOf(ClaudeCodeProvider);
  });
});

describe("OpenCodeProvider role restrictions", () => {
  it("throws when used as reviewer", async () => {
    const provider = createProvider("opencode", { role: "reviewer" });
    await expect(provider.run("test")).rejects.toThrow("read-only");
  });

  it("throws when used as learner", async () => {
    const provider = createProvider("opencode", { role: "learner" });
    await expect(provider.run("test")).rejects.toThrow("read-only");
  });

  it("throws when dangerouslySkipPermissions is set", async () => {
    const provider = createProvider("opencode", {
      role: "builder",
      dangerouslySkipPermissions: true,
    });
    await expect(provider.run("test")).rejects.toThrow("dangerous-permissions");
  });
});

describe("PiProvider role restrictions", () => {
  it("throws when used as reviewer", async () => {
    const provider = createProvider("pi", { role: "reviewer" });
    await expect(provider.run("test")).rejects.toThrow("read-only");
  });

  it("throws when used as learner", async () => {
    const provider = createProvider("pi", { role: "learner" });
    await expect(provider.run("test")).rejects.toThrow("read-only");
  });

  it("throws when dangerouslySkipPermissions is set", async () => {
    const provider = createProvider("pi", {
      role: "builder",
      dangerouslySkipPermissions: true,
    });
    await expect(provider.run("test")).rejects.toThrow("dangerous-permissions");
  });
});
