import type { Config } from "./schemas/config.js";
import type { ValidationResult } from "./schemas/review.js";
import { changedFiles, untrackedFiles } from "./utils/git.js";
import { exec } from "./utils/process.js";
import { log } from "./utils/logger.js";

async function runCheck(
  name: string,
  config: { command: string; args: string[]; enabled: boolean; selective: boolean } | undefined,
  cwd: string,
  changedFiles: string[],
): Promise<{ passed: boolean; output: string } | undefined> {
  if (!config || !config.enabled) return undefined;

  let args = config.args;

  if (config.selective) {
    if (changedFiles.length === 0) {
      log.detail(`No changed files — skipping ${name}`);
      return { passed: true, output: "No changed files to check." };
    }

    log.detail(`Scoping ${name} to ${changedFiles.length} changed file(s)`);
    args = buildScopedArgs(config.command, config.args, changedFiles);
  }

  log.detail(`Running ${name}: ${config.command} ${args.join(" ")}`);
  const result = await exec(config.command, args, { cwd });
  const output = (result.stdout + result.stderr).trim();
  const passed = result.exitCode === 0;

  if (passed) {
    log.success(`${name} passed`);
  } else {
    log.warn(`${name} failed (exit ${result.exitCode})`);
  }

  return { passed, output: output.slice(0, 5000) }; // cap output size
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "npx"]);

/**
 * Maximum total character length for file arguments.
 * Windows has an 8191 char command-line limit; leave headroom for the
 * command itself, its flags, and environment overhead.
 */
const MAX_FILES_ARG_LENGTH = 6000;

/**
 * Build a scoped args list that targets only the given files.
 * - For package-manager commands (`npm run lint`), appends `-- ...files`.
 * - For direct tool commands, strips a trailing `.` or `./` target and appends files.
 * - Truncates the file list if it would exceed OS command-line limits.
 */
export function buildScopedArgs(
  command: string,
  originalArgs: string[],
  files: string[],
): string[] {
  // Strip a trailing bare directory target (`.` or `./`) so the tool
  // doesn't also scan the whole tree.
  const args = [...originalArgs];
  const last = args[args.length - 1];
  if (last === "." || last === "./") {
    args.pop();
  }

  // Truncate file list to stay within OS command-line limits
  const safeFiles = truncateFileList(files);

  if (PACKAGE_MANAGERS.has(command)) {
    return [...args, "--", ...safeFiles];
  }

  return [...args, ...safeFiles];
}

/** Trim file list to stay under command-line length limits. */
function truncateFileList(files: string[]): string[] {
  let totalLength = 0;
  const result: string[] = [];
  for (const file of files) {
    totalLength += file.length + 1; // +1 for the space separator
    if (totalLength > MAX_FILES_ARG_LENGTH) {
      log.warn(
        `Scoped check truncated to ${result.length}/${files.length} files to stay within command-line limits`,
      );
      break;
    }
    result.push(file);
  }
  return result;
}

export async function validate(config: Config, cwd: string): Promise<ValidationResult> {
  log.step("Running validation checks");

  // Collect changed files for selective checks
  const changed = await getChangedFiles(config.base_branch, cwd);

  const [formatter, linter, typecheck, tests] = await Promise.all([
    runCheck("formatter", config.validation.formatter, cwd, changed),
    runCheck("linter", config.validation.linter, cwd, changed),
    runCheck("typecheck", config.validation.typecheck, cwd, changed),
    runCheck("tests", config.validation.tests, cwd, changed),
  ]);

  const results = [formatter, linter, typecheck, tests].filter(Boolean);
  const all_passed = results.length === 0 || results.every((r) => r!.passed);

  return { formatter, linter, typecheck, tests, all_passed };
}

async function getChangedFiles(baseBranch: string, cwd: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    changedFiles(baseBranch, cwd),
    untrackedFiles(cwd),
  ]);
  return Array.from(new Set([...tracked, ...untracked])).sort();
}
