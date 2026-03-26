import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  validate: vi.fn(),
  collectArtifacts: vi.fn(),
  runReview: vi.fn(),
  runPlanner: vi.fn(),
  save: vi.fn(),
  init: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("./providers/index.js", () => ({
  createProvider: mocks.createProvider,
}));

vi.mock("./validator.js", () => ({
  validate: mocks.validate,
}));

vi.mock("./collector.js", () => ({
  collectArtifacts: mocks.collectArtifacts,
}));

vi.mock("./reviewer.js", () => ({
  runReview: mocks.runReview,
  ReviewExecutionError: class ReviewExecutionError extends Error {
    constructor(
      message: string,
      readonly rawOutput?: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("./planner.js", () => ({
  runPlanner: mocks.runPlanner,
}));

vi.mock("./utils/logger.js", () => ({
  log: {
    divider: vi.fn(),
    info: vi.fn(),
    stream: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    detail: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./utils/artifacts.js", () => ({
  ArtifactStore: class ArtifactStore {
    async init() {
      return mocks.init();
    }

    async save(name: string, data: unknown) {
      return mocks.save(name, data);
    }

    get path() {
      return "/tmp/.patchy-pilot/runs/run-123";
    }
  },
  createRunId: () => "run-123",
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

describe("runFeature", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createProvider.mockReset();
    mocks.validate.mockReset();
    mocks.collectArtifacts.mockReset();
    mocks.runReview.mockReset();
    mocks.runPlanner.mockReset();
    mocks.save.mockReset();
    mocks.init.mockReset();
    mocks.access.mockReset();
    mocks.readFile.mockReset();
    mocks.writeFile.mockReset();

    mocks.access.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(".patchy-pilot/\n");
    mocks.init.mockResolvedValue(undefined);
    mocks.save.mockResolvedValue("saved");
    mocks.runPlanner.mockResolvedValue({ plan: "Plan", iterations: 1 });
  });

  it("rebuilds after a failed validation gate and then succeeds", async () => {
    const { runFeature } = await import("./runner.js");
    const { ConfigSchema } = await import("./schemas/config.js");

    const builderRun = vi
      .fn()
      .mockResolvedValueOnce({ output: "first build", exitCode: 0 })
      .mockResolvedValueOnce({ output: "second build", exitCode: 0 });
    const builderProvider = { name: "builder", supportsContinue: true, run: builderRun };
    const reviewerProvider = { name: "reviewer", supportsContinue: false, run: vi.fn() };

    mocks.createProvider.mockImplementation((_provider: string, options?: { role?: string }) => {
      return options?.role === "builder" ? builderProvider : reviewerProvider;
    });

    mocks.validate
      .mockResolvedValueOnce({
        tests: { passed: false, output: "boom\nmore output" },
        all_passed: false,
      })
      .mockResolvedValueOnce({ tests: { passed: true, output: "" }, all_passed: true });

    mocks.collectArtifacts.mockResolvedValue({ spec: "Spec", validation: { all_passed: true } });
    mocks.runReview.mockResolvedValue({ review: makeReview() });

    const result = await runFeature({
      spec: "Ship it",
      config: ConfigSchema.parse({ workflow: { max_rebuilds: 2 }, thresholds: { block_on: [] } }),
      cwd: "/repo",
    });

    expect(builderRun).toHaveBeenCalledTimes(2);
    expect(builderRun.mock.calls[1][0]).toContain(
      "Revise the current implementation instead of starting over",
    );
    expect(builderRun.mock.calls[1][0]).toContain("Tests failed: boom");
    expect(builderRun.mock.calls[1][1]).toMatchObject({ cwd: "/repo", continue: true });
    expect(mocks.runReview).toHaveBeenCalledTimes(1);
    expect(result.build_attempts).toBe(2);
    expect(result.rebuilds_used).toBe(1);
    expect(result.review_approved).toBe(true);
    expect(result.exit_code).toBe(0);
  });

  it("rebuilds after review rejection and stops after max rebuilds", async () => {
    const { runFeature } = await import("./runner.js");
    const { ConfigSchema } = await import("./schemas/config.js");

    const builderRun = vi
      .fn()
      .mockResolvedValueOnce({ output: "first build", exitCode: 0 })
      .mockResolvedValueOnce({ output: "second build", exitCode: 0 });
    const builderProvider = { name: "builder", supportsContinue: false, run: builderRun };
    const reviewerProvider = { name: "reviewer", supportsContinue: false, run: vi.fn() };

    mocks.createProvider.mockImplementation((_provider: string, options?: { role?: string }) => {
      return options?.role === "builder" ? builderProvider : reviewerProvider;
    });

    mocks.validate.mockResolvedValue({ tests: { passed: true, output: "" }, all_passed: true });
    mocks.collectArtifacts.mockResolvedValue({ spec: "Spec", validation: { all_passed: true } });
    mocks.runReview.mockResolvedValue({
      review: makeReview({ merge_recommendation: "needs_changes", short_summary: "Still needs work." }),
    });

    const result = await runFeature({
      spec: "Ship it",
      config: ConfigSchema.parse({ workflow: { max_rebuilds: 1 }, thresholds: { block_on: [] } }),
      cwd: "/repo",
    });

    expect(builderRun).toHaveBeenCalledTimes(2);
    expect(builderRun.mock.calls[1][0]).toContain("<previous-attempt-feedback>");
    expect(builderRun.mock.calls[1][0]).toContain("Reviewer recommended needs_changes");
    expect(mocks.runReview).toHaveBeenCalledTimes(2);
    expect(result.build_attempts).toBe(2);
    expect(result.rebuilds_used).toBe(1);
    expect(result.review_approved).toBe(false);
    expect(result.exit_code).toBe(1);
  });
});

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    critical_issues: [],
    likely_bugs: [],
    missing_tests: [],
    spec_mismatches: [],
    risky_changes: [],
    hidden_assumptions: [],
    confidence: 0.9,
    merge_recommendation: "safe_to_merge",
    short_summary: "Looks good.",
    ...overrides,
  };
}
