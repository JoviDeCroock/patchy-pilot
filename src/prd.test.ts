import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
}));

vi.mock("./providers/index.js", () => ({
  createProvider: mocks.createProvider,
}));

import { runPrd } from "./prd.js";
import type { Config } from "./schemas/config.js";

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    planner: { provider: "claude-code" },
    builder: { provider: "claude-code", dangerouslySkipPermissions: false },
    reviewer: { provider: "claude-code" },
    workflow: { max_rebuilds: 2 },
    providers: {},
    validation: {},
    thresholds: {
      max_critical: 0,
      max_high: 2,
      min_confidence: 0.6,
      block_on: ["critical_issues"],
    },
    review_rules: [],
    artifacts_dir: ".patchy-pilot/runs",
    base_branch: "main",
    ...overrides,
  } as Config;
}

describe("runPrd", () => {
  const mockRun = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createProvider.mockReturnValue({
      name: "claude-code",
      supportsContinue: true,
      run: mockRun,
    });
  });

  it("returns generated PRD from provider output", async () => {
    mockRun.mockResolvedValue({ output: "# My PRD\n\nContent here", exitCode: 0 });

    const result = await runPrd({
      spec: "Build a widget",
      config: makeConfig(),
      cwd: "/tmp/test",
    });

    expect(result.prd).toBe("# My PRD\n\nContent here");
  });

  it("creates a provider with planner config", async () => {
    mockRun.mockResolvedValue({ output: "PRD", exitCode: 0 });

    await runPrd({
      spec: "anything",
      config: makeConfig({ planner: { provider: "codex", model: "gpt-5" } }),
      cwd: "/tmp/test",
    });

    expect(mocks.createProvider).toHaveBeenCalledWith("codex", {
      model: "gpt-5",
      role: "planner",
    });
  });

  it("passes the spec through prdPrompt to provider", async () => {
    mockRun.mockResolvedValue({ output: "PRD", exitCode: 0 });

    await runPrd({
      spec: "Add user authentication",
      config: makeConfig(),
      cwd: "/tmp/test",
    });

    const prompt = mockRun.mock.calls[0][0] as string;
    expect(prompt).toContain("Add user authentication");
    expect(prompt).toContain("<brief>");
  });

  it("throws on non-zero exit code", async () => {
    mockRun.mockResolvedValue({ output: "", exitCode: 1 });

    await expect(runPrd({ spec: "test", config: makeConfig(), cwd: "/tmp/test" })).rejects.toThrow(
      "PRD generator exited with code 1",
    );
  });

  it("rejects empty briefs before invoking the provider", async () => {
    await expect(runPrd({ spec: "   ", config: makeConfig(), cwd: "/tmp/test" })).rejects.toThrow(
      "PRD generator requires a non-empty brief",
    );
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("forwards onData callback to provider", async () => {
    mockRun.mockResolvedValue({ output: "PRD", exitCode: 0 });
    const onData = vi.fn();

    await runPrd({
      spec: "test",
      config: makeConfig(),
      cwd: "/tmp/test",
      onData,
    });

    expect(mockRun).toHaveBeenCalledWith(expect.any(String), {
      cwd: "/tmp/test",
      onData,
    });
  });
});
