import { describe, it, expect } from "vitest";
import { parseGitHubIssue } from "./github-issue.js";

describe("parseGitHubIssue", () => {
  it("parses a full GitHub issue URL", () => {
    const ref = parseGitHubIssue("https://github.com/owner/repo/issues/42");
    expect(ref).toEqual({ repo: "owner/repo", number: 42 });
  });

  it("parses an HTTP (non-HTTPS) GitHub issue URL", () => {
    const ref = parseGitHubIssue("http://github.com/owner/repo/issues/1");
    expect(ref).toEqual({ repo: "owner/repo", number: 1 });
  });

  it("parses a URL with trailing slash", () => {
    const ref = parseGitHubIssue("https://github.com/owner/repo/issues/7/");
    expect(ref).toEqual({ repo: "owner/repo", number: 7 });
  });

  it("parses shorthand owner/repo#number", () => {
    const ref = parseGitHubIssue("anthropics/claude-code#123");
    expect(ref).toEqual({ repo: "anthropics/claude-code", number: 123 });
  });

  it("returns null for plain text", () => {
    expect(parseGitHubIssue("Add a login button")).toBeNull();
  });

  it("returns null for a file reference", () => {
    expect(parseGitHubIssue("@spec.md")).toBeNull();
  });

  it("returns null for a non-issue GitHub URL", () => {
    expect(parseGitHubIssue("https://github.com/owner/repo/pull/5")).toBeNull();
  });

  it("returns null for a GitHub URL without issue number", () => {
    expect(parseGitHubIssue("https://github.com/owner/repo/issues/")).toBeNull();
  });

  it("returns null for a malformed shorthand (missing number)", () => {
    expect(parseGitHubIssue("owner/repo#")).toBeNull();
  });

  it("returns null for a shorthand with non-numeric issue", () => {
    expect(parseGitHubIssue("owner/repo#abc")).toBeNull();
  });

  it("handles repos with hyphens and dots", () => {
    const ref = parseGitHubIssue("my-org/my.repo#99");
    expect(ref).toEqual({ repo: "my-org/my.repo", number: 99 });
  });

  it("handles URLs with hyphens in org and repo", () => {
    const ref = parseGitHubIssue("https://github.com/my-org/my-repo/issues/500");
    expect(ref).toEqual({ repo: "my-org/my-repo", number: 500 });
  });
});
