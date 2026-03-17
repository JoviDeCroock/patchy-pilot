import { describe, it, expect } from "vitest";
import { createRunId } from "./artifacts.js";

describe("createRunId", () => {
  it("returns a string in ISO-like format", () => {
    const id = createRunId();
    // Format: YYYY-MM-DDTHH-mm-ss
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it("has length 19", () => {
    expect(createRunId()).toHaveLength(19);
  });

  it("does not contain colons or dots", () => {
    const id = createRunId();
    expect(id).not.toContain(":");
    expect(id).not.toContain(".");
  });

  it("starts with a valid year", () => {
    const id = createRunId();
    const year = parseInt(id.slice(0, 4), 10);
    expect(year).toBeGreaterThanOrEqual(2024);
    expect(year).toBeLessThanOrEqual(2100);
  });
});
