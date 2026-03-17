import { describe, it, expect } from "vitest";
import { buildScopedArgs } from "./validator.js";

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
