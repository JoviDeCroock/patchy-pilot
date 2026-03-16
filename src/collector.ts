import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./schemas/config.js";
import type { Artifacts, ValidationResult } from "./schemas/review.js";
import { gitDiff, changedFiles } from "./utils/git.js";
import { log } from "./utils/logger.js";

export async function collectArtifacts(
  spec: string,
  validation: ValidationResult,
  config: Config,
  cwd: string,
  builderSummary?: string
): Promise<Artifacts> {
  log.step("Collecting artifacts");

  const diff = await gitDiff(config.base_branch, cwd);
  const files = await changedFiles(config.base_branch, cwd);

  log.detail(`Found ${files.length} changed files`);

  // Read contents of changed files
  const fileContents: Record<string, string> = {};
  for (const file of files) {
    try {
      const content = await readFile(join(cwd, file), "utf-8");
      // Cap individual file size to avoid enormous prompts
      fileContents[file] = content.length > 20_000
        ? content.slice(0, 20_000) + "\n... [truncated]"
        : content;
    } catch {
      fileContents[file] = "[could not read file]";
    }
  }

  return {
    spec,
    git_diff: diff.length > 50_000 ? diff.slice(0, 50_000) + "\n... [truncated]" : diff,
    changed_files: files,
    file_contents: fileContents,
    validation,
    builder_summary: builderSummary,
  };
}
