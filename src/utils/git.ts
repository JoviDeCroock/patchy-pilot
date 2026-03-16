import { exec } from "./process.js";

export async function gitDiff(baseBranch: string, cwd?: string): Promise<string> {
  // Try diffing against the base branch first, fall back to HEAD
  const mergeBase = await exec("git", ["merge-base", baseBranch, "HEAD"], { cwd });
  if (mergeBase.exitCode === 0) {
    const result = await exec("git", ["diff", mergeBase.stdout.trim()], { cwd });
    return result.stdout;
  }
  // Fallback: diff of staged + unstaged against HEAD
  const result = await exec("git", ["diff", "HEAD"], { cwd });
  return result.stdout;
}

export async function changedFiles(baseBranch: string, cwd?: string): Promise<string[]> {
  const mergeBase = await exec("git", ["merge-base", baseBranch, "HEAD"], { cwd });
  let result;
  if (mergeBase.exitCode === 0) {
    result = await exec("git", ["diff", "--name-only", mergeBase.stdout.trim()], { cwd });
  } else {
    result = await exec("git", ["diff", "--name-only", "HEAD"], { cwd });
  }
  return result.stdout
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);
}

export async function untrackedFiles(cwd?: string): Promise<string[]> {
  const result = await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd });
  return result.stdout
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);
}

export async function readFile(path: string, cwd?: string): Promise<string> {
  const result = await exec("cat", [path], { cwd });
  return result.stdout;
}
