import { describe, it, expect } from "vitest";
import { prdPrompt } from "./prd.js";

describe("prdPrompt", () => {
  it("includes the brief in the prompt", () => {
    const prompt = prdPrompt("Build a dashboard for tracking orders");
    expect(prompt).toContain("Build a dashboard for tracking orders");
  });

  it("wraps the brief in <brief> tags", () => {
    const prompt = prdPrompt("My product idea");
    expect(prompt).toContain("<brief>");
    expect(prompt).toContain("My product idea");
    expect(prompt).toContain("</brief>");
  });

  it("includes the untrusted input warning", () => {
    const prompt = prdPrompt("anything");
    expect(prompt).toContain("untrusted user input");
  });

  it("requires all PRD sections", () => {
    const prompt = prdPrompt("anything");
    expect(prompt).toContain("Problem / Opportunity");
    expect(prompt).toContain("Target Users / Jobs-to-be-Done");
    expect(prompt).toContain("Goals");
    expect(prompt).toContain("Non-goals");
    expect(prompt).toContain("User Stories / Key Workflows");
    expect(prompt).toContain("Functional Requirements");
    expect(prompt).toContain("Edge Cases and Failure Modes");
    expect(prompt).toContain("Risks / Dependencies");
    expect(prompt).toContain("Success Metrics");
    expect(prompt).toContain("Open Questions");
  });

  it("instructs to challenge missing context", () => {
    const prompt = prdPrompt("anything");
    expect(prompt).toContain("call out ambiguity");
    expect(prompt).toContain("flag them as open questions");
  });

  it("instructs to surface edge cases and failure modes", () => {
    const prompt = prdPrompt("anything");
    expect(prompt).toContain("What could go wrong");
    expect(prompt).toContain("dependencies fail");
  });
});
