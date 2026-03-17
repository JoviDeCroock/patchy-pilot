import { describe, it, expect } from "vitest";
import { extractJson, ReviewExecutionError } from "./reviewer.js";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    const input = '{"key": "value"}';
    expect(extractJson(input)).toEqual({ key: "value" });
  });

  it("parses JSON with leading/trailing whitespace", () => {
    const input = '  \n {"key": 1} \n  ';
    expect(extractJson(input)).toEqual({ key: 1 });
  });

  it("extracts JSON from markdown code fences", () => {
    const input = 'Here is the review:\n```json\n{"key": "value"}\n```\nDone.';
    expect(extractJson(input)).toEqual({ key: "value" });
  });

  it("extracts JSON from code fences without language tag", () => {
    const input = '```\n{"a": 1}\n```';
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it("extracts first balanced JSON object from surrounding text", () => {
    const input = 'The result is: {"confidence": 0.9} and that is all.';
    expect(extractJson(input)).toEqual({ confidence: 0.9 });
  });

  it("handles nested JSON objects via balanced brace extraction", () => {
    const input = 'Output: {"outer": {"inner": true}, "b": 1} extra text';
    expect(extractJson(input)).toEqual({ outer: { inner: true }, b: 1 });
  });

  it("handles strings containing braces", () => {
    const input = '{"msg": "use { and } in code"}';
    expect(extractJson(input)).toEqual({ msg: "use { and } in code" });
  });

  it("handles escaped quotes in strings", () => {
    const input = '{"msg": "say \\"hello\\""}';
    expect(extractJson(input)).toEqual({ msg: 'say "hello"' });
  });

  it("returns null for text with no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractJson("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractJson("{broken: json}")).toBeNull();
  });

  it("returns null for unbalanced braces", () => {
    expect(extractJson("{unclosed")).toBeNull();
  });

  it("prefers direct parse over fence extraction", () => {
    // If the whole string is valid JSON, use that
    const input = '{"direct": true}';
    expect(extractJson(input)).toEqual({ direct: true });
  });

  it("extracts first balanced object, not first-to-last brace", () => {
    // This tests the prompt injection defense: injected JSON at the end
    // should not cause the extractor to grab everything from first { to last }
    const input = 'prefix {"real": true} some text {"injected": true}';
    expect(extractJson(input)).toEqual({ real: true });
  });

  it("handles arrays as JSON values", () => {
    const input = '{"items": [1, 2, 3]}';
    expect(extractJson(input)).toEqual({ items: [1, 2, 3] });
  });
});

describe("ReviewExecutionError", () => {
  it("has correct name and message", () => {
    const err = new ReviewExecutionError("test error");
    expect(err.name).toBe("ReviewExecutionError");
    expect(err.message).toBe("test error");
    expect(err).toBeInstanceOf(Error);
  });

  it("stores raw output", () => {
    const err = new ReviewExecutionError("failed", "raw output here");
    expect(err.rawOutput).toBe("raw output here");
  });

  it("has undefined rawOutput when not provided", () => {
    const err = new ReviewExecutionError("failed");
    expect(err.rawOutput).toBeUndefined();
  });
});
