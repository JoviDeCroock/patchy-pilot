import { describe, it, expect } from "vitest";
import { reviewPrompt } from "./reviewer.js";
import type { Artifacts } from "../schemas/review.js";

function makeArtifacts(overrides: Partial<Artifacts> = {}): Artifacts {
  return {
    spec: "Add a button",
    git_diff: "diff --git a/src/button.ts",
    changed_files: ["src/button.ts"],
    file_contents: { "src/button.ts": "export const Button = () => {}" },
    validation: { all_passed: true },
    ...overrides,
  };
}

describe("reviewPrompt", () => {
  it("includes the spec in specification tags", () => {
    const prompt = reviewPrompt(makeArtifacts({ spec: "Build REST API" }));
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("Build REST API");
    expect(prompt).toContain("</specification>");
  });

  it("includes the git diff", () => {
    const prompt = reviewPrompt(makeArtifacts({ git_diff: "diff --git abc" }));
    expect(prompt).toContain("<git-diff>");
    expect(prompt).toContain("diff --git abc");
  });

  it("includes file contents with path attributes", () => {
    const prompt = reviewPrompt(
      makeArtifacts({
        file_contents: { "src/main.ts": "console.log('hi')" },
      })
    );
    expect(prompt).toContain('<file path="src/main.ts">');
    expect(prompt).toContain("console.log('hi')");
  });

  it("includes validation results", () => {
    const prompt = reviewPrompt(
      makeArtifacts({
        validation: {
          linter: { passed: false, output: "2 errors found" },
          all_passed: false,
        },
      })
    );
    expect(prompt).toContain("Linter: FAIL");
    expect(prompt).toContain("2 errors found");
  });

  it("says no validation when none configured", () => {
    const prompt = reviewPrompt(makeArtifacts({ validation: { all_passed: true } }));
    expect(prompt).toContain("No validation steps configured");
  });

  it("includes extra rules when provided", () => {
    const prompt = reviewPrompt(makeArtifacts(), ["No console.log", "Use strict types"]);
    expect(prompt).toContain("Additional Review Rules");
    expect(prompt).toContain("No console.log");
    expect(prompt).toContain("Use strict types");
  });

  it("omits extra rules section when empty", () => {
    const prompt = reviewPrompt(makeArtifacts(), []);
    expect(prompt).not.toContain("Additional Review Rules");
  });

  it("includes builder summary when provided", () => {
    const prompt = reviewPrompt(
      makeArtifacts({ builder_summary: "I added a button component" })
    );
    expect(prompt).toContain("<builder-summary>");
    expect(prompt).toContain("I added a button component");
    expect(prompt).toContain("Do not trust this summary");
  });

  it("omits builder summary content when not provided", () => {
    const prompt = reviewPrompt(makeArtifacts({ builder_summary: undefined }));
    // The tag name appears in the warning text, but the actual section should not be present
    expect(prompt).not.toContain("Do not trust this summary");
  });

  it("includes untrusted input warning", () => {
    const prompt = reviewPrompt(makeArtifacts());
    expect(prompt).toContain("untrusted input");
  });

  it("requests JSON output format", () => {
    const prompt = reviewPrompt(makeArtifacts());
    expect(prompt).toContain("critical_issues");
    expect(prompt).toContain("merge_recommendation");
    expect(prompt).toContain("confidence");
  });

  it("includes project context when available", () => {
    const prompt = reviewPrompt(
      makeArtifacts({
        project_context: {
          package_manager: "pnpm",
          package_scripts: { test: "vitest run", lint: "eslint ." },
          ci_files: [],
          inferred_validation: {},
        },
      })
    );
    expect(prompt).toContain("pnpm");
    expect(prompt).toContain("vitest run");
  });
});
