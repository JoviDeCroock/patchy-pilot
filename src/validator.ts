import type { Config } from "./schemas/config.js";
import type { ValidationResult } from "./schemas/review.js";
import { changedFiles, untrackedFiles } from "./utils/git.js";
import { exec } from "./utils/process.js";
import { log } from "./utils/logger.js";

async function runCheck(
  name: string,
  config: { command: string; args: string[]; enabled: boolean } | undefined,
  cwd: string
): Promise<{ passed: boolean; output: string } | undefined> {
  if (!config || !config.enabled) return undefined;

  log.detail(`Running ${name}: ${config.command} ${config.args.join(" ")}`);
  const result = await exec(config.command, config.args, { cwd });
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
 * Build a scoped args list that targets only the given files.
 * - For package-manager commands (`npm run lint`), appends `-- ...files`.
 * - For direct tool commands, strips a trailing `.` or `./` target and appends files.
 */
export function buildScopedArgs(
  command: string,
  originalArgs: string[],
  files: string[]
): string[] {
  // Strip a trailing bare directory target (`.` or `./`) so the tool
  // doesn't also scan the whole tree.
  const args = [...originalArgs];
  const last = args[args.length - 1];
  if (last === "." || last === "./") {
    args.pop();
  }

  if (PACKAGE_MANAGERS.has(command)) {
    return [...args, "--", ...files];
  }

  return [...args, ...files];
}

export async function validate(
  config: Config,
  cwd: string
): Promise<ValidationResult> {
  log.step("Running validation checks");

  // Collect changed files to scope formatter & linter
  const changed = await getChangedFiles(config.base_branch, cwd);

  const scopeCheck = (
    name: string,
    check: Config["validation"]["formatter"]
  ) => {
    if (!check || !check.enabled) return runCheck(name, check, cwd);

    if (changed.length === 0) {
      log.detail(`No changed files — skipping ${name}`);
      return Promise.resolve({ passed: true, output: "No changed files to check." });
    }

    log.detail(`Scoping ${name} to ${changed.length} changed file(s)`);
    const scopedConfig = {
      ...check,
      args: buildScopedArgs(check.command, check.args, changed),
    };
    return runCheck(name, scopedConfig, cwd);
  };

  const [formatter, linter, typecheck, tests] = await Promise.all([
    scopeCheck("formatter", config.validation.formatter),
    scopeCheck("linter", config.validation.linter),
    runCheck("typecheck", config.validation.typecheck, cwd),
    runCheck("tests", config.validation.tests, cwd),
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
