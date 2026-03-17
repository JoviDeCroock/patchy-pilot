import { describe, it, expect } from "vitest";
import { ConfigSchema, ValidationCommandSchema, ThresholdConfigSchema } from "./config.js";

describe("ConfigSchema", () => {
  it("parses an empty object with all defaults", () => {
    const config = ConfigSchema.parse({});
    expect(config.builder.provider).toBe("claude-code");
    expect(config.reviewer.provider).toBe("claude-code");
    expect(config.repairer.enabled).toBe(false);
    expect(config.repairer.max_iterations).toBe(3);
    expect(config.thresholds.max_critical).toBe(0);
    expect(config.thresholds.max_high).toBe(2);
    expect(config.thresholds.min_confidence).toBe(0.6);
    expect(config.thresholds.block_on).toEqual(["critical_issues"]);
    expect(config.review_rules).toEqual([]);
    expect(config.artifacts_dir).toBe(".patchy-pilot/runs");
    expect(config.base_branch).toBe("main");
  });

  it("allows overriding builder provider", () => {
    const config = ConfigSchema.parse({ builder: { provider: "codex" } });
    expect(config.builder.provider).toBe("codex");
  });

  it("allows dangerouslySkipPermissions on builder", () => {
    const config = ConfigSchema.parse({
      builder: { provider: "claude-code", dangerouslySkipPermissions: true },
    });
    expect(config.builder.dangerouslySkipPermissions).toBe(true);
  });

  it("allows custom validation commands", () => {
    const config = ConfigSchema.parse({
      validation: {
        formatter: { command: "prettier", args: ["--check", "."] },
        linter: { command: "eslint", args: ["."], enabled: false },
      },
    });
    expect(config.validation.formatter?.command).toBe("prettier");
    expect(config.validation.formatter?.enabled).toBe(true);
    expect(config.validation.linter?.enabled).toBe(false);
  });

  it("allows custom thresholds", () => {
    const config = ConfigSchema.parse({
      thresholds: { max_critical: 1, max_high: 5, min_confidence: 0.8 },
    });
    expect(config.thresholds.max_critical).toBe(1);
    expect(config.thresholds.max_high).toBe(5);
    expect(config.thresholds.min_confidence).toBe(0.8);
  });

  it("allows custom review rules", () => {
    const config = ConfigSchema.parse({
      review_rules: ["No console.log", "Use strict mode"],
    });
    expect(config.review_rules).toEqual(["No console.log", "Use strict mode"]);
  });

  it("allows custom base branch", () => {
    const config = ConfigSchema.parse({ base_branch: "develop" });
    expect(config.base_branch).toBe("develop");
  });

  it("allows repairer configuration", () => {
    const config = ConfigSchema.parse({
      repairer: { enabled: true, max_iterations: 5 },
    });
    expect(config.repairer.enabled).toBe(true);
    expect(config.repairer.max_iterations).toBe(5);
  });

  it("rejects repairer max_iterations outside 1-10", () => {
    expect(() =>
      ConfigSchema.parse({ repairer: { max_iterations: 0 } })
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({ repairer: { max_iterations: 11 } })
    ).toThrow();
  });

  it("rejects invalid block_on categories", () => {
    expect(() =>
      ConfigSchema.parse({ thresholds: { block_on: ["invalid_category"] } })
    ).toThrow();
  });

  it("accepts valid block_on categories", () => {
    const config = ConfigSchema.parse({
      thresholds: {
        block_on: ["critical_issues", "likely_bugs", "spec_mismatches"],
      },
    });
    expect(config.thresholds.block_on).toEqual([
      "critical_issues",
      "likely_bugs",
      "spec_mismatches",
    ]);
  });
});

describe("ValidationCommandSchema", () => {
  it("parses a minimal command", () => {
    const cmd = ValidationCommandSchema.parse({ command: "eslint" });
    expect(cmd.command).toBe("eslint");
    expect(cmd.args).toEqual([]);
    expect(cmd.enabled).toBe(true);
  });

  it("allows disabling a command", () => {
    const cmd = ValidationCommandSchema.parse({
      command: "eslint",
      enabled: false,
    });
    expect(cmd.enabled).toBe(false);
  });
});

describe("ThresholdConfigSchema", () => {
  it("applies defaults for empty object", () => {
    const t = ThresholdConfigSchema.parse({});
    expect(t.max_critical).toBe(0);
    expect(t.max_high).toBe(2);
    expect(t.min_confidence).toBe(0.6);
    expect(t.block_on).toEqual(["critical_issues"]);
  });
});
