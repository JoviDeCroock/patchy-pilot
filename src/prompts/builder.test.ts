import { describe, it, expect } from "vitest";
import { buildPrompt } from "./builder.js";

describe("buildPrompt", () => {
  it("includes the specification in the prompt", () => {
    const prompt = buildPrompt("Add a login page");
    expect(prompt).toContain("Add a login page");
  });

  it("wraps the spec in <specification> tags", () => {
    const prompt = buildPrompt("My feature spec");
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("My feature spec");
    expect(prompt).toContain("</specification>");
  });

  it("includes the untrusted input warning", () => {
    const prompt = buildPrompt("anything");
    expect(prompt).toContain("untrusted user input");
  });

  it("includes implementation instructions", () => {
    const prompt = buildPrompt("anything");
    expect(prompt).toContain("Read the existing codebase");
    expect(prompt).toContain("Write tests");
  });

  it("asks for a summary", () => {
    const prompt = buildPrompt("anything");
    expect(prompt).toContain("What you implemented");
  });
});
