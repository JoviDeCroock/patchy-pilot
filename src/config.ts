import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigSchema, type Config } from "./schemas/config.js";
import { inferValidationDefaults } from "./project-context.js";

const CONFIG_FILES = ["patchy-pilot.json", ".patchy-pilot.json", ".patchy-pilot/config.json"];

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  const inferredValidation = await inferValidationDefaults(cwd);

  for (const file of CONFIG_FILES) {
    try {
      const raw = await readFile(join(cwd, file), "utf-8");
      const parsed = JSON.parse(raw);
      return withInferredValidation(ConfigSchema.parse(parsed), inferredValidation);
    } catch {
      // try next
    }
  }

  return withInferredValidation(ConfigSchema.parse({}), inferredValidation);
}

function withInferredValidation(
  config: Config,
  inferredValidation: Partial<Config["validation"]>
): Config {
  return {
    ...config,
    validation: {
      formatter: config.validation.formatter ?? inferredValidation.formatter,
      linter: config.validation.linter ?? inferredValidation.linter,
      typecheck: config.validation.typecheck ?? inferredValidation.typecheck,
      tests: config.validation.tests ?? inferredValidation.tests,
    },
  };
}
