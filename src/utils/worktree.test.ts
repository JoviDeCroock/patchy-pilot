import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./process.js", () => ({
  exec: vi.fn(),
}));

import { exec } from "./process.js";
import { prepareWorktreeSession, resolveWorktreeName } from "./worktree.js";

const execMock = vi.mocked(exec);

describe("resolveWorktreeName", () => {
  it("returns null when worktree mode is disabled", () => {
    expect(resolveWorktreeName(undefined)).toBeNull();
  });

  it("auto-generates a patchy-pilot worktree name when the flag has no value", () => {
    expect(resolveWorktreeName(true)).toMatch(/^patchy-pilot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it("accepts explicit worktree names", () => {
    expect(resolveWorktreeName("feature-123")).toBe("feature-123");
  });

  it("rejects path-like worktree names", () => {
    expect(() => resolveWorktreeName("../feature-123")).toThrow(
      /Worktree names may only contain letters, numbers, dots, underscores, and hyphens/,
    );
  });
});

describe("prepareWorktreeSession", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("creates a sibling worktree and preserves the relative cwd", async () => {
    execMock
      .mockResolvedValueOnce({ stdout: "/repo\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "Preparing worktree", stderr: "", exitCode: 0 });

    const session = await prepareWorktreeSession("/repo/packages/app", "feature-123");

    expect(session).toEqual({
      name: "feature-123",
      root: "/feature-123",
      cwd: "/feature-123/packages/app",
    });

    expect(execMock).toHaveBeenNthCalledWith(1, "git", ["rev-parse", "--show-toplevel"], {
      cwd: "/repo/packages/app",
    });
    expect(execMock).toHaveBeenNthCalledWith(
      4,
      "git",
      ["worktree", "add", "-b", "feature-123", "/feature-123", "HEAD"],
      { cwd: "/repo" },
    );
  });

  it("fails when the source working tree has uncommitted changes", async () => {
    execMock
      .mockResolvedValueOnce({ stdout: "/repo\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: " M src/cli.ts\n", stderr: "", exitCode: 0 });

    await expect(prepareWorktreeSession("/repo", "feature-123")).rejects.toThrow(
      /clean working tree/,
    );
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("fails when the target branch already exists", async () => {
    execMock
      .mockResolvedValueOnce({ stdout: "/repo\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(prepareWorktreeSession("/repo", "feature-123")).rejects.toThrow(
      /local branch named "feature-123" already exists/,
    );
  });
});
