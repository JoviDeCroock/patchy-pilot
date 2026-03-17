import { describe, it, expect } from "vitest";
import { LearnedSkillSchema, LearnOutputSchema } from "./learn.js";

describe("LearnedSkillSchema", () => {
  const validSkill = {
    slug: "check-lockfiles",
    title: "Check Lockfiles",
    summary: "Always verify lockfile changes.",
    when_to_use: "When dependencies change.",
    why_it_matters: "Prevents supply chain attacks.",
    instructions: ["Run npm audit after changes"],
    source_runs: ["2026-03-16T14-30-00"],
    evidence: ["Run X had a lockfile issue"],
  };

  it("parses a valid skill", () => {
    const skill = LearnedSkillSchema.parse(validSkill);
    expect(skill.slug).toBe("check-lockfiles");
  });

  it("requires at least one instruction", () => {
    expect(() => LearnedSkillSchema.parse({ ...validSkill, instructions: [] })).toThrow();
  });

  it("requires at least one source run", () => {
    expect(() => LearnedSkillSchema.parse({ ...validSkill, source_runs: [] })).toThrow();
  });

  it("requires at least one evidence item", () => {
    expect(() => LearnedSkillSchema.parse({ ...validSkill, evidence: [] })).toThrow();
  });
});

describe("LearnOutputSchema", () => {
  it("parses output with no skills", () => {
    const output = LearnOutputSchema.parse({
      overview: "No actionable patterns found.",
      skills: [],
    });
    expect(output.skills).toEqual([]);
  });

  it("parses output with skills", () => {
    const output = LearnOutputSchema.parse({
      overview: "Found patterns.",
      skills: [
        {
          slug: "test-skill",
          title: "Test Skill",
          summary: "A test.",
          when_to_use: "Always.",
          why_it_matters: "Testing.",
          instructions: ["Do this"],
          source_runs: ["run-1"],
          evidence: ["Evidence"],
        },
      ],
    });
    expect(output.skills).toHaveLength(1);
  });

  it("rejects missing overview", () => {
    expect(() => LearnOutputSchema.parse({ skills: [] })).toThrow();
  });
});
