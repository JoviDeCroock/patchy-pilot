import { describe, it, expect, vi } from "vitest";

/**
 * These tests verify the onData/silent logic in isolation by reproducing the
 * conditional that runFeature and runReviewOnly use internally.
 *
 * We don't call the full runner (which needs providers, filesystems, etc.)
 * but instead test the core boolean logic that decides whether streaming
 * is enabled.
 */

function buildOnData(silent?: boolean): ((chunk: string) => void) | undefined {
  // Mirrors the logic in runner.ts
  return silent ? undefined : (chunk: string) => process.stderr.write(chunk);
}

describe("streaming default behaviour (silent flag)", () => {
  it("streams by default when silent is not set", () => {
    const onData = buildOnData(undefined);
    expect(onData).toBeTypeOf("function");
  });

  it("streams by default when silent is false", () => {
    const onData = buildOnData(false);
    expect(onData).toBeTypeOf("function");
  });

  it("suppresses streaming when silent is true", () => {
    const onData = buildOnData(true);
    expect(onData).toBeUndefined();
  });

  it("calls the callback with chunk data when streaming", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const onData = buildOnData(false);
    onData!("hello");
    expect(writeSpy).toHaveBeenCalledWith("hello");
    writeSpy.mockRestore();
  });
});
