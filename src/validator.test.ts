import { describe, it, expect, vi } from "vitest";
import { buildScopedArgs } from "./validator.js";

vi.mock("./utils/git.js", () => ({
  changedFiles: vi.fn().mockResolvedValue([]),
  untrackedFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("./utils/process.js", () => ({
  exec: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }),
}));

vi.mock("./utils/logger.js", () => ({
  log: { step: vi.fn(), detail: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));

describe("buildScopedArgs", () => {
  it("appends files directly for non-package-manager commands", () => {
    const result = buildScopedArgs("eslint", ["--fix"], ["src/a.ts", "src/b.ts"]);
    expect(result).toEqual(["--fix", "src/a.ts", "src/b.ts"]);
  });

  it("strips trailing '.' before appending files", () => {
    const result = buildScopedArgs("prettier", ["--check", "."], ["src/a.ts"]);
    expect(result).toEqual(["--check", "src/a.ts"]);
  });

  it("strips trailing './' before appending files", () => {
    const result = buildScopedArgs("eslint", ["./"], ["src/a.ts"]);
    expect(result).toEqual(["src/a.ts"]);
  });

  it("does not strip non-dot trailing args", () => {
    const result = buildScopedArgs("eslint", ["src/"], ["src/a.ts"]);
    expect(result).toEqual(["src/", "src/a.ts"]);
  });

  it("strips trailing '.' for package-manager commands", () => {
    const result = buildScopedArgs("pnpm", ["run", "lint", "."], ["src/a.ts"]);
    expect(result).toEqual(["run", "lint", "--", "src/a.ts"]);
  });

  it("uses -- separator for npm commands", () => {
    const result = buildScopedArgs("npm", ["run", "lint"], ["src/a.ts"]);
    expect(result).toEqual(["run", "lint", "--", "src/a.ts"]);
  });

  it("uses -- separator for pnpm commands", () => {
    const result = buildScopedArgs("pnpm", ["run", "lint"], ["a.ts", "b.ts"]);
    expect(result).toEqual(["run", "lint", "--", "a.ts", "b.ts"]);
  });

  it("uses -- separator for yarn commands", () => {
    const result = buildScopedArgs("yarn", ["run", "lint"], ["a.ts"]);
    expect(result).toEqual(["run", "lint", "--", "a.ts"]);
  });

  it("uses -- separator for bun commands", () => {
    const result = buildScopedArgs("bun", ["run", "lint"], ["a.ts"]);
    expect(result).toEqual(["run", "lint", "--", "a.ts"]);
  });

  it("uses -- separator for npx commands", () => {
    const result = buildScopedArgs("npx", ["eslint"], ["a.ts"]);
    expect(result).toEqual(["eslint", "--", "a.ts"]);
  });

  it("handles empty original args for direct commands", () => {
    const result = buildScopedArgs("eslint", [], ["a.ts"]);
    expect(result).toEqual(["a.ts"]);
  });

  it("handles multiple changed files", () => {
    const files = ["src/a.ts", "src/b.ts", "lib/c.js"];
    const result = buildScopedArgs("prettier", ["--check"], files);
    expect(result).toEqual(["--check", "src/a.ts", "src/b.ts", "lib/c.js"]);
  });

  it("does not mutate original args array", () => {
    const original = ["--check", "."];
    buildScopedArgs("prettier", original, ["a.ts"]);
    expect(original).toEqual(["--check", "."]);
  });
});

describe("validate with selective option", () => {
  // Dynamic imports so mocks are in place
  const getModules = async () => {
    const { validate } = await import("./validator.js");
    const { changedFiles, untrackedFiles } = await import("./utils/git.js");
    const { exec } = await import("./utils/process.js");
    const { ConfigSchema } = await import("./schemas/config.js");
    return {
      validate,
      changedFiles: changedFiles as ReturnType<typeof vi.fn>,
      untrackedFiles: untrackedFiles as ReturnType<typeof vi.fn>,
      exec: exec as ReturnType<typeof vi.fn>,
      ConfigSchema,
    };
  };

  it("selective: true with changed files scopes args", async () => {
    const { validate, changedFiles, untrackedFiles, exec, ConfigSchema } = await getModules();
    changedFiles.mockResolvedValue(["src/a.ts"]);
    untrackedFiles.mockResolvedValue([]);
    exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const config = ConfigSchema.parse({
      validation: {
        linter: {
          command: "eslint",
          args: ["--fix", "."],
          enabled: true,
          selective: true,
        },
      },
    });

    const result = await validate(config, "/tmp");
    expect(result.linter).toBeDefined();
    expect(result.linter!.passed).toBe(true);
    // exec should have been called with scoped args (dot stripped, file appended)
    expect(exec).toHaveBeenCalledWith("eslint", ["--fix", "src/a.ts"], { cwd: "/tmp" });
  });

  it("selective: true with no changed files skips check", async () => {
    const { validate, changedFiles, untrackedFiles, exec, ConfigSchema } = await getModules();
    changedFiles.mockResolvedValue([]);
    untrackedFiles.mockResolvedValue([]);
    exec.mockClear();

    const config = ConfigSchema.parse({
      validation: {
        linter: {
          command: "eslint",
          args: ["."],
          enabled: true,
          selective: true,
        },
      },
    });

    const result = await validate(config, "/tmp");
    expect(result.linter).toEqual({
      passed: true,
      output: "No changed files to check.",
    });
    // exec should NOT have been called for the linter
    expect(exec).not.toHaveBeenCalled();
  });

  it("selective: false (default) runs with original args", async () => {
    const { validate, changedFiles, untrackedFiles, exec, ConfigSchema } = await getModules();
    changedFiles.mockResolvedValue(["src/a.ts"]);
    untrackedFiles.mockResolvedValue([]);
    exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const config = ConfigSchema.parse({
      validation: {
        typecheck: {
          command: "npx",
          args: ["tsc", "--noEmit"],
          enabled: true,
          // selective defaults to false
        },
      },
    });

    const result = await validate(config, "/tmp");
    expect(result.typecheck).toBeDefined();
    expect(result.typecheck!.passed).toBe(true);
    // Should run with original args, NOT scoped
    expect(exec).toHaveBeenCalledWith("npx", ["tsc", "--noEmit"], { cwd: "/tmp" });
  });
});
