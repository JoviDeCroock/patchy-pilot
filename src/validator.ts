import type { Config } from "./schemas/config.js";
import type { ValidationResult } from "./schemas/review.js";
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

export async function validate(config: Config, cwd: string): Promise<ValidationResult> {
  log.step("Running validation checks");

  const [formatter, linter, typecheck, tests] = await Promise.all([
    runCheck("formatter", config.validation.formatter, cwd),
    runCheck("linter", config.validation.linter, cwd),
    runCheck("typecheck", config.validation.typecheck, cwd),
    runCheck("tests", config.validation.tests, cwd),
  ]);

  const results = [formatter, linter, typecheck, tests].filter(Boolean);
  const all_passed = results.length === 0 || results.every((r) => r!.passed);

  return { formatter, linter, typecheck, tests, all_passed };
}
