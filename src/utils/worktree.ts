import { dirname, join, relative, resolve } from "node:path";
import { createRunId } from "./artifacts.js";
import { exec } from "./process.js";

const WORKTREE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface WorktreeSession {
  name: string;
  root: string;
  cwd: string;
}

export function createWorktreeName(): string {
  return `patchy-pilot-${createRunId()}`;
}

export function resolveWorktreeName(requested?: boolean | string): string | null {
  if (!requested) {
    return null;
  }

  if (requested === true) {
    return createWorktreeName();
  }

  const name = requested.trim();
  if (name.length === 0) {
    return createWorktreeName();
  }

  if (!WORKTREE_NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error(
      "Worktree names may only contain letters, numbers, dots, underscores, and hyphens.",
    );
  }

  return name;
}

export async function prepareWorktreeSession(
  baseCwd: string,
  requested?: boolean | string,
): Promise<WorktreeSession | null> {
  const name = resolveWorktreeName(requested);
  if (!name) {
    return null;
  }

  const repoRoot = await getRepoRoot(baseCwd);
  await ensureCleanWorkingTree(repoRoot);
  await ensureBranchDoesNotExist(repoRoot, name);

  const worktreeRoot = join(dirname(repoRoot), name);
  const relativeCwd = relative(repoRoot, resolve(baseCwd));
  const result = await exec("git", ["worktree", "add", "-b", name, worktreeRoot, "HEAD"], {
    cwd: repoRoot,
  });

  if (result.exitCode !== 0) {
    throw new Error(formatGitError(result, `Failed to create worktree \"${name}\".`));
  }

  return {
    name,
    root: worktreeRoot,
    cwd: relativeCwd.length > 0 ? join(worktreeRoot, relativeCwd) : worktreeRoot,
  };
}

async function getRepoRoot(cwd: string): Promise<string> {
  const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: resolve(cwd) });
  if (result.exitCode !== 0) {
    throw new Error(formatGitError(result, "`--worktree` requires a git repository."));
  }

  return result.stdout.trim();
}

async function ensureCleanWorkingTree(repoRoot: string): Promise<void> {
  const result = await exec("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      formatGitError(result, "Failed to inspect git status before creating a worktree."),
    );
  }

  if (result.stdout.trim().length > 0) {
    throw new Error(
      "`--worktree` requires a clean working tree because the new worktree starts from committed HEAD.",
    );
  }
}

async function ensureBranchDoesNotExist(repoRoot: string, name: string): Promise<void> {
  const result = await exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
    cwd: repoRoot,
  });

  if (result.exitCode === 0) {
    throw new Error(`A local branch named \"${name}\" already exists.`);
  }

  if (result.exitCode !== 1) {
    throw new Error(formatGitError(result, `Failed to check whether branch \"${name}\" exists.`));
  }
}

function formatGitError(
  result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  },
  fallback: string,
): string {
  const details = [result.stderr.trim(), result.stdout.trim()]
    .filter((value) => value.length > 0)
    .join("\n");
  if (details.length > 0) {
    return `${fallback} ${details}`;
  }

  return `${fallback} git exited with code ${result.exitCode}.`;
}
